import { OpenAIEmbeddings } from '@langchain/openai';
import db from '@/lib/db';
import { randomUUID } from 'crypto';
import { DEFAULT_KB_CONFIG, KbCollectionConfig, normalizeText, splitText } from '@/lib/textProcess';

/**
 * RAG / 知识库核心逻辑。
 *
 * 设计目标：
 * - 全部落盘到 SQLite（better-sqlite3），保证“开箱即用”的开发体验。
 * - 支持同一用户的多集合（多知识库/多库隔离）。
 * - 检索可扩展：优先走
 *    1) SQLite FTS5 进行候选召回（快速的词法过滤）
 *    2) 对候选进行向量余弦相似度精排
 *   若运行环境不支持 FTS5，则自动回退到向量全表扫描（小数据可用）。
 *
 * 说明：
 * - embedding 以 JSON 序列化的 `number[]` 存储，兼容性更好但空间更大。
 * - 这里不是“真正的向量数据库”；数据量特别大时建议迁移到专用向量库。
 */
type KbDoc = {
  id: string;
  userId: string;
  collectionId: string | null;
  name: string;
  source: string | null;
  createdAt: string;
};

export type KbCollection = {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  config?: string | null;
  createdAt: string;
};

type KbChunkRow = {
  id: string;
  userId: string;
  collectionId: string | null;
  documentId: string;
  content: string;
  embedding: string; // JSON stringified number[]
  metadata: string | null;
  createdAt: string;
};

/**
 * Embeddings 客户端封装。
 * 这里使用 OpenAI 兼容接口，并把 baseURL 指向 DashScope。
 *
 * 把配置集中在这里，避免模型/URL 变更散落在代码各处。
 */
const getEmbeddingsClient = () => {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey || apiKey === 'your-api-key') {
    throw new Error('DashScope API key is not configured.');
  }

  return new OpenAIEmbeddings({
    apiKey,
    model: process.env.DASHSCOPE_EMBEDDING_MODEL || 'text-embedding-v2',
    configuration: {
      baseURL:
        process.env.DASHSCOPE_EMBEDDINGS_BASE_URL ||
        process.env.DASHSCOPE_BASE_URL ||
        'https://coding.dashscope.aliyuncs.com/v1',
    },
  });
};

function getCollectionConfigForUser(collectionId: string | null, userId: string): KbCollectionConfig {
  if (!collectionId) return DEFAULT_KB_CONFIG;
  try {
    const row = db
      .prepare('SELECT config FROM kb_collections WHERE id = ? AND userId = ?')
      .get(collectionId, userId) as { config?: string | null } | undefined;
    if (!row?.config) return DEFAULT_KB_CONFIG;
    const parsed = JSON.parse(row.config) as Partial<KbCollectionConfig>;
    return { ...DEFAULT_KB_CONFIG, ...parsed };
  } catch {
    return DEFAULT_KB_CONFIG;
  }
}

/**
 * 稠密向量余弦相似度。
 * 这里用最小维度做保护，避免维度不一致导致异常。
 */
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

/**
 * 将一段原始文本入库为“文档”。
 *
 * 数据流：
 * - 写入 kb_documents
 * - 切分 → 向量化 → 写入 kb_chunks
 * - 尽力写入 kb_chunks_fts（用于大规模检索的候选召回）
 *
 * FTS 表是可选能力：如果 SQLite 运行时不支持 FTS5，
 * 仍会保存 chunks+embeddings，检索会自动回退到向量扫描。
 */
export async function kbUpsertFromText(params: {
  userId: string;
  collectionId?: string | null;
  name: string;
  text: string;
  source?: string | null;
}) {
  const { userId, collectionId = null, name, text, source = null } = params;
  if (!text?.trim()) throw new Error('text is required');
  if (!name?.trim()) throw new Error('name is required');

  const cfg = getCollectionConfigForUser(collectionId, userId);
  const normalized = normalizeText(text, cfg);
  const chunkTexts = splitText(normalized, cfg.chunkSize, cfg.chunkOverlap);
  if (chunkTexts.length === 0) {
    throw new Error('No valid content after text normalization.');
  }

  const docId = randomUUID();
  db.prepare('INSERT INTO kb_documents (id, userId, collectionId, name, source) VALUES (?, ?, ?, ?, ?)').run(
    docId,
    userId,
    collectionId,
    name,
    source
  );
  // 批量向量化：更高效，也能保证同一批次维度一致。
  const embeddings = await getEmbeddingsClient().embedDocuments(chunkTexts);

  const insertChunk = db.prepare(
    'INSERT INTO kb_chunks (id, userId, collectionId, documentId, content, embedding, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const insertFts = db.prepare(
    'INSERT INTO kb_chunks_fts (content, chunkId, userId, collectionId, documentId) VALUES (?, ?, ?, ?, ?)'
  );
  const insertMany = db.transaction(() => {
    for (let i = 0; i < chunkTexts.length; i++) {
      const id = randomUUID();
      const content = chunkTexts[i]!;
      const embedding = JSON.stringify(embeddings[i] ?? []);
      const metadata = JSON.stringify({ index: i, name, source });
      insertChunk.run(id, userId, collectionId, docId, content, embedding, metadata);
      try {
        insertFts.run(content, id, userId, collectionId, docId);
      } catch {
        // FTS table may not exist; ignore and fallback to vector scan.
      }
    }
  });
  insertMany();

  return { documentId: docId, chunks: chunkTexts.length };
}

/**
 * 列出某个集合下的文档。
 * 使用 `collectionId IS ?` 是为了正确匹配 NULL（默认集合）。
 */
export function kbListDocuments(params: { userId: string; collectionId?: string | null }): KbDoc[] {
  const { userId, collectionId = null } = params;
  return db
    .prepare(
      'SELECT id, userId, collectionId, name, source, createdAt FROM kb_documents WHERE userId = ? AND collectionId IS ? ORDER BY createdAt DESC'
    )
    .all(userId, collectionId) as KbDoc[];
}

/**
 * 删除文档及其切片。
 *
 * - kb_chunks 依赖外键级联删除（documentId ON DELETE CASCADE）
 * - kb_chunks_fts 是虚拟表，无法外键级联，需要手动清理
 */
export function kbDeleteDocument(params: { userId: string; documentId: string }) {
  const { userId, documentId } = params;
  const doc = db
    .prepare('SELECT id FROM kb_documents WHERE id = ? AND userId = ?')
    .get(documentId, userId) as { id: string } | undefined;
  if (!doc) return { deleted: false };

  // Clean FTS rows first (chunks are FK-deleted with the document).
  try {
    db.prepare('DELETE FROM kb_chunks_fts WHERE userId = ? AND documentId = ?').run(userId, documentId);
  } catch {
    // ignore
  }

  db.prepare('DELETE FROM kb_documents WHERE id = ? AND userId = ?').run(documentId, userId);
  return { deleted: true };
}

/**
 * 混合检索（Hybrid Retrieval）：
 * - 第一步（快）：用 FTS5 做词法召回，拿到候选 chunkId
 * - 第二步（准）：对 query 做向量化，用余弦相似度对候选精排
 *
 * 为什么要混合？
 * - kb_chunks 变大后，SQLite 全表向量扫描会越来越慢
 * - FTS5 能显著缩小候选集，再做向量精排性价比更高
 */
export async function kbSearch(params: {
  userId: string;
  collectionId?: string | null;
  query: string;
  topK?: number;
  candidateK?: number;
}) {
  const { userId, collectionId = null, query, topK = 5, candidateK = 50 } = params;
  if (!query?.trim()) return [];

  const qEmbedding = await getEmbeddingsClient().embedQuery(query);

  // 1) Candidate recall via FTS (fast) when available
  let candidateChunkIds: string[] | null = null;
  try {
    const ftsRows = db
      .prepare(
        `SELECT chunkId
         FROM kb_chunks_fts
         WHERE kb_chunks_fts MATCH ?
           AND userId = ?
           AND collectionId IS ?
         LIMIT ?`
      )
      .all(query, userId, collectionId, Math.max(10, Math.min(500, candidateK))) as Array<{ chunkId: string }>;
    candidateChunkIds = ftsRows.map((r) => r.chunkId);
  } catch {
    candidateChunkIds = null;
  }

  let rows: KbChunkRow[] = [];
  if (candidateChunkIds && candidateChunkIds.length > 0) {
    // SQLite parameter limit safe for small candidateK; chunkId list size is capped above.
    const placeholders = candidateChunkIds.map(() => '?').join(',');
    rows = db
      .prepare(
        `SELECT id, userId, collectionId, documentId, content, embedding, metadata, createdAt
         FROM kb_chunks
         WHERE userId = ?
           AND collectionId IS ?
           AND id IN (${placeholders})`
      )
      .all(userId, collectionId, ...candidateChunkIds) as KbChunkRow[];
  } else {
    // 2) Fallback: vector scan within collection
    rows = db
      .prepare(
        'SELECT id, userId, collectionId, documentId, content, embedding, metadata, createdAt FROM kb_chunks WHERE userId = ? AND collectionId IS ?'
      )
      .all(userId, collectionId) as KbChunkRow[];
  }

  const scored = rows
    .map((r) => {
      let emb: number[] = [];
      try {
        emb = JSON.parse(r.embedding) as number[];
      } catch {
        emb = [];
      }
      return {
        id: r.id,
        documentId: r.documentId,
        content: r.content,
        metadata: r.metadata ? (JSON.parse(r.metadata) as Record<string, unknown>) : {},
        score: cosineSimilarity(qEmbedding, emb),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(20, topK)));

  return scored;
}

/**
 * 集合（collection）用于把同一用户的文档/切片分组（相当于多个知识库）。
 * 这里为了简单，把 collectionId 作为 docs/chunks 的普通列维护。
 */
export function kbCreateCollection(params: { userId: string; name: string; description?: string | null }) {
  const { userId, name, description = null } = params;
  if (!name?.trim()) throw new Error('name is required');
  const id = randomUUID();
  db.prepare('INSERT INTO kb_collections (id, userId, name, description) VALUES (?, ?, ?, ?)').run(
    id,
    userId,
    name.trim(),
    description
  );
  return { id };
}

/** 列出当前用户的集合（按创建时间倒序）。 */
export function kbListCollections(userId: string): KbCollection[] {
  return db
    .prepare('SELECT id, userId, name, description, createdAt FROM kb_collections WHERE userId = ? ORDER BY createdAt DESC')
    .all(userId) as KbCollection[];
}

/**
 * 删除集合及其所有内容。
 *
 * 注意：
 * - collectionId 不是外键，所以需要手动清理 documents/chunks/fts
 * - 这里同时删除 docs 与 chunks，逻辑更直观
 */
export function kbDeleteCollection(params: { userId: string; collectionId: string }) {
  const { userId, collectionId } = params;
  const row = db
    .prepare('SELECT id FROM kb_collections WHERE id = ? AND userId = ?')
    .get(collectionId, userId) as { id: string } | undefined;
  if (!row) return { deleted: false };

  db.prepare('DELETE FROM kb_collections WHERE id = ? AND userId = ?').run(collectionId, userId);
  // Documents/chunks are not FK-linked to collections (collectionId is a plain column), so clean them up.
  db.prepare('DELETE FROM kb_documents WHERE userId = ? AND collectionId = ?').run(userId, collectionId);
  db.prepare('DELETE FROM kb_chunks WHERE userId = ? AND collectionId = ?').run(userId, collectionId);
  try {
    db.prepare('DELETE FROM kb_chunks_fts WHERE userId = ? AND collectionId = ?').run(userId, collectionId);
  } catch {
    // ignore
  }

  return { deleted: true };
}

/**
 * 将检索命中片段转换为 system prompt。
 *
 * 这样可以不改 chat 的消息结构：仅通过覆盖 system prompt，
 * 让模型把检索到的上下文当作优先参考依据。
 */
export function buildRagSystemPrompt(params: {
  query: string;
  hits: Array<{ content: string; score: number }>;
}) {
  const { query, hits } = params;
  if (!hits.length) return null;

  const context = hits
    .map((h, idx) => `### 片段 ${idx + 1}（相似度 ${h.score.toFixed(3)}）\n${h.content}`)
    .join('\n\n');

  return [
    '你是一个严谨的客服/助手。下面给出的是「知识库检索到的上下文」，优先依据它回答。',
    '如果上下文不足以支撑结论，请明确说“不确定/知识库未覆盖”，并给出你需要的补充信息。',
    `用户问题：${query}`,
    '---',
    context,
  ].join('\n');
}

