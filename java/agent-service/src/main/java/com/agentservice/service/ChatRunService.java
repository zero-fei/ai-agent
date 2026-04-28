package com.agentservice.service;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.agentservice.dto.ChatRunDtos.ChatRunDto;

/**
 * chat_runs 持久化服务：用于请求级回放摘要。
 */
@Service
public class ChatRunService {
  private final JdbcTemplate jdbcTemplate;

  public ChatRunService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
    ensureTable();
  }

  private void ensureTable() {
    jdbcTemplate.execute("""
        CREATE TABLE IF NOT EXISTS chat_runs (
          id TEXT PRIMARY KEY,
          traceId TEXT NOT NULL,
          userId TEXT NOT NULL,
          conversationId TEXT,
          status TEXT NOT NULL,
          error TEXT,
          preflightMs INTEGER,
          llmConnectMs INTEGER,
          totalMs INTEGER,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        """);
  }

  public String startRun(String traceId, String userId, String conversationId) {
    String id = UUID.randomUUID().toString();
    jdbcTemplate.update(
        "INSERT INTO chat_runs (id, traceId, userId, conversationId, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, 'running', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        id, traceId, userId, conversationId);
    return id;
  }

  public void finishOk(String runId, long preflightMs, long llmConnectMs, long totalMs) {
    jdbcTemplate.update(
        "UPDATE chat_runs SET status = 'ok', preflightMs = ?, llmConnectMs = ?, totalMs = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?",
        preflightMs, llmConnectMs, totalMs, runId);
  }

  public void finishError(String runId, String error, long preflightMs, long llmConnectMs, long totalMs) {
    jdbcTemplate.update(
        "UPDATE chat_runs SET status = 'error', error = ?, preflightMs = ?, llmConnectMs = ?, totalMs = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?",
        error, preflightMs, llmConnectMs, totalMs, runId);
  }

  public List<ChatRunDto> listByUser(String userId, String traceId, int limit) {
    int bounded = Math.max(1, Math.min(200, limit));
    String sql = traceId == null || traceId.isBlank()
        ? "SELECT id, traceId, userId, conversationId, status, error, preflightMs, llmConnectMs, totalMs, createdAt, updatedAt FROM chat_runs WHERE userId = ? ORDER BY createdAt DESC LIMIT ?"
        : "SELECT id, traceId, userId, conversationId, status, error, preflightMs, llmConnectMs, totalMs, createdAt, updatedAt FROM chat_runs WHERE userId = ? AND traceId = ? ORDER BY createdAt DESC LIMIT ?";
    List<Map<String, Object>> rows = traceId == null || traceId.isBlank()
        ? jdbcTemplate.queryForList(sql, userId, bounded)
        : jdbcTemplate.queryForList(sql, userId, traceId, bounded);
    return rows.stream().map(this::mapRun).toList();
  }

  public ChatRunDto getById(String userId, String id) {
    List<Map<String, Object>> rows = jdbcTemplate.queryForList(
        "SELECT id, traceId, userId, conversationId, status, error, preflightMs, llmConnectMs, totalMs, createdAt, updatedAt FROM chat_runs WHERE id = ? AND userId = ? LIMIT 1",
        id, userId);
    if (rows.isEmpty()) return null;
    return mapRun(rows.get(0));
  }

  private ChatRunDto mapRun(Map<String, Object> r) {
    return new ChatRunDto(
        String.valueOf(r.get("id")),
        String.valueOf(r.get("traceId")),
        String.valueOf(r.get("userId")),
        r.get("conversationId") == null ? null : String.valueOf(r.get("conversationId")),
        String.valueOf(r.get("status")),
        r.get("error") == null ? null : String.valueOf(r.get("error")),
        r.get("preflightMs") == null ? null : ((Number) r.get("preflightMs")).longValue(),
        r.get("llmConnectMs") == null ? null : ((Number) r.get("llmConnectMs")).longValue(),
        r.get("totalMs") == null ? null : ((Number) r.get("totalMs")).longValue(),
        r.get("createdAt") == null ? null : String.valueOf(r.get("createdAt")),
        r.get("updatedAt") == null ? null : String.valueOf(r.get("updatedAt")));
  }
}

