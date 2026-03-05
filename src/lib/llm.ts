import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Creates and returns a stream of responses from the language model.
 * @param messages The chat history messages.
 * @returns A readable stream of the language model's response.
 */
export async function getChatStream(messages: Message[]) {
  const model = new ChatOpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    modelName: "qwen3.5-plus",
    configuration: {
      baseURL: process.env.DASHSCOPE_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1',
    },
    streaming: true,
  });

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", "You are a helpful assistant."],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);

  const outputParser = new StringOutputParser();
  const chain = prompt.pipe(model).pipe(outputParser);

  const chatHistory = messages.slice(0, -1).map((m) =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  );
  const latestMessage = messages[messages.length - 1];

  return await chain.stream({
    chat_history: chatHistory,
    input: latestMessage.content,
  });
}