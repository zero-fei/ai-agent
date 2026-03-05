import { Database } from 'better-sqlite3';

declare global {
  var db: Database;
}