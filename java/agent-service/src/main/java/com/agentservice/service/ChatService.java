package com.agentservice.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.agentservice.dto.ChatDtos.ChatRequestBody;
import com.agentservice.dto.ChatDtos.IncomingMessage;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 聊天核心业务：
 *
 * <ul>
 *   <li>入参消息落库到 SQLite（conversation/messages）</li>
 *   <li>构建 system 提示：RAG 知识库 + 长期记忆 + 可选 Skill 文件</li>
 *   <li>决定是否调用 MCP 工具（手动 @mcp / 启发式 / LLM JSON 决策）</li>
 *   <li>流式请求 LLM（SSE: delta/end/error）并把结果写回 messages</li>
 *   <li>对每轮对话抽取长期记忆并写入 user_memories</li>
 * </ul>
 */
@Service
public class ChatService {
  private static final Logger log = LoggerFactory.getLogger(ChatService.class);

  // 手动 MCP：@mcp(serverKey, toolName) {argsJson?}
  private static final Pattern MCP_WITH_TOOL = Pattern.compile(
      "@mcp\\(\\s*([^)]+?)\\s*,\\s*([^)]+?)\\s*\\)\\s*(\\{[\\s\\S]*\\})?",
      Pattern.CASE_INSENSITIVE);
  // 手动 MCP：@mcp(serverKey) {argsJson?}（工具名从 server config 推断）
  private static final Pattern MCP_SERVER_ONLY = Pattern.compile(
      "@mcp\\(\\s*([^)]+?)\\s*\\)\\s*(\\{[\\s\\S]*\\})?",
      Pattern.CASE_INSENSITIVE);

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;
  private final McpToolService mcpToolService;

  private final HttpClient httpClient = HttpClient.newHttpClient();
  private final ExecutorService executor = Executors.newFixedThreadPool(16);

  /** 通义/ DashScope 主 Key（聊天/补全） */
  @Value("${DASHSCOPE_API_KEY:}") private String dashscopeApiKey;
  /** 可配置主 baseURL（优先） */
  @Value("${DASHSCOPE_BASE_URL:}") private String dashscopeBaseUrl;
  /** 兼容模式 baseURL（默认） */
  @Value("${DASHSCOPE_COMPAT_BASE_URL:https://dashscope.aliyuncs.com/compatible-mode/v1}")
  private String dashscopeCompatBaseUrl;
  /** 对话模型名 */
  @Value("${DASHSCOPE_CHAT_MODEL:qwen-plus}") private String chatModel;

  /** embeddings Key（用于 RAG/Memory 检索；未配置则退化为不检索） */
  @Value("${DASHSCOPE_API_KEY_EMBEDDINGS:}") private String dashscopeEmbeddingKey;
  /** embeddings base（可选） */
  @Value("${DASHSCOPE_EMBEDDINGS_BASE_URL:}") private String dashscopeEmbeddingsBaseUrl;
  /** embeddings 模型名 */
  @Value("${DASHSCOPE_EMBEDDING_MODEL:text-embedding-v2}") private String embeddingModel;
  @Value("${CHAT_SLOW_MS:8000}") private long chatSlowMs;

  /** 可覆盖 skills 目录（用于读取 skills/*.md） */
  @Value("${SKILLS_DIR:}") private String skillsDirOverride;

  public ChatService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper, McpToolService mcpToolService) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
    this.mcpToolService = mcpToolService;
  }

  /**
   * 由 {@link com.agentservice.controller.ChatController} 调用（已鉴权）。
   * 通过 emitter 向前端推送 {@code event: delta/end/error}。
   */
  public void handleChatSse(String userId, String authorization, ChatRequestBody body, SseEmitter emitter) throws Exception {
    long requestStartNs = System.nanoTime();
    if (blank(dashscopeApiKey)) {
      // 不泄露 value，只给定位提示
      emitter.send(SseEmitter.event().name("error").data((Object) Map.of(
          "error",
          "未配置 DASHSCOPE_API_KEY：请确保 Java 进程已获得有效的 DASHSCOPE_API_KEY 并重启。"
      )));
      emitter.complete();
      return;
    }

    List<IncomingMessage> incoming = body == null || body.messages == null ? List.of() : body.messages;
    if (incoming.isEmpty()) {
      emitter.send(SseEmitter.event().name("error").data((Object) Map.of("error", "Messages are required")));
      emitter.complete();
      return;
    }

    long startNs = System.nanoTime();
    String conversationId = ensureConversation(userId, body.conversationId, incoming);
    String latestUserText = Optional.ofNullable(incoming.get(incoming.size() - 1).content).orElse("");
    saveMessage(conversationId, incoming.get(incoming.size() - 1).role, latestUserText);
    long persistUserMs = elapsedMs(startNs);

    // Parallel Preflight Tasks: Embedding, Skill, MCP Decision
    CompletableFuture<double[]> embedFuture = CompletableFuture.supplyAsync(() -> {
      try { return embed(latestUserText); } catch (Exception e) { return new double[0]; }
    }, executor);

    CompletableFuture<String> skillFuture = CompletableFuture.supplyAsync(() -> buildSkillPrompt(body.skillName), executor);

    CompletableFuture<McpParsed> mcpFuture = CompletableFuture.supplyAsync(() -> {
      // 只有在用户输入可能包含指令或关键词时才尝试 LLM 决策，减少盲目调用 LLM 带来的 9s 延迟
      String lower = latestUserText.toLowerCase(Locale.ROOT);
      boolean possibleAction = lower.contains("调用") || lower.contains("执行") || lower.contains("工具") 
          || lower.contains("查询") || lower.contains("获取") || lower.contains("tool") || lower.contains("call")
          || lower.contains("check") || lower.contains("search") || lower.contains("mcp");

      McpParsed m = parseManualMcp(latestUserText);
      if (m == null) m = detectAutoMcp(userId, latestUserText);
      if (m == null && possibleAction) m = planAutoMcpByLlm(userId, latestUserText);
      return m;
    }, executor);

    // RAG and Memory depend on Embedding
    CompletableFuture<String> ragFuture = embedFuture.thenApplyAsync(emb -> buildRagPrompt(userId, body.collectionId, emb), executor);
    CompletableFuture<String> memoryFuture = embedFuture.thenApplyAsync(emb -> buildMemoryPrompt(userId, emb), executor);

    // Wait for prompts and mcp decision
    McpParsed mcp = mcpFuture.join();
    String ragPrompt = ragFuture.join();
    String memoryPrompt = memoryFuture.join();
    String skillPrompt = skillFuture.join();

    String system = merge("你是一个严谨助手。", ragPrompt, memoryPrompt, skillPrompt);

    // 构建给 LLM 的 messages：system + 历史 user/assistant
    List<Map<String, Object>> msgs = new ArrayList<>();
    msgs.add(Map.of("role", "system", "content", system));
    for (IncomingMessage m : incoming) {
      if (m != null && m.content != null && ("user".equals(m.role) || "assistant".equals(m.role))) {
        msgs.add(Map.of("role", m.role, "content", m.content));
      }
    }

    long mcpToolMs = 0L;
    if (mcp != null) {
      String toolName = mcp.toolName != null ? mcp.toolName : resolveDefaultToolName(userId, mcp.serverKey);
      startNs = System.nanoTime();
      Map<String, Object> called = mcpToolService.callTool(authorization, mcp.serverKey, toolName, mcp.arguments);
      mcpToolMs = elapsedMs(startNs);
      msgs.add(Map.of("role", "assistant",
          "content", "[MCP工具 " + mcp.serverKey + "/" + toolName + " 原始结果]\\n" + objectMapper.writeValueAsString(called.get("result"))));
      msgs.add(Map.of("role", "user", "content", "请基于上面的 MCP 工具结果给出最终回答。"));
    }

    long preflightMs = elapsedMs(requestStartNs);
    int totalPromptChars = system.length() + latestUserText.length();
    log.info(
        "chat_timing_preflight conversationId={} persistUserMs={} preflightMs={} mcpToolMs={} messageCount={} promptChars={}",
        conversationId, persistUserMs, preflightMs, mcpToolMs, incoming.size(), totalPromptChars);
    streamAndPersist(userId, latestUserText, msgs, conversationId, emitter, requestStartNs, preflightMs);
  }

  /**
   * 流式调用 LLM（DashScope OpenAI 兼容接口），并在结束后：
   * 写回 messages + 抽取记忆（写入 user_memories）+ 发送 end。
   */
  private void streamAndPersist(String userId, String latestUserText,
      List<Map<String, Object>> messages,
      String conversationId,
      SseEmitter emitter,
      long requestStartNs,
      long preflightMs) throws Exception {

    long startNs = System.nanoTime();
    HttpRequest req = HttpRequest.newBuilder()
        .uri(URI.create(trim(effectiveChatBaseUrl()) + "/chat/completions"))
        .header("Authorization", "Bearer " + dashscopeApiKey)
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(Map.of(
            "model", chatModel,
            "stream", true,
            "messages", messages
        )), StandardCharsets.UTF_8))
        .build();

    HttpResponse<InputStream> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofInputStream());
    long llmConnectMs = elapsedMs(startNs);
    if (resp.statusCode() < 200 || resp.statusCode() >= 300) {
      long totalMs = elapsedMs(requestStartNs);
      log.warn("chat_timing_error conversationId={} preflightMs={} llmConnectMs={} totalMs={} status={}",
          conversationId, preflightMs, llmConnectMs, totalMs, resp.statusCode());
      emitter.send(SseEmitter.event().name("error").data((Object) Map.of(
          "error", describeLlmHttpFailure(resp.statusCode())
      )));
      emitter.complete();
      return;
    }

    StringBuilder full = new StringBuilder();
    long firstDeltaNs = -1L;
    long streamStartNs = System.nanoTime();
    try (BufferedReader br = new BufferedReader(new InputStreamReader(resp.body(), StandardCharsets.UTF_8))) {
      String line;
      while ((line = br.readLine()) != null) {
        if (!line.startsWith("data:")) continue;
        String data = line.substring(5).trim();
        if ("[DONE]".equals(data)) break;

        String delta = extractDelta(data);
        if (!delta.isEmpty()) {
          if (firstDeltaNs < 0) firstDeltaNs = System.nanoTime();
          full.append(delta);
          emitter.send(SseEmitter.event().name("delta").data(delta));
        }
      }
    }
    long streamMs = elapsedMs(streamStartNs);
    long ttftMs = firstDeltaNs < 0 ? -1L : elapsedMs(streamStartNs, firstDeltaNs);

    String answer = full.toString();
    startNs = System.nanoTime();
    saveMessage(conversationId, "assistant", answer);
    long saveAssistantMs = elapsedMs(startNs);
    startNs = System.nanoTime();
    emitter.send(SseEmitter.event().name("end").data((Object) Map.of("conversationId", conversationId)));
    emitter.complete();
    long endEmitMs = elapsedMs(startNs);
    long totalMs = elapsedMs(requestStartNs);

    // Asynchronous Memory Upsert (Doesn't block user response)
    CompletableFuture.runAsync(() -> {
      long mStart = System.nanoTime();
      upsertMemoriesFromTurn(userId, latestUserText, answer);
      log.info("chat_async_memory_done conversationId={} durationMs={}", conversationId, elapsedMs(mStart));
    }, executor);

    if (totalMs >= chatSlowMs) {
      log.warn(
          "chat_timing_slow conversationId={} preflightMs={} llmConnectMs={} ttftMs={} streamMs={} saveAssistantMs={} endEmitMs={} totalMs={} thresholdMs={} answerChars={}",
          conversationId, preflightMs, llmConnectMs, ttftMs, streamMs, saveAssistantMs, endEmitMs, totalMs, chatSlowMs, answer.length());
    }
    log.info(
        "chat_timing_total conversationId={} preflightMs={} llmConnectMs={} ttftMs={} streamMs={} saveAssistantMs={} endEmitMs={} totalMs={} answerChars={}",
        conversationId, preflightMs, llmConnectMs, ttftMs, streamMs, saveAssistantMs, endEmitMs, totalMs, answer.length());
  }

  /** RAG：对 kb_chunks 按 embedding 相似度排序，取前 5 条拼进 system。 */
  private String buildRagPrompt(String userId, String collectionId, double[] queryEmbedding) {
    try {
      if (queryEmbedding.length == 0) return null;

      List<Map<String, Object>> rows = jdbcTemplate.queryForList(
          "SELECT content, embedding FROM kb_chunks WHERE userId = ? AND collectionId IS ?",
          userId, blank(collectionId) ? null : collectionId);
      if (rows.isEmpty()) return null;
      List<Object[]> scored = new ArrayList<>(rows.size());
      for (Map<String, Object> row : rows) {
        double score = cosine(queryEmbedding, parseEmb(Objects.toString(row.get("embedding"), "[]")));
        scored.add(new Object[] {score, Objects.toString(row.get("content"), "")});
      }
      scored.sort((a, b) -> Double.compare((double) b[0], (double) a[0]));

      StringBuilder sb = new StringBuilder("以下是知识库上下文，优先依据它回答：\\n");
      for (int i = 0; i < Math.min(5, scored.size()); i++) {
        sb.append("- ").append(scored.get(i)[1]).append("\\n");
      }
      return sb.toString();
    } catch (Exception e) {
      return null;
    }
  }

  /** Memory：从 user_memories 里挑相似度 >= 0.35 的若干条拼进 system。 */
  private String buildMemoryPrompt(String userId, double[] queryEmbedding) {
    try {
      if (queryEmbedding.length == 0) return null;

      List<Map<String, Object>> rows = jdbcTemplate.queryForList(
          "SELECT content, embedding FROM user_memories WHERE userId = ? AND embedding IS NOT NULL",
          userId);

      List<String> memories = new ArrayList<>();
      for (Map<String, Object> r : rows) {
        double s = cosine(queryEmbedding, parseEmb(Objects.toString(r.get("embedding"), "[]")));
        if (s >= 0.35) memories.add(Objects.toString(r.get("content"), ""));
      }
      if (memories.isEmpty()) return null;
      return "长期记忆：\\n" + String.join("\\n", memories.subList(0, Math.min(5, memories.size())));
    } catch (Exception e) {
      return null;
    }
  }

  /** Skill：读取 skills/{skillName}.md 全文塞进 system。 */
  private String buildSkillPrompt(String skillName) {
    if (blank(skillName)) return null;
    try {
      Path dir = resolveSkillsDir();
      if (!Files.isDirectory(dir)) return null;
      Path f = dir.resolve(skillName + ".md");
      if (!Files.exists(f)) return null;
      return "技能说明：\\n" + Files.readString(f);
    } catch (Exception e) {
      return null;
    }
  }

  private Path resolveSkillsDir() {
    if (!blank(skillsDirOverride)) return Paths.get(skillsDirOverride).toAbsolutePath().normalize();
    Path cwd = Paths.get("").toAbsolutePath().normalize();
    Path direct = cwd.resolve("skills");
    if (Files.isDirectory(direct)) return direct;
    Path appRoot = cwd.getParent() != null ? cwd.getParent().getParent() : null;
    return appRoot == null ? direct : appRoot.resolve("skills");
  }

  /** 无 conversationId 则新建会话。 */
  private String ensureConversation(String userId, String conversationId, List<IncomingMessage> incoming) {
    if (!blank(conversationId)) return conversationId;
    String id = UUID.randomUUID().toString();
    String title = incoming.stream()
        .filter(m -> "user".equals(m.role))
        .map(m -> m.content == null ? "" : m.content)
        .findFirst().orElse("New Conversation");
    if (title.length() > 50) title = title.substring(0, 50);
    jdbcTemplate.update("INSERT INTO conversations (id, userId, title) VALUES (?, ?, ?)", id, userId, title);
    return id;
  }

  /** 写入一条消息到 messages 表。 */
  private void saveMessage(String conversationId, String role, String content) {
    jdbcTemplate.update(
        "INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)",
        UUID.randomUUID().toString(),
        conversationId,
        role == null ? "user" : role,
        content == null ? "" : content
    );
  }

  /** 手动 MCP：从用户原文解析 @mcp(...)。 */
  private McpParsed parseManualMcp(String text) {
    if (blank(text)) return null;
    Matcher m = MCP_WITH_TOOL.matcher(text.trim());
    if (m.find()) return new McpParsed(m.group(1).trim(), m.group(2).trim(), parseArgs(m.group(3)));

    m = MCP_SERVER_ONLY.matcher(text.trim());
    if (m.find()) return new McpParsed(m.group(1).trim(), null, parseArgs(m.group(2)));

    return null;
  }

  /**
   * 启发式自动 MCP：
   * 只做简单触发：包含“调用/执行/工具/tool/call”则尝试命中 serverKey 或 config.tools 中的 toolName。
   */
  private McpParsed detectAutoMcp(String userId, String userText) {
    if (blank(userText)) return null;
    String lower = userText.toLowerCase(Locale.ROOT);
    boolean trigger = lower.contains("调用") || lower.contains("执行") || lower.contains("使用工具")
        || lower.contains("tool") || lower.contains("call");
    if (!trigger) return null;

    try {
      List<Map<String, Object>> rows = jdbcTemplate.queryForList(
          "SELECT serverKey, config FROM mcp_servers WHERE userId = ? AND enabled = 1", userId);
      for (Map<String, Object> row : rows) {
        String serverKey = Objects.toString(row.get("serverKey"), "");
        JsonNode tools = objectMapper.readTree(Objects.toString(row.get("config"), "{}")).path("tools");
        if (!tools.isObject()) continue;
        Iterator<String> it = tools.fieldNames();
        while (it.hasNext()) {
          String tool = it.next();
          if (lower.contains(serverKey.toLowerCase(Locale.ROOT)) || lower.contains(tool.toLowerCase(Locale.ROOT))) {
            return new McpParsed(serverKey, tool, new HashMap<>());
          }
        }
      }
    } catch (Exception ignored) {
      return null;
    }
    return null;
  }

  /**
   * LLM JSON 决策自动 MCP：
   * 列出当前用户启用 server 的 serverKey/toolName，然后让模型输出
   * {@code {"call":true/false,"serverKey":"...","toolName":"...","arguments":{}}}
   */
  private McpParsed planAutoMcpByLlm(String userId, String userText) {
    if (blank(userText)) return null;
    try {
      List<Map<String, Object>> rows = jdbcTemplate.queryForList(
          "SELECT serverKey, config FROM mcp_servers WHERE userId = ? AND enabled = 1", userId);
      if (rows.isEmpty()) return null;

      List<String> toolLines = new ArrayList<>();
      for (Map<String, Object> row : rows) {
        String serverKey = Objects.toString(row.get("serverKey"), "");
        JsonNode tools = objectMapper.readTree(Objects.toString(row.get("config"), "{}")).path("tools");
        if (!tools.isObject()) continue;
        Iterator<String> it = tools.fieldNames();
        while (it.hasNext()) toolLines.add(serverKey + "/" + it.next());
      }
      if (toolLines.isEmpty()) return null;

      String system = String.join("\n",
          "你是工具选择器。你的任务是判断是否要调用 MCP 工具。",
          "只有用户明确想调用工具、执行动作、查询外部数据时才调用。",
          "普通聊天、解释、润色不要调用工具。",
          "输出严格 JSON：{\"call\":true|false,\"serverKey\":\"\",\"toolName\":\"\",\"arguments\":{}}");
      String user = "用户输入:\n" + userText + "\n\n可用工具:\n- " + String.join("\n- ", toolLines);

      String content = invokeNonStream(system, user);
      JsonNode decision = objectMapper.readTree(content);
      if (!decision.path("call").asBoolean(false)) return null;

      String serverKey = decision.path("serverKey").asText("");
      String toolName = decision.path("toolName").asText("");
      JsonNode argsNode = decision.path("arguments");
      if (blank(serverKey) || blank(toolName) || !argsNode.isObject()) return null;

      Map<String, Object> args = objectMapper.convertValue(argsNode, new TypeReference<Map<String, Object>>() {});
      return new McpParsed(serverKey, toolName, args);
    } catch (Exception ignored) {
      return null;
    }
  }

  /** 供 planAutoMcpByLlm 使用的非流式补全。 */
  private String invokeNonStream(String systemPrompt, String userPrompt) throws Exception {
    HttpRequest req = HttpRequest.newBuilder()
        .uri(URI.create(trim(effectiveChatBaseUrl()) + "/chat/completions"))
        .header("Authorization", "Bearer " + dashscopeApiKey)
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(Map.of(
            "model", chatModel,
            "stream", false,
            "temperature", 0,
            "messages", List.of(
                Map.of("role", "system", "content", systemPrompt),
                Map.of("role", "user", "content", userPrompt)
            )
        )), StandardCharsets.UTF_8))
        .build();

    HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    if (resp.statusCode() < 200 || resp.statusCode() >= 300) return "{}";

    JsonNode root = objectMapper.readTree(resp.body());
    return root.path("choices").isArray() && root.path("choices").size() > 0
        ? root.path("choices").get(0).path("message").path("content").asText("{}")
        : "{}";
  }

  /** 当 @mcp 只写 serverKey 时：推断 config.tools 唯一 tool。 */
  private String resolveDefaultToolName(String userId, String serverKey) throws Exception {
    List<Map<String, Object>> rows = jdbcTemplate.queryForList(
        "SELECT config FROM mcp_servers WHERE userId = ? AND serverKey = ? AND enabled = 1 LIMIT 1",
        userId, serverKey);
    if (rows.isEmpty()) throw new IllegalArgumentException("Enabled MCP server not found: " + serverKey);
    JsonNode tools = objectMapper.readTree(Objects.toString(rows.get(0).get("config"), "{}")).path("tools");
    Iterator<String> it = tools.fieldNames();
    if (!it.hasNext()) throw new IllegalArgumentException("Tool name required: " + serverKey);
    String first = it.next();
    if (it.hasNext()) throw new IllegalArgumentException("Tool name required for multi-tool server: " + serverKey);
    return first;
  }

  /** 解析 args JSON（若缺失则返回空 map）。 */
  private Map<String, Object> parseArgs(String raw) {
    if (blank(raw)) return new HashMap<>();
    try {
      JsonNode node = objectMapper.readTree(raw);
      if (!node.isObject()) throw new IllegalArgumentException("MCP arguments must be JSON object");
      return objectMapper.convertValue(node, new TypeReference<Map<String, Object>>() {});
    } catch (Exception e) {
      throw new IllegalArgumentException("Invalid MCP arguments JSON");
    }
  }

  /** 从 SSE data JSON 中提取 delta.content。 */
  private String extractDelta(String json) {
    try {
      JsonNode choices = objectMapper.readTree(json).path("choices");
      if (!choices.isArray() || choices.isEmpty()) return "";
      return choices.get(0).path("delta").path("content").asText("");
    } catch (Exception e) {
      return "";
    }
  }

  /**
   * 抽取长期记忆并写回 user_memories：
   * 调模型（stream=false）要求输出 JSON 数组，然后写入并计算 embedding。
   */
  private void upsertMemoriesFromTurn(String userId, String userText, String assistantText) {
    try {
      if (blank(userText) && blank(assistantText)) return;
      List<Map<String, String>> items = extractMemories(userText, assistantText);

      for (Map<String, String> item : items) {
        String content = item.getOrDefault("content", "").trim();
        if (content.isEmpty()) continue;

        double[] emb = embed(content);
        String embJson = emb.length == 0 ? null : objectMapper.writeValueAsString(emb);

        jdbcTemplate.update(
            "INSERT INTO user_memories (id, userId, memoryType, content, embedding, source, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
            UUID.randomUUID().toString(),
            userId,
            item.getOrDefault("memoryType", "fact"),
            content,
            embJson,
            item.getOrDefault("source", "conversation")
        );
      }
    } catch (Exception ignored) {
      // 不让记忆写入失败影响主回答
    }
  }

  /** 模型抽取记忆：要求输出 JSON 数组。 */
  private List<Map<String, String>> extractMemories(String userText, String assistantText) throws Exception {
    String url = trim(effectiveChatBaseUrl()) + "/chat/completions";
    List<Map<String, Object>> memMsgs = List.of(
        Map.of("role", "system", "content",
            "你是长期记忆抽取器。输出 JSON 数组：[{memoryType,content,source}]，最多5条；无结果输出[]。"),
        Map.of("role", "user", "content", "请抽取长期记忆：\n" + userText + "\n\n" + assistantText)
    );

    Map<String, Object> payload = Map.of(
        "model", chatModel,
        "stream", false,
        "temperature", 0,
        "messages", memMsgs
    );

    HttpRequest req = HttpRequest.newBuilder()
        .uri(URI.create(url))
        .header("Authorization", "Bearer " + dashscopeApiKey)
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(payload), StandardCharsets.UTF_8))
        .build();

    HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    if (resp.statusCode() < 200 || resp.statusCode() >= 300) return List.of();

    JsonNode root = objectMapper.readTree(resp.body());
    String content = root.path("choices").isArray() && root.path("choices").size() > 0
        ? root.path("choices").get(0).path("message").path("content").asText("")
        : "";
    if (blank(content)) return List.of();

    try {
      JsonNode arr = objectMapper.readTree(content);
      if (!arr.isArray()) return List.of();
      List<Map<String, String>> out = new ArrayList<>();
      for (JsonNode n : arr) {
        String c = n.path("content").asText("").trim();
        if (c.isEmpty()) continue;
        out.add(Map.of(
            "memoryType", n.path("memoryType").asText("fact"),
            "content", c,
            "source", n.path("source").asText("conversation")
        ));
      }
      return out;
    } catch (Exception e) {
      return List.of();
    }
  }

  /** embedding：调用 DashScope embeddings。无 embeddings Key 则返回空数组。 */
  private double[] embed(String text) throws Exception {
    if (blank(dashscopeEmbeddingKey)) return new double[0];

    String url = trim(effectiveEmbeddingsBaseUrl()) + "/embeddings";
    HttpRequest req = HttpRequest.newBuilder()
        .uri(URI.create(url))
        .header("Authorization", "Bearer " + dashscopeEmbeddingKey)
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(objectMapper.writeValueAsString(
            Map.of("model", embeddingModel, "input", text)), StandardCharsets.UTF_8))
        .build();

    HttpResponse<String> resp = httpClient.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
    if (resp.statusCode() < 200 || resp.statusCode() >= 300) return new double[0];

    JsonNode emb = objectMapper.readTree(resp.body()).path("data").get(0).path("embedding");
    if (!emb.isArray()) return new double[0];

    double[] out = new double[emb.size()];
    for (int i = 0; i < emb.size(); i++) out[i] = emb.get(i).asDouble(0);
    return out;
  }

  private double[] parseEmb(String raw) {
    try {
      JsonNode arr = objectMapper.readTree(raw);
      if (!arr.isArray()) return new double[0];
      double[] out = new double[arr.size()];
      for (int i = 0; i < arr.size(); i++) out[i] = arr.get(i).asDouble(0);
      return out;
    } catch (Exception e) {
      return new double[0];
    }
  }

  /** 余弦相似度。 */
  private double cosine(double[] a, double[] b) {
    int n = Math.min(a.length, b.length);
    double dot = 0, na = 0, nb = 0;
    for (int i = 0; i < n; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    double d = Math.sqrt(na) * Math.sqrt(nb);
    return d == 0 ? 0 : dot / d;
  }

  /** 合并多个 prompt，自动去掉空段落。 */
  private String merge(String... prompts) {
    StringBuilder sb = new StringBuilder();
    for (String p : prompts) {
      if (!blank(p)) {
        if (sb.length() > 0) sb.append("\n\n");
        sb.append(p.trim());
      }
    }
    return sb.toString();
  }

  private String trim(String s) {
    if (s == null) return "";
    // 去掉末尾可能存在的 /（避免拼接时出现 //）
    return s.replaceAll("/$", "");
  }

  private boolean blank(String s) {
    return s == null || s.trim().isEmpty();
  }

  private long elapsedMs(long startNs) {
    return (System.nanoTime() - startNs) / 1_000_000;
  }

  private long elapsedMs(long startNs, long endNs) {
    return (endNs - startNs) / 1_000_000;
  }

  private String effectiveChatBaseUrl() {
    String raw = !blank(dashscopeBaseUrl) ? dashscopeBaseUrl.trim() : dashscopeCompatBaseUrl;
    String normalized = normalizeChatBaseUrl(raw);
    if (!Objects.equals(raw, normalized)) {
      log.warn("检测到不兼容的 DASHSCOPE_BASE_URL，已回退到兼容地址。rawBaseUrl={} normalizedBaseUrl={}", raw, normalized);
    }
    return normalized;
  }

  private String effectiveEmbeddingsBaseUrl() {
    if (!blank(dashscopeEmbeddingsBaseUrl)) return dashscopeEmbeddingsBaseUrl.trim();
    if (!blank(dashscopeBaseUrl)) return dashscopeBaseUrl.trim();
    return dashscopeCompatBaseUrl;
  }

  /** LLM 非 2xx 错误说明（简化版）。 */
  private String describeLlmHttpFailure(int statusCode) {
    return switch (statusCode) {
      case 401 -> "LLM HTTP 401：通义/DashScope 鉴权失败。请检查 Java 进程的 DASHSCOPE_API_KEY；若配置了 DASHSCOPE_BASE_URL，请使用 compatible-mode 地址并重启。";
      case 403 -> "LLM HTTP 403：模型/账号无权限或受限。";
      case 429 -> "LLM HTTP 429：请求过于频繁或配额不足。";
      default -> "LLM HTTP " + statusCode;
    };
  }

  private String normalizeChatBaseUrl(String raw) {
    if (blank(raw)) return dashscopeCompatBaseUrl;
    String lower = raw.trim().toLowerCase(Locale.ROOT);
    if (lower.contains("coding.dashscope.aliyuncs.com")) return dashscopeCompatBaseUrl;
    return raw.trim();
  }

  /** 一次 MCP 调用的解析结果。 */
  private record McpParsed(String serverKey, String toolName, Map<String, Object> arguments) {
  }
}
