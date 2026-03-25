import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { OpenAIEmbeddings } from '@langchain/openai';
import { randomUUID } from 'crypto';
import db from '@/lib/db';
import { isEmbeddingsConfigured } from '@/lib/rag';

export type MemoryItem = {
  memoryType: string;
  content: string;
  source?: string | null;
};

type MemoryRow = {
  id: string;
  userId: string;
  memoryType: string;
  content: string;
  embedding: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

const MODEL_NAME = 'qwen3.5-plus';

// Guardrails (tune later)
const MAX_ITEMS_TO_EXTRACT = 5;
const MAX_ITEMS_TO_INJECT = 5;
const DEDUP_SIMILARITY_THRESHOLD = 0.86;
// Memory injection gate.
// Identity-style questions may yield relatively low cosine similarity with the stored
// memory sentence, so keep this threshold permissive to avoid "no memories injected".
const INJECT_SCORE_THRESHOLD = 0.35;

const getChatModel = () => {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey || apiKey === 'your-api-key') {
    throw new Error('DashScope API key is not configured.');
  }

  return new ChatOpenAI({
    apiKey,
    modelName: MODEL_NAME,
    configuration: {
      baseURL: process.env.DASHSCOPE_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1',
    },
    modelKwargs: { enable_thinking: false },
    temperature: 0,
  });
};

const getEmbeddingsClient = () => {
  const apiKey = process.env.DASHSCOPE_API_KEY_EMBEDDINGS;
  if (!apiKey || apiKey === 'your-api-key') {
    throw new Error('DashScope API key is not configured for embeddings.');
  }

  return new OpenAIEmbeddings({
    apiKey,
    model: process.env.DASHSCOPE_EMBEDDING_MODEL || 'text-embedding-v2',
    configuration: {
      baseURL:
        process.env.DASHSCOPE_EMBEDDINGS_BASE_URL ||
        process.env.DASHSCOPE_BASE_URL ||
        'https://dashscope.aliyuncs.com/compatible-mode/v1',
    },
  });
};

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

function safeJsonParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Try to recover if model wraps JSON in extra text.
    const start = raw.indexOf('[');
    const end = raw.lastIndexOf(']');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1)) as T;
      } catch {
        // ignore
      }
    }
    return null;
  }
}

export async function extractMemoriesFromTurn(params: {
  userText: string;
  assistantText: string;
  maxItems?: number;
}): Promise<MemoryItem[]> {
  const { userText, assistantText, maxItems = MAX_ITEMS_TO_EXTRACT } = params;
  const combined = `${userText}\n\n${assistantText}`;
  if (!combined.trim()) return [];

  const planner = getChatModel();
  const resp = await planner.invoke([
    new SystemMessage(
      [
        '你是一个“长期记忆”抽取器。',
        '目标：从对话中提取对用户“跨会话仍然成立”的记忆。',
        '只提取稳定偏好、个人身份/约束、业务背景/目标、重要事实。',
        '不要提取：一次性事件、无关闲聊、过于敏感的秘密、无法验证的猜测。',
        '输出必须是 JSON 数组，数组元素字段：{ memoryType, content, source }。',
        'memoryType 建议使用：preference(偏好)、personal(个人)、business(业务)、fact(事实)。',
        `最多输出 ${maxItems} 条；若没有合适记忆请输出空数组 []。`,
      ].join('\n')
    ),
    new HumanMessage(
      [
        '请抽取记忆。',
        '输入（userText + assistantText）：',
        combined,
      ].join('\n')
    ),
  ]);

  const content = resp?.content ?? '';
  const parsed = safeJsonParse<MemoryItem[]>(content);
  if (!parsed) return [];

  // Normalize & filter
  return parsed
    .filter((x) => x && typeof x.content === 'string' && x.content.trim().length > 0)
    .slice(0, maxItems)
    .map((x) => ({
      memoryType: typeof x.memoryType === 'string' && x.memoryType.trim() ? x.memoryType.trim() : 'fact',
      content: x.content.trim(),
      source: typeof x.source === 'string' ? x.source : 'conversation',
    }));
}

export async function searchMemories(params: {
  userId: string;
  query: string;
  topK?: number;
}): Promise<Array<MemoryItem & { score: number }>> {
  const { userId, query, topK = MAX_ITEMS_TO_INJECT } = params;
  if (!query?.trim()) return [];
  if (!isEmbeddingsConfigured()) return [];

  const memRows = db
    .prepare('SELECT id, userId, memoryType, content, embedding, source, createdAt, updatedAt FROM user_memories WHERE userId = ? AND embedding IS NOT NULL')
    .all(userId) as MemoryRow[];

  if (!memRows.length) return [];

  const embeddings = getEmbeddingsClient();
  const qEmbedding = await embeddings.embedQuery(query);

  const scored = memRows
    .map((r) => {
      let emb: number[] = [];
      try {
        emb = JSON.parse(r.embedding || '[]') as number[];
      } catch {
        emb = [];
      }
      return {
        id: r.id,
        userId: r.userId,
        memoryType: r.memoryType,
        content: r.content,
        embedding: r.embedding,
        source: r.source,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        score: cosineSimilarity(qEmbedding as number[], emb),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topK))
    .filter((x) => x.score >= INJECT_SCORE_THRESHOLD);

  return scored.map((x) => ({
    memoryType: x.memoryType,
    content: x.content,
    source: x.source,
    score: x.score,
  }));
}

export function buildMemorySystemPrompt(params: {
  query: string;
  memories: Array<MemoryItem & { score: number }>;
}): string | null {
  const { memories } = params;
  if (!memories.length) return null;

  const lines = memories.slice(0, MAX_ITEMS_TO_INJECT).map((m, idx) => {
    return `${idx + 1}. ${m.content}`;
  });

  return [
    '你需要记住并遵循用户的长期记忆（以下为记忆摘要）。',
    '当用户的问题与这些记忆相关时，请优先采用这些记忆来回答。',
    '如果用户在询问你的称呼/名字/身份（例如“你是谁/你叫什么/你的称呼是什么”），请把记忆中与“助手身份/称呼”相关的内容当作事实直接回答，避免改口。',
    '如果记忆与当前事实冲突，请在回答中说明，并根据用户最新信息更新记忆倾向。',
    '---',
    `记忆摘要：\n${lines.join('\n')}`,
  ].join('\n');
}

export async function upsertMemories(params: {
  userId: string;
  items: MemoryItem[];
}): Promise<{ inserted: number; skipped: number }> {
  const { userId, items } = params;
  const normalized = (items || [])
    .filter((x) => x && typeof x.content === 'string' && x.content.trim())
    .slice(0, MAX_ITEMS_TO_EXTRACT)
    .map((x) => ({
      memoryType: typeof x.memoryType === 'string' && x.memoryType.trim() ? x.memoryType.trim() : 'fact',
      content: x.content.trim(),
      source: typeof x.source === 'string' ? x.source : 'conversation',
    }));

  if (!normalized.length) return { inserted: 0, skipped: 0 };

  // If embeddings are not configured, we still persist content without dedup.
  if (!isEmbeddingsConfigured()) {
    const insert = db.prepare(
      'INSERT INTO user_memories (id, userId, memoryType, content, embedding, source, createdAt, updatedAt) VALUES (?, ?, ?, ?, NULL, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
    );
    const insertMany = db.transaction(() => {
      let inserted = 0;
      for (const item of normalized) {
        insert.run(randomUUID(), userId, item.memoryType, item.content, item.source || null);
        inserted++;
      }
      return inserted;
    });
    const inserted = insertMany();
    return { inserted, skipped: 0 };
  }

  const embeddings = getEmbeddingsClient();
  const preparedRows = db
    .prepare('SELECT id, memoryType, content, embedding FROM user_memories WHERE userId = ? AND embedding IS NOT NULL ORDER BY createdAt DESC LIMIT 200')
    .all(userId) as Array<{ id: string; memoryType: string; content: string; embedding: string | null }>;

  const insertStmt = db.prepare(
    'INSERT INTO user_memories (id, userId, memoryType, content, embedding, source, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)'
  );

  let inserted = 0;
  let skipped = 0;

  // Sync-safe upsert: do embeddings sequentially outside the tx block.
  for (const item of normalized) {
    const qEmb = (await embeddings.embedQuery(item.content)) as number[];
    let best = -Infinity;
    for (const r of preparedRows) {
      if (!r.embedding) continue;
      let emb: number[] = [];
      try {
        emb = JSON.parse(r.embedding) as number[];
      } catch {
        emb = [];
      }
      const score = cosineSimilarity(qEmb, emb);
      if (score > best) best = score;
    }

    if (best >= DEDUP_SIMILARITY_THRESHOLD) {
      skipped++;
      continue;
    }

    const id = randomUUID();
    const embStr = JSON.stringify(qEmb ?? []);
    insertStmt.run(id, userId, item.memoryType, item.content, embStr, item.source || null);
    inserted++;
  }

  return { inserted, skipped };
}

