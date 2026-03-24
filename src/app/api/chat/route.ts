import { NextRequest, NextResponse } from 'next/server';
import { getChatStream, getChatText } from '@/lib/llm';
import db from '@/lib/db';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';
import { buildRagSystemPrompt, isEmbeddingsConfigured, kbSearch } from '@/lib/rag';
import { callServerTool, listEnabledServers, listEnabledToolDefinitions, resolveDefaultToolName } from '@/lib/mcp';

export const dynamic = 'force-dynamic';

/**
 * Chat API（流式输出）。
 *
 * 职责：
 * - Cookie Session 鉴权
 * - 对话/消息落库（SQLite）
 * - 向客户端流式返回 LLM 输出
 * - RAG：从知识库检索上下文并注入到 system prompt
 */
type IncomingMessage = {
  role: string;
  content: string;
};

type ChatRequestBody = {
  messages: IncomingMessage[];
  conversationId?: string | null;
  collectionId?: string | null;
};

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

type LlmMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const isLlmRole = (role: string): role is LlmMessage['role'] => role === 'user' || role === 'assistant';

const MCP_CALL_WITH_TOOL_PATTERN = /@mcp\(\s*([^)]+?)\s*,\s*([^)]+?)\s*\)\s*(\{[\s\S]*\})?/i;
const MCP_CALL_SERVER_ONLY_PATTERN = /@mcp\(\s*([^)]+?)\s*\)\s*(\{[\s\S]*\})?/i;
const MCP_CALL_NL_PATTERN = /调用\s*([A-Za-z0-9_-]+)\s*(\{[\s\S]*\})?/i;

const parseMcpArgs = (argsRaw?: string) => {
  let args: Record<string, unknown> = {};
  if (argsRaw?.trim()) {
    const parsed = JSON.parse(argsRaw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('MCP arguments must be a JSON object.');
    }
    args = parsed as Record<string, unknown>;
  }
  return args;
};

const parseMcpToolCall = (content: string) => {
  const text = content.trim().replace(/[，。；]/g, ' ');

  const fullMatch = text.match(MCP_CALL_WITH_TOOL_PATTERN);
  if (fullMatch) {
    const [, serverKeyRaw, toolNameRaw, argsRaw] = fullMatch;
    const serverKey = (serverKeyRaw || '').trim();
    const toolName = (toolNameRaw || '').trim();
    if (!serverKey || !toolName) return null;
    return { serverKey, toolName, args: parseMcpArgs(argsRaw) };
  }

  const serverOnlyMatch = text.match(MCP_CALL_SERVER_ONLY_PATTERN);
  if (serverOnlyMatch) {
    const [, serverKeyRaw, argsRaw] = serverOnlyMatch;
    const serverKey = (serverKeyRaw || '').trim();
    if (!serverKey) return null;
    return { serverKey, toolName: null as string | null, args: parseMcpArgs(argsRaw) };
  }

  const nlMatch = text.match(MCP_CALL_NL_PATTERN);
  if (nlMatch) {
    const [, serverKeyRaw, argsRaw] = nlMatch;
    const serverKey = (serverKeyRaw || '').trim();
    if (!serverKey) return null;
    return { serverKey, toolName: null as string | null, args: parseMcpArgs(argsRaw) };
  }

  return null;
};

const extractFirstJsonObject = (text: string) => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const candidate = text.slice(start, end + 1);
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    return null;
  }
};

const containsToolTriggerWord = (text: string) => {
  const triggers = ['调用', '执行', '使用工具', '@mcp', 'tool', 'invoke', 'call'];
  const lower = text.toLowerCase();
  return triggers.some((t) => lower.includes(t.toLowerCase()));
};

const shouldAllowAutoToolCall = (userText: string, tools: Array<{ serverKey: string; toolName: string }>) => {
  const lower = userText.toLowerCase();
  const hasToolNameMatch = tools.some(
    (t) => lower.includes(t.serverKey.toLowerCase()) || lower.includes(t.toolName.toLowerCase())
  );
  if (!hasToolNameMatch) return false;

  // Fast path: user sends only serverKey/toolName-like short text, allow direct call.
  const compact = lower.replace(/\s+/g, '');
  const isDirectNameOnly = tools.some(
    (t) => compact === t.serverKey.toLowerCase() || compact === t.toolName.toLowerCase()
  );
  if (isDirectNameOnly) return true;

  // General path: still require explicit trigger words.
  return containsToolTriggerWord(userText);
};

const resolveDirectNameTrigger = (
  userText: string,
  tools: Array<{ serverKey: string; toolName: string }>
) => {
  const compact = userText.toLowerCase().replace(/\s+/g, '');
  const byServer = tools.find((t) => compact === t.serverKey.toLowerCase());
  if (byServer) return { serverKey: byServer.serverKey, toolName: byServer.toolName };
  const byTool = tools.find((t) => compact === t.toolName.toLowerCase());
  if (byTool) return { serverKey: byTool.serverKey, toolName: byTool.toolName };
  return null;
};

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    let tAfterAuth = 0;
    let tAfterSaveUserMsg = 0;
    let tAfterKbSearch = 0;
    let tAfterLlmStart = 0;
    let firstTokenAt = 0;
    let mcpPlanAction = 'none';
    let mcpPlanTool = '';

    const token = req.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = getSession(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    tAfterAuth = Date.now();

    if (!process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY === "your-api-key") {
      throw new Error("DashScope API key is not configured.");
    }

    const body = (await req.json()) as ChatRequestBody;
    const { messages, collectionId = null } = body;
    let conversationId = body.conversationId ?? undefined;
    if (!messages) {
      throw new Error("Messages are required");
    }

    // 若没有 conversationId，则创建新会话（title 取第一条用户消息的前 50 字）。
    if (!conversationId) {
      conversationId = randomUUID();
      const firstUserMessage = messages.find((m) => m.role === 'user');
      const title = firstUserMessage ? firstUserMessage.content.substring(0, 50) : 'New Conversation';
      const stmt = db.prepare('INSERT INTO conversations (id, userId, title) VALUES (?, ?, ?)');
      stmt.run(conversationId, user.id, title);
    }

    // 先保存用户消息，保证即使后续流式输出失败也有可追溯记录。
    const lastUserMessage = messages[messages.length - 1];
    const saveUserMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
    saveUserMsgStmt.run(randomUUID(), conversationId, lastUserMessage.role, lastUserMessage.content);
    tAfterSaveUserMsg = Date.now();

    const llmMessages: LlmMessage[] = messages
      .filter((m): m is IncomingMessage => typeof m?.role === 'string' && typeof m?.content === 'string')
      .filter((m): m is LlmMessage => isLlmRole(m.role))
      .map((m) => ({ role: m.role, content: m.content }));

    if (llmMessages.length === 0) {
      throw new Error('No valid messages for LLM.');
    }

    const latestUser = llmMessages[llmMessages.length - 1]!;
    const mcpCall = parseMcpToolCall(latestUser.content);

    if (mcpCall) {
      mcpPlanAction = 'manual_call';
      const toolName = mcpCall.toolName || resolveDefaultToolName({ userId: user.id, serverKey: mcpCall.serverKey });
      mcpPlanTool = `${mcpCall.serverKey}/${toolName}`;
      const called = await callServerTool({
        userId: user.id,
        serverKey: mcpCall.serverKey,
        toolName,
        arguments: mcpCall.args,
      });

      const resultText = JSON.stringify(called.result, null, 2);
      const toolAwareMessages: LlmMessage[] = [
        ...llmMessages,
        { role: 'assistant', content: `[MCP工具 ${mcpCall.serverKey}/${toolName} 原始结果]\n${resultText}` },
        {
          role: 'user',
          content:
            '请基于上面的 MCP 工具结果给出最终回答。要求：1) 先给结论；2) 关键字段用简洁列表；3) 如果结果为空或异常，明确说明。',
        },
      ];
      const toolAwareSystemPrompt = [
        '你是一个严谨助手。',
        '你会先调用 MCP 工具，再基于工具结果回答用户。',
        '当前工具结果由系统注入，请优先依据该结果，不要编造。',
      ].join('\n');

      const stream = await getChatStream(toolAwareMessages, { systemPrompt: toolAwareSystemPrompt });
      tAfterLlmStart = Date.now();

      let aiResponseContent = '';
      const encoder = new TextEncoder();
      const readableStream = new ReadableStream({
        async start(controller) {
          for await (const chunk of stream) {
            if (!firstTokenAt) firstTokenAt = Date.now();
            aiResponseContent += chunk;
            controller.enqueue(encoder.encode(chunk));
          }

          const saveAiMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
          saveAiMsgStmt.run(randomUUID(), conversationId, 'assistant', aiResponseContent);
          controller.close();
        },
      });

      return new Response(readableStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Conversation-Id': conversationId,
          'X-MCP-Plan-Action': mcpPlanAction,
          'X-MCP-Plan-Tool': mcpPlanTool,
        },
      });
    }

    // Agent tool-selection phase: model decides whether to call MCP tool.
    const toolDefs = listEnabledToolDefinitions(user.id);
    if (toolDefs.length > 0) {
      const directTrigger = resolveDirectNameTrigger(latestUser.content, toolDefs);
      if (directTrigger) {
        mcpPlanAction = 'direct_name_call';
        mcpPlanTool = `${directTrigger.serverKey}/${directTrigger.toolName}`;
        const called = await callServerTool({
          userId: user.id,
          serverKey: directTrigger.serverKey,
          toolName: directTrigger.toolName,
          arguments: {},
        });
        const resultText = JSON.stringify(called.result, null, 2);
        const toolAwareMessages: LlmMessage[] = [
          ...llmMessages,
          { role: 'assistant', content: `[MCP工具 ${directTrigger.serverKey}/${directTrigger.toolName} 原始结果]\n${resultText}` },
          {
            role: 'user',
            content:
              '请基于上面的 MCP 工具结果给出最终回答。要求：1) 先给结论；2) 关键字段用简洁列表；3) 如果结果为空或异常，明确说明。',
          },
        ];
        const stream = await getChatStream(toolAwareMessages, {
          systemPrompt: '你是一个严谨助手。你会先调用工具，再基于工具结果回答；不要编造。',
        });
        tAfterLlmStart = Date.now();

        let aiResponseContent = '';
        const encoder = new TextEncoder();
        const readableStream = new ReadableStream({
          async start(controller) {
            for await (const chunk of stream) {
              if (!firstTokenAt) firstTokenAt = Date.now();
              aiResponseContent += chunk;
              controller.enqueue(encoder.encode(chunk));
            }

            const saveAiMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
            saveAiMsgStmt.run(randomUUID(), conversationId, 'assistant', aiResponseContent);
            controller.close();
          },
        });

        return new Response(readableStream, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Conversation-Id': conversationId,
            'X-MCP-Plan-Action': mcpPlanAction,
            'X-MCP-Plan-Tool': mcpPlanTool,
          },
        });
      }

      const autoToolAllowed = shouldAllowAutoToolCall(latestUser.content, toolDefs);
      const plannerPrompt = [
        '你是工具规划器。根据用户最后一句话判断是否需要调用工具。',
        '可用工具列表：',
        ...toolDefs.map((t) => `- ${t.serverKey}/${t.toolName}: ${t.description}`),
        '严格规则：如果用户没有明确表达“调用/执行/使用工具”意图，必须返回 {"action":"no_tool"}。',
        '严格规则：如果用户问题是闲聊、夸赞、润色、泛问答，必须返回 {"action":"no_tool"}。',
        '只允许输出 JSON，不要输出其他内容。',
        '格式一（需要调用工具）: {"action":"call_tool","serverKey":"...","toolName":"...","arguments":{}}',
        '格式二（无需调用）: {"action":"no_tool"}',
      ].join('\n');

      const plannerOutput = await getChatText(llmMessages, { systemPrompt: plannerPrompt });
      const plan = extractFirstJsonObject(plannerOutput);
      if (process.env.NODE_ENV !== 'production') {
        console.log('[mcp-planner]', {
          userId: user.id,
          autoToolAllowed,
          plannerOutput,
          parsedPlan: plan,
        });
      }
      if (plan?.action === 'call_tool' && autoToolAllowed) {
        mcpPlanAction = 'call_tool';
        const serverKey = typeof plan.serverKey === 'string' ? plan.serverKey : '';
        const toolName = typeof plan.toolName === 'string' ? plan.toolName : '';
        const args =
          plan.arguments && typeof plan.arguments === 'object' && !Array.isArray(plan.arguments)
            ? (plan.arguments as Record<string, unknown>)
            : {};

        if (serverKey && toolName) {
          mcpPlanTool = `${serverKey}/${toolName}`;
          const called = await callServerTool({
            userId: user.id,
            serverKey,
            toolName,
            arguments: args,
          });
          const resultText = JSON.stringify(called.result, null, 2);
          const toolAwareMessages: LlmMessage[] = [
            ...llmMessages,
            { role: 'assistant', content: `[MCP工具 ${serverKey}/${toolName} 原始结果]\n${resultText}` },
            {
              role: 'user',
              content:
                '请基于上面的 MCP 工具结果给出最终回答。要求：1) 先给结论；2) 关键字段用简洁列表；3) 如果结果为空或异常，明确说明。',
            },
          ];
          const stream = await getChatStream(toolAwareMessages, {
            systemPrompt: '你是一个严谨助手。你会先调用工具，再基于工具结果回答；不要编造。',
          });
          tAfterLlmStart = Date.now();

          let aiResponseContent = '';
          const encoder = new TextEncoder();
          const readableStream = new ReadableStream({
            async start(controller) {
              for await (const chunk of stream) {
                if (!firstTokenAt) firstTokenAt = Date.now();
                aiResponseContent += chunk;
                controller.enqueue(encoder.encode(chunk));
              }

              const saveAiMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
              saveAiMsgStmt.run(randomUUID(), conversationId, 'assistant', aiResponseContent);
              controller.close();
            },
          });

          return new Response(readableStream, {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'X-Conversation-Id': conversationId,
              'X-MCP-Plan-Action': mcpPlanAction,
              'X-MCP-Plan-Tool': mcpPlanTool,
            },
          });
        }
      }
      if (plan?.action === 'call_tool' && !autoToolAllowed) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[mcp-planner] blocked by guardrail', {
            userId: user.id,
            latestUser: latestUser.content,
          });
        }
      }
      if (!mcpPlanAction || mcpPlanAction === 'none') {
        mcpPlanAction = 'no_tool';
      }
    }

    // RAG 检索：
    // - 支持客户端透传 collectionId，用于“每个会话选择知识库/集合”
    // - 未配置 Embeddings key 时直接跳过检索，避免影响主对话链路
    const hits = isEmbeddingsConfigured()
      ? await kbSearch({ userId: user.id, collectionId, query: latestUser.content, topK: 5 })
      : [];
    tAfterKbSearch = Date.now();
    const ragSystemPrompt = buildRagSystemPrompt({
      query: latestUser.content,
      hits: hits.map((h) => ({ content: h.content, score: h.score })),
    });
    const enabledMcpServers = listEnabledServers(user.id);
    const mcpInstruction = enabledMcpServers.length
      ? [
          '可用 MCP Servers（已启用）：',
          ...enabledMcpServers.map((s) => `- ${s.serverKey}${s.endpoint ? ` (${s.endpoint})` : ''}`),
          '如果需要调用 MCP 工具，请使用严格格式：@mcp(serverKey,toolName) {"arg":"value"}',
          '简化调用也支持：@mcp(serverKey) {} 或 调用serverKey {}（仅当该 server 只有一个工具时）',
          '如果不是显式 MCP 调用，就按正常对话回答。',
        ].join('\n')
      : null;
    const mergedSystemPrompt = [ragSystemPrompt, mcpInstruction].filter(Boolean).join('\n\n') || undefined;

    // 通过覆盖 system prompt 注入检索上下文（不改变前端消息结构）。
    const stream = await getChatStream(llmMessages, { systemPrompt: mergedSystemPrompt });
    tAfterLlmStart = Date.now();

    let aiResponseContent = '';
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (!firstTokenAt) firstTokenAt = Date.now();
          aiResponseContent += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        
        // 流式输出完成后再保存 AI 回复（单条记录保存完整内容）。
        const saveAiMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
        saveAiMsgStmt.run(randomUUID(), conversationId, 'assistant', aiResponseContent);

        const tDone = Date.now();
        console.log(
          `[chat-timing] total=${tDone - t0}ms auth=${tAfterAuth - t0}ms saveUser=${tAfterSaveUserMsg - tAfterAuth}ms kb=${tAfterKbSearch - tAfterSaveUserMsg}ms llmStart=${tAfterLlmStart - tAfterKbSearch}ms firstToken=${firstTokenAt ? firstTokenAt - t0 : -1}ms streamAndSave=${tDone - (firstTokenAt || tAfterLlmStart)}ms hits=${hits.length}`
        );

        controller.close();
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Conversation-Id': conversationId,
        'X-MCP-Plan-Action': mcpPlanAction,
        'X-MCP-Plan-Tool': mcpPlanTool,
      },
    });

  } catch (error: unknown) {
    console.error("[API] Chat route error:", error);
    return new NextResponse(JSON.stringify({ error: getErrorMessage(error) || 'An unknown error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}