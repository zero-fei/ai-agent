import { NextRequest, NextResponse } from 'next/server';
import { getChatStream } from '@/lib/llm';
import db from '@/lib/db';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

type IncomingMessage = {
  role: string;
  content: string;
};

type ChatRequestBody = {
  messages: IncomingMessage[];
  conversationId?: string | null;
};

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

type LlmMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const isLlmRole = (role: string): role is LlmMessage['role'] => role === 'user' || role === 'assistant';

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = getSession(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY === "your-api-key") {
      throw new Error("DashScope API key is not configured.");
    }

    const body = (await req.json()) as ChatRequestBody;
    const { messages } = body;
    let conversationId = body.conversationId ?? undefined;
    if (!messages) {
      throw new Error("Messages are required");
    }

    // If no conversationId, create a new conversation
    if (!conversationId) {
      conversationId = randomUUID();
      const firstUserMessage = messages.find((m) => m.role === 'user');
      const title = firstUserMessage ? firstUserMessage.content.substring(0, 50) : 'New Conversation';
      const stmt = db.prepare('INSERT INTO conversations (id, userId, title) VALUES (?, ?, ?)');
      stmt.run(conversationId, user.id, title);
    }

    // Save user message to DB
    const lastUserMessage = messages[messages.length - 1];
    const saveUserMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
    saveUserMsgStmt.run(randomUUID(), conversationId, lastUserMessage.role, lastUserMessage.content);

    const llmMessages: LlmMessage[] = messages
      .filter((m): m is IncomingMessage => typeof m?.role === 'string' && typeof m?.content === 'string')
      .filter((m): m is LlmMessage => isLlmRole(m.role))
      .map((m) => ({ role: m.role, content: m.content }));

    if (llmMessages.length === 0) {
      throw new Error('No valid messages for LLM.');
    }

    const stream = await getChatStream(llmMessages);

    let aiResponseContent = '';
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          aiResponseContent += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        
        // Save AI message to DB after stream is complete
        const saveAiMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
        saveAiMsgStmt.run(randomUUID(), conversationId, 'assistant', aiResponseContent);

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