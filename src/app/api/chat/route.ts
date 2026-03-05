import { NextRequest, NextResponse } from 'next/server';
import { getChatStream } from '@/lib/llm';
import db from '@/lib/db';
import { randomUUID } from 'crypto';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    if (!process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY === "your-api-key") {
      throw new Error("DashScope API key is not configured.");
    }

    let { messages, conversationId } = await req.json();
    if (!messages) {
      throw new Error("Messages are required");
    }

    // If no conversationId, create a new conversation
    if (!conversationId) {
      conversationId = randomUUID();
      const firstUserMessage = messages.find((m: any) => m.role === 'user');
      const title = firstUserMessage ? firstUserMessage.content.substring(0, 50) : 'New Conversation';
      const stmt = db.prepare('INSERT INTO conversations (id, title) VALUES (?, ?)');
      stmt.run(conversationId, title);
    }

    // Save user message to DB
    const lastUserMessage = messages[messages.length - 1];
    const saveUserMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
    saveUserMsgStmt.run(randomUUID(), conversationId, lastUserMessage.role, lastUserMessage.content);

    const stream = await getChatStream(messages);

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
        'X-Conversation-Id': conversationId, // Send back the conversationId
      },
    });

  } catch (error: any) {
    console.error("[API] Chat route error:", error);
    return new NextResponse(JSON.stringify({ error: error.message || 'An unknown error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}