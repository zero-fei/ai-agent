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
    【1!滤规则】
    1.必须剔除所有关于“系统功能”、“支持工具列表”、“API接口”、“调用方式“的描述。
    2.必须剔除与工具调用结果(如“工具返回了...“)相关的内容。
    3.必须剔除重复内容。
    4.必须剔除与当前提问无关的内容。
    【输出要求】
    仅输出经过上述规则清洗后的核心记忆信息，
    -如果清洗后没有剩余有效信息，或者所有信息都与提问无关，必须输出:None`

  // Prompt 结构：
  // - system：全局指令（可被 RAG 覆盖）
  // - chat_history：历史对话
  // - human input：最新一条用户消息
  const prompt = ChatPromptTemplate.fromMessages([
    ["system", options.systemPrompt || default_system_prompt],
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