import { v4 as uuidv4 } from 'uuid';
import db from './db';
import crypto from 'crypto';

export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
}

export interface Session {
  userId: string;
  expiresAt: Date;
}

const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;

export function hashPasswordSync(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  const hashedInput = hashPasswordSync(password);
  return hashedInput === hashedPassword;
}

export function createUser(username: string, email: string, password: string): User | null {
  try {
    const id = uuidv4();
    const hashedPassword = hashPasswordSync(password);
    
    const stmt = db.prepare('INSERT INTO users (id, username, email, password) VALUES (?, ?, ?, ?)');
    stmt.run(id, username, email, hashedPassword);
    
    return { id, username, email, createdAt: new Date().toISOString() };
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    const message = err?.message ?? '';
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE' || message.includes('UNIQUE constraint failed')) {
      return null;
    }
    throw error;
  }
}

export function findUserByUsername(username: string): User & { password: string } | null {
  try {
    const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
    return stmt.get(username) as (User & { password: string }) | null;
  } catch {
    return null;
  }
}

export function findUserByEmail(email: string): User & { password: string } | null {
  try {
    const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
    return stmt.get(email) as (User & { password: string }) | null;
  } catch {
    return null;
  }
}

export function findUserById(id: string): User | null {
  try {
    const stmt = db.prepare('SELECT id, username, email, createdAt FROM users WHERE id = ?');
    return stmt.get(id) as User | null;
  } catch {
    return null;
  }
}

export function createSession(userId: string): string {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + SESSION_DURATION);
  
  const stmt = db.prepare('INSERT INTO sessions (token, userId, expiresAt) VALUES (?, ?, ?)');
  stmt.run(token, userId, expiresAt.toISOString());
  
  return token;
}

export function getSession(token: string): User | null {
  try {
    const stmt = db.prepare(`
      SELECT u.id, u.username, u.email, u.createdAt 
      FROM sessions s 
      JOIN users u ON s.userId = u.id 
      WHERE s.token = ? AND s.expiresAt > ?
    `);
    const user = stmt.get(token, new Date().toISOString()) as User | null;
    
    if (user) {
      const newExpiresAt = new Date(Date.now() + SESSION_DURATION);
      const updateStmt = db.prepare('UPDATE sessions SET expiresAt = ? WHERE token = ?');
      updateStmt.run(newExpiresAt.toISOString(), token);
    }
    
    return user;
  } catch {
    return null;
  }
}

export function deleteSession(token: string): void {
  try {
    const stmt = db.prepare('DELETE FROM sessions WHERE token = ?');
    stmt.run(token);
  } catch {
    // Ignore errors
  }
}
