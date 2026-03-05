import { NextRequest, NextResponse } from 'next/server';
import { callLLM } from '@/lib/llm';

export async function POST(req: NextRequest) {
  try {
    if (!process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY === "your-api-key") {
      return NextResponse.json({ error: "DashScope API key is not configured. Please set it in .env.local and restart the server." }, { status: 500 });
    }

    const { messages } = await req.json();

    // 可以在这里添加默认的系统提示
    const systemPrompt = { role: 'system', content: 'You are a helpful assistant.' };
    const allMessages = [systemPrompt, ...messages];

    const result = await callLLM(allMessages);

    if (result.success) {
      return NextResponse.json({ reply: result.content, usage: result.usage });
    } else {
      console.error("LLM call failed:", result.error);
      return NextResponse.json({ error: `LLM Error: ${result.error}` }, { status: 500 });
    }
  } catch (error: any) {
    console.error("API route error:", error);
    return NextResponse.json({ error: error.message || 'An unknown error occurred in the API route.' }, { status: 500 });
  }
}