import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, AIMessage, BaseMessage } from "@langchain/core/messages";

// 定义消息类型接口
interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// 使用单例模式创建和管理LLM实例
let llmInstance: ChatOpenAI | null = null;

function getLLM(): ChatOpenAI {
  if (!llmInstance) {
    llmInstance = new ChatOpenAI({
      apiKey: process.env.DASHSCOPE_API_KEY, // 从环境变量读取API Key
      modelName: "qwen3.5-plus", // 默认模型
      configuration: {
        baseURL: process.env.DASHSCOPE_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1', // 从环境变量读取Base URL
      }
    });
  }
  return llmInstance;
}

/**
 * 调用大语言模型
 * @param messages 对话历史消息数组
 * @returns 包含调用结果的对象
 */
export async function callLLM(messages: Message[]) {
  try {
    const llm = getLLM();
    
    // 将传入的消息数组转换为LangChain的BaseMessage对象数组
    const langChainMessages: BaseMessage[] = messages.map(msg => {
      if (msg.role === 'system') {
        return new SystemMessage(msg.content);
      } else if (msg.role === 'user') {
        return new HumanMessage(msg.content);
      } else { // 'assistant'
        return new AIMessage(msg.content);
      }
    });

    const response = await llm.invoke(langChainMessages);

    return {
      success: true,
      content: response.content,
      usage: response.usage_metadata,
    };
  } catch (error: any) {
    console.error("大模型调用失败：", error);
    return {
      success: false,
      error: error.message || "调用大模型时发生错误",
    };
  }
}