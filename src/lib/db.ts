import Database from 'better-sqlite3';
import path from 'path';

/**
 * SQLite 连接与建表/迁移初始化。
 *
 * 为了部署简单，本项目使用本地 SQLite 文件（`database.db`）。
 * 模块加载时会确保：
 * - 必要的表存在
 * - 执行轻量级迁移（升级版本时补充新列）
 * - 尽力创建索引与 FTS（失败不影响主流程）
 *
 * 注意：Next.js 在 build/runtime 期间可能多次评估模块，
 * 所以这里用 `global.db` 复用单例连接，避免重复打开连接。
 */
const dbPath = path.resolve(process.cwd(), 'database.db');

// `verbose: console.log` 会比较吵，但对排查建表/迁移问题很有帮助。
const db = new Database(dbPath, { verbose: console.log });

// SQLite 默认不启用外键约束，这里显式开启以确保 ON DELETE CASCADE 生效。
db.pragma('foreign_keys = ON');

// Use singleton pattern to ensure only one database connection is active.
// This is a simplified approach for Next.js where modules can be re-evaluated.
if (!global.db) {
  global.db = db;
}

/** 初始化 schema，并执行安全的轻量迁移。 */
function initializeDatabase() {
  /**
   * 用于简单迁移：判断列是否存在。
   * 这里刻意只做最小迁移（仅 ALTER TABLE ADD COLUMN），避免复杂迁移带来的风险。
   */
  const columnExists = (table: string, column: string) => {
    try {
      const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      return rows.some((r) => r.name === column);
    } catch {
      return false;
    }
  };

  // Create 'users' table
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create 'sessions' table
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      expiresAt DATETIME NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
    )
  `);

  // Create 'conversations' table
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      title TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
    )
  `);

  // Create 'messages' table
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversationId TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversationId) REFERENCES conversations (id) ON DELETE CASCADE
    )
  `);

  // Knowledge base: documents
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_documents (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      collectionId TEXT,
      name TEXT NOT NULL,
      source TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
    )
  `);

  // Knowledge base: collections (a.k.a. knowledge bases)
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_collections (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      config TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
    )
  `);

  // Knowledge base: chunks + embeddings
  // embedding is stored as JSON stringified number[] for portability.
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      collectionId TEXT,
      documentId TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding TEXT NOT NULL,
      metadata TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (documentId) REFERENCES kb_documents (id) ON DELETE CASCADE
    )
  `);

  // MCP management: server configs
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      name TEXT NOT NULL,
      serverKey TEXT NOT NULL,
      endpoint TEXT,
      config TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      authStatus TEXT NOT NULL DEFAULT 'unknown',
      lastHealthStatus TEXT,
      lastHealthMessage TEXT,
      lastHealthAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE
    )
  `);

  // MCP management: operation logs
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_logs (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      serverId TEXT NOT NULL,
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      meta TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (userId) REFERENCES users (id) ON DELETE CASCADE,
      FOREIGN KEY (serverId) REFERENCES mcp_servers (id) ON DELETE CASCADE
    )
  `);

  // Migrations for existing DBs (CREATE TABLE IF NOT EXISTS does not add columns).
  if (!columnExists('kb_documents', 'collectionId')) {
    // 老库在引入“多集合”之前没有该列，需要补上。
    db.exec(`ALTER TABLE kb_documents ADD COLUMN collectionId TEXT;`);
  }
  if (!columnExists('kb_chunks', 'collectionId')) {
    // kb_chunks 同理。
    db.exec(`ALTER TABLE kb_chunks ADD COLUMN collectionId TEXT;`);
  }
  if (!columnExists('kb_collections', 'config')) {
    db.exec(`ALTER TABLE kb_collections ADD COLUMN config TEXT;`);
  }
  if (!columnExists('mcp_servers', 'endpoint')) {
    db.exec(`ALTER TABLE mcp_servers ADD COLUMN endpoint TEXT;`);
  }
  if (!columnExists('mcp_servers', 'config')) {
    db.exec(`ALTER TABLE mcp_servers ADD COLUMN config TEXT;`);
  }
  if (!columnExists('mcp_servers', 'enabled')) {
    db.exec(`ALTER TABLE mcp_servers ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;`);
  }
  if (!columnExists('mcp_servers', 'authStatus')) {
    db.exec(`ALTER TABLE mcp_servers ADD COLUMN authStatus TEXT NOT NULL DEFAULT 'unknown';`);
  }
  if (!columnExists('mcp_servers', 'lastHealthStatus')) {
    db.exec(`ALTER TABLE mcp_servers ADD COLUMN lastHealthStatus TEXT;`);
  }
  if (!columnExists('mcp_servers', 'lastHealthMessage')) {
    db.exec(`ALTER TABLE mcp_servers ADD COLUMN lastHealthMessage TEXT;`);
  }
  if (!columnExists('mcp_servers', 'lastHealthAt')) {
    db.exec(`ALTER TABLE mcp_servers ADD COLUMN lastHealthAt DATETIME;`);
  }
  if (!columnExists('mcp_servers', 'updatedAt')) {
    db.exec(`ALTER TABLE mcp_servers ADD COLUMN updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP;`);
  }

  // 用于大规模检索的候选召回（可选）。
  // 如果运行环境 SQLite 不支持 FTS5，仍然继续运行，`kbSearch()` 会回退到向量扫描。
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
        content,
        chunkId UNINDEXED,
        userId UNINDEXED,
        collectionId UNINDEXED,
        documentId UNINDEXED
      );
    `);
  } catch (e) {
    console.warn('FTS5 not available, kb_chunks_fts not created:', e);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_userId ON kb_chunks(userId);
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_user_collection ON kb_chunks(userId, collectionId);
    CREATE INDEX IF NOT EXISTS idx_kb_chunks_documentId ON kb_chunks(documentId);
    CREATE INDEX IF NOT EXISTS idx_kb_documents_user_collection ON kb_documents(userId, collectionId);
    CREATE INDEX IF NOT EXISTS idx_kb_collections_userId ON kb_collections(userId);
    CREATE INDEX IF NOT EXISTS idx_mcp_servers_userId ON mcp_servers(userId);
    CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_enabled ON mcp_servers(userId, enabled);
    CREATE INDEX IF NOT EXISTS idx_mcp_logs_userId ON mcp_logs(userId);
    CREATE INDEX IF NOT EXISTS idx_mcp_logs_server_createdAt ON mcp_logs(serverId, createdAt DESC);
  `);

  console.log("Database initialized successfully.");
}

// Run initialization
initializeDatabase();

export default global.db as Database.Database;