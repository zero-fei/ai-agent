package com.agentservice.service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.graalvm.polyglot.Context;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * MCP 工具执行服务。
 *
 * <p>执行优先级：</p>
 * <ol>
 *   <li>如果 {@code config.runtime == "node"} 且 {@code config.tools[toolName]} 是 JS 代码：使用 GraalJS 本地执行</li>
 *   <li>否则如果配置了 {@code MCP_DIRECT_BRIDGE_URL}：先 POST 到桥接地址（失败则 fallback）</li>
 *   <li>否则使用当前 server 的 {@code endpoint}</li>
 * </ol>
 */
@Service
public class McpToolService {

  /** 执行/解析工具的最长时间（毫秒）。 */
  private static final long TOOL_TIMEOUT_MS = 2000;

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;
  private final HttpClient httpClient;

  /** 与 Node activeOps 类似：同一 user 同一 tool 并发调用拒绝。 */
  private final ConcurrentHashMap<String, Boolean> activeLocks = new ConcurrentHashMap<>();

  @Value("${MCP_DIRECT_BRIDGE_URL:}")
  private String mcpDirectBridgeUrl;

  public record EnabledServer(String id, String serverKey, String endpoint, String configJson) {
  }

  public McpToolService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
    this.httpClient = HttpClient.newHttpClient();
  }

  /**
   * 对外统一入口：鉴权 → 查启用中的 server → 加锁 → 写日志 → 执行 → 更新日志。
   *
   * @return {@code { "result": <工具返回值> }}，供上层序列化
   */
  public Map<String, Object> callTool(String authorizationHeader, String serverKey, String toolName,
      Map<String, Object> arguments) throws Exception {

    String token = extractBearerToken(authorizationHeader);
    if (token == null) throw new IllegalArgumentException("Unauthorized");

    String userId = getUserIdByToken(token).orElseThrow(() -> new IllegalArgumentException("Unauthorized"));

    EnabledServer server = loadEnabledServer(userId, serverKey)
        .orElseThrow(() -> new IllegalArgumentException("Enabled MCP server not found: " + serverKey));

    String lockKey = userId + ":" + server.id() + ":tool:" + toolName;
    if (activeLocks.putIfAbsent(lockKey, Boolean.TRUE) != null) {
      throw new IllegalStateException("Tool call already in progress: " + toolName);
    }

    String logId = null;
    try {
      logId = UUID.randomUUID().toString();
      String metaJson = toJsonQuietly(Map.of("arguments", arguments));
      jdbcTemplate.update(
          "INSERT INTO mcp_logs (id, userId, serverId, action, status, message, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
          logId, userId, server.id(), "tool_call:" + toolName, "running", "Tool call started", metaJson);

      Object result = executeTool(server, userId, serverKey, toolName, arguments);

      jdbcTemplate.update("UPDATE mcp_logs SET status = ?, message = ? WHERE id = ?",
          "ok", "Tool call succeeded", logId);

      return Map.of("result", result);
    } catch (Exception e) {
      String msg = e.getMessage() != null ? e.getMessage() : String.valueOf(e);
      if (logId != null) {
        jdbcTemplate.update("UPDATE mcp_logs SET status = ?, message = ? WHERE id = ?",
            "error", "Tool call failed: " + msg, logId);
      }
      throw e;
    } finally {
      activeLocks.remove(lockKey);
    }
  }

  /** 按优先级选择执行路径：本地 JS → 直连桥 → endpoint。 */
  private Object executeTool(EnabledServer server, String userId, String serverKey, String toolName, Map<String, Object> arguments)
      throws Exception {

    // config.runtime == node -> local js tool code
    Map<String, Object> cfg = parseConfig(server.configJson());
    String runtime = cfg.get("runtime") != null ? String.valueOf(cfg.get("runtime")) : null;
    Object toolsObj = cfg.get("tools");

    if ("node".equals(runtime) && toolsObj instanceof Map<?, ?> toolsMap) {
      Object codeObj = toolsMap.get(toolName);
      if (codeObj instanceof String code && !code.trim().isEmpty()) {
        return executeNodeTool(code, arguments, serverKey, toolName);
      }
    }

    // MCP direct bridge
    String bridgeUrl = mcpDirectBridgeUrl != null && !mcpDirectBridgeUrl.trim().isEmpty()
        ? mcpDirectBridgeUrl.trim()
        : null;
    if (bridgeUrl != null) {
      try {
        Object parsed = postJsonAndParse(bridgeUrl,
            Map.of("serverKey", serverKey, "toolName", toolName, "arguments", arguments));
        return parsed;
      } catch (Exception ignored) {
        // fallback below
      }
    }

    // endpoint fallback
    if (server.endpoint() == null || server.endpoint().trim().isEmpty()) {
      String msg = bridgeUrl != null
          ? "MCP direct bridge failed and endpoint is not configured: " + serverKey
          : "MCP direct bridge is not configured and endpoint is not configured: " + serverKey;
      throw new IllegalStateException(msg);
    }

    return postJsonAndParse(server.endpoint(),
        Map.of("serverKey", serverKey, "toolName", toolName, "arguments", arguments));
  }

  /**
   * 执行本地 JS：把 {@code args} 传给用户代码，通过 hostBridge.resolve/reject 返回结果。
   */
  private Object executeNodeTool(String localToolCode, Map<String, Object> arguments, String serverKey, String toolName) throws Exception {
    CompletableFuture<Object> future = new CompletableFuture<>();

    Object hostBridge = new Object() {
      @SuppressWarnings("unused")
      public void resolve(org.graalvm.polyglot.Value v) {
        future.complete(convertGraalValue(v));
      }

      @SuppressWarnings("unused")
      public void reject(org.graalvm.polyglot.Value v) {
        String msg = v == null ? "unknown error" : String.valueOf(v.toString());
        future.completeExceptionally(new RuntimeException(msg));
      }
    };

    try (Context context = Context.newBuilder("js")
        .allowAllAccess(true)
        .option("engine.ExecutionTimeLimit", String.valueOf(TOOL_TIMEOUT_MS))
        .build()) {

      context.getBindings("js").putMember("args", arguments);
      context.getBindings("js").putMember("serverKey", serverKey);
      context.getBindings("js").putMember("toolName", toolName);
      context.getBindings("js").putMember("hostBridge", hostBridge);

      String wrapped = "(async function() {"
          + "  const tool = async (args) => { " + localToolCode + " };"
          + "  return await tool(args);"
          + "})()"
          + ".then((r) => hostBridge.resolve(r))"
          + ".catch((e) => hostBridge.reject(e));";

      context.eval("js", wrapped);

      try {
        return future.get(TOOL_TIMEOUT_MS, TimeUnit.MILLISECONDS);
      } catch (TimeoutException e) {
        throw new TimeoutException("Tool execution timed out after " + TOOL_TIMEOUT_MS + "ms");
      }
    }
  }

  /** 把 Graal 值转成 Java 常用类型。 */
  private Object convertGraalValue(org.graalvm.polyglot.Value v) {
    if (v == null || v.isNull()) return null;
    if (v.isBoolean()) return v.asBoolean();
    if (v.fitsInInt()) return v.asInt();
    if (v.fitsInLong()) return v.asLong();
    if (v.isNumber()) return v.asDouble();
    if (v.isString()) return v.asString();

    if (v.hasArrayElements()) {
      List<Object> out = new ArrayList<>();
      long size = v.getArraySize();
      for (int i = 0; i < size; i++) out.add(convertGraalValue(v.getArrayElement(i)));
      return out;
    }

    if (v.hasMembers()) {
      Map<String, Object> out = new java.util.HashMap<>();
      for (String key : v.getMemberKeys()) out.put(key, convertGraalValue(v.getMember(key)));
      return out;
    }

    try {
      return objectMapper.readValue(v.toString(), new TypeReference<Object>() {});
    } catch (Exception e) {
      return v.toString();
    }
  }

  private Map<String, Object> parseConfig(String configJson) {
    if (configJson == null || configJson.trim().isEmpty()) return Map.of();
    try {
      return objectMapper.readValue(configJson, new TypeReference<Map<String, Object>>() {});
    } catch (Exception e) {
      return Map.of();
    }
  }

  /** POST application/json，2xx 则解析 JSON；失败返回原字符串。 */
  private Object postJsonAndParse(String url, Map<String, Object> body) throws Exception {
    String json = objectMapper.writeValueAsString(body);
    HttpRequest req = HttpRequest.newBuilder()
        .uri(URI.create(url))
        .header("Content-Type", "application/json")
        .POST(HttpRequest.BodyPublishers.ofString(json))
        .build();

    HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
    String text = res.body() == null ? "" : res.body();

    if (res.statusCode() < 200 || res.statusCode() >= 300) {
      throw new IllegalStateException("MCP call failed with HTTP " + res.statusCode() + ": " + text);
    }

    try {
      return objectMapper.readValue(text, Object.class);
    } catch (Exception e) {
      return text;
    }
  }

  private Optional<String> getUserIdByToken(String token) {
    String now = Instant.now().toString();
    try {
      String userId = jdbcTemplate.queryForObject(
          "SELECT userId FROM sessions WHERE token = ? AND expiresAt > ?",
          String.class, token, now);
      return Optional.ofNullable(userId);
    } catch (Exception e) {
      return Optional.empty();
    }
  }

  private Optional<EnabledServer> loadEnabledServer(String userId, String serverKey) {
    try {
      List<Map<String, Object>> rows = jdbcTemplate.queryForList(
          "SELECT id, serverKey, endpoint, config FROM mcp_servers WHERE userId = ? AND serverKey = ? AND enabled = 1 ORDER BY createdAt DESC LIMIT 1",
          userId, serverKey);
      if (rows.isEmpty()) return Optional.empty();
      Map<String, Object> r = rows.get(0);
      return Optional.of(new EnabledServer(
          String.valueOf(r.get("id")),
          String.valueOf(r.get("serverKey")),
          r.get("endpoint") == null ? null : String.valueOf(r.get("endpoint")),
          r.get("config") == null ? null : String.valueOf(r.get("config"))));
    } catch (Exception e) {
      return Optional.empty();
    }
  }

  private String extractBearerToken(String authorizationHeader) {
    if (authorizationHeader == null) return null;
    String h = authorizationHeader.trim();
    if (!h.toLowerCase().startsWith("bearer ")) return null;
    return h.substring(7).trim();
  }

  private String toJsonQuietly(Object obj) {
    try {
      return objectMapper.writeValueAsString(obj);
    } catch (Exception e) {
      return null;
    }
  }
}

