import { NextRequest, NextResponse } from 'next/server';
import { getChatStream } from '@/lib/llm';
import db from '@/lib/db';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';
import { buildRagSystemPrompt, kbSearch } from '@/lib/rag';

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

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    let tAfterAuth = 0;
    let tAfterSaveUserMsg = 0;
    let tAfterKbSearch = 0;
    let tAfterLlmStart = 0;
    let firstTokenAt = 0;

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
    // RAG 检索：
    // - 支持客户端透传 collectionId，用于“每个会话选择知识库/集合”
    const hits = await kbSearch({ userId: user.id, collectionId, query: latestUser.content, topK: 5 });
    tAfterKbSearch = Date.now();
    const ragSystemPrompt = buildRagSystemPrompt({
      query: latestUser.content,
      hits: hits.map((h) => ({ content: h.content, score: h.score })),
    });

    // 通过覆盖 system prompt 注入检索上下文（不改变前端消息结构）。
    const stream = await getChatStream(llmMessages, { systemPrompt: ragSystemPrompt ?? undefined });
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