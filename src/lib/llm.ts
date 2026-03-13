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

/**
 * Creates and returns a stream of responses from the language model.
 * @param messages The chat history messages.
 * @returns A readable stream of the language model's response.
 */
export async function getChatStream(messages: Message[], options: ChatStreamOptions = {}) {
  // DashScope 提供 OpenAI 兼容接口，因此这里通过 baseURL 进行适配。
  const model = new ChatOpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    modelName: "qwen3.5-plus",
    configuration: {
      baseURL: process.env.DASHSCOPE_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1',
    },
    streaming: true,
  });

 const  default_system_prompt = `
    你是一个专门用于处理和整合历史记忆的AI助手。你的核心任务是提取与用户偏好、个人信息、业务背景相关的内容。
    输出不要展示从什么知识库、哪个片段的相关信息，输出整合后的内容。
    `

  // Prompt 结构：
  // - system：全局指令（可被 RAG 覆盖）
  // - chat_history：历史对话
  // - human input：最新一条用户消息
  //
  // LangChain 的模板语法会把单独的 "{" / "}" 当作占位符分隔符。
  // 为了避免 RAG 注入的 systemPrompt 或用户内容里出现单个大括号导致
  // “Single '}' in template” 报错，这里对 systemPrompt 中的所有大括号进行转义。
  const rawSystemPrompt = options.systemPrompt || default_system_prompt;
  const safeSystemPrompt = rawSystemPrompt.replace(/{/g, '{{').replace(/}/g, '}}');

  const prompt = ChatPromptTemplate.fromMessages([
    ["system", safeSystemPrompt],
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