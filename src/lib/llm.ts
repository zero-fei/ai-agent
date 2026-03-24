import { ChatOpenAI } from '@langchain/openai';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

/**
 * LLM 流式输出封装。
 *
 * 本模块集中管理：
 * - 模型选择 / baseURL / API key
 * - prompt 结构（system + history + latest input）
 * - 以 async iterable 的方式输出流（供 API 路由消费）
 *
 * 这里将输入消息 role 限制为 `user` / `assistant`，避免前端传入任意 role 造成提示注入。
 * 如果确实需要把 `system` 消息加入历史，请在这里扩展类型与映射逻辑。
 */
interface Message {
  role: 'user' | 'assistant';
  content: string;
}

type ChatStreamOptions = {
  /** 可选：覆盖 system prompt，RAG 会用它注入检索到的上下文。 */
  systemPrompt?: string;
};

const buildModel = (streaming: boolean) =>
  new ChatOpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    modelName: "qwen3.5-plus",
    configuration: {
      baseURL: process.env.DASHSCOPE_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1',
    },
    streaming,
    modelKwargs: {
      enable_thinking: false,
    },
  });

const defaultSystemPrompt = `
    你是一个专门用于处理和整合历史记忆的AI助手。你的核心任务是提取与用户偏好、个人信息、业务背景相关的内容。
    输出不要展示从什么知识库、哪个片段、以及mcp调用的相关信息，输出整合后的内容。
    `;

const buildPromptAndInput = (messages: Message[], options: ChatStreamOptions = {}) => {
  const rawSystemPrompt = options.systemPrompt
    ? `${defaultSystemPrompt}\n\n${options.systemPrompt}`
    : defaultSystemPrompt;
  const safeSystemPrompt = rawSystemPrompt.replace(/{/g, '{{').replace(/}/g, '}}');

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", safeSystemPrompt],
    new MessagesPlaceholder("chat_history"),
    ["human", "{input}"],
  ]);

  const chatHistory = messages.slice(0, -1).map((m) =>
    m.role === 'user' ? new HumanMessage(m.content) : new AIMessage(m.content)
  );
  const latestMessage = messages[messages.length - 1];
  return {
    prompt,
    input: {
      chat_history: chatHistory,
      input: latestMessage.content,
    },
  };
};

/**
 * Creates and returns a stream of responses from the language model.
 * @param messages The chat history messages.
 * @returns A readable stream of the language model's response.
 */
export async function getChatStream(messages: Message[], options: ChatStreamOptions = {}) {
  const model = buildModel(true);
  const { prompt, input } = buildPromptAndInput(messages, options);
  const outputParser = new StringOutputParser();
  const chain = prompt.pipe(model).pipe(outputParser);
  return await chain.stream(input);
}

export async function getChatText(messages: Message[], options: ChatStreamOptions = {}) {
  const model = buildModel(false);
  const { prompt, input } = buildPromptAndInput(messages, options);
  const outputParser = new StringOutputParser();
  const chain = prompt.pipe(model).pipe(outputParser);
  const result = await chain.invoke(input);
  return result;
}