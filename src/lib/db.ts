import Database from 'better-sqlite3';
import path from 'path';

// Define the path for the database file.
// It's good practice to place it outside the source code, e.g., in the project root.
const dbPath = path.resolve(process.cwd(), 'database.db');

// Create a new database connection.
// `verbose: console.log` is useful for debugging during development.
const db = new Database(dbPath, { verbose: console.log });

// Use singleton pattern to ensure only one database connection is active.
// This is a simplified approach for Next.js where modules can be re-evaluated.
if (!global.db) {
  global.db = db;
}

/**
 * Initializes the database and creates tables if they don't exist.
 */
function initializeDatabase() {
  // Create 'conversations' table
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
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

  console.log("Database initialized successfully.");
}

// Run initialization
initializeDatabase();

export default global.db as Database.Database;