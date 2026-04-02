package com.agentservice.service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.agentservice.dto.McpDtos.AuthResult;
import com.agentservice.dto.McpDtos.HealthResult;
import com.agentservice.dto.McpDtos.McpLogDto;
import com.agentservice.dto.McpDtos.McpServerDto;

/**
 * MCP Server 与日志的持久化/运维服务。
 *
 * <p>主要职责：</p>
 * <ul>
 *   <li>CRUD：表 {@code mcp_servers}</li>
 *   <li>认证/健康检查：更新 {@code authStatus}/{@code lastHealth*} 并写入 {@code mcp_logs}</li>
 *   <li>并发保护：同一 userId+serverId 下同类型操作不可并行</li>
 * </ul>
 */
@Service
public class McpManagementService {

  private final JdbcTemplate jdbcTemplate;
  private final ObjectMapper objectMapper;
  private final HttpClient httpClient = HttpClient.newHttpClient();

  /** 防止重复点击造成的并发写库：key = userId:serverId:auth|health */
  private final ConcurrentMap<String, Boolean> activeOps = new ConcurrentHashMap<>();

  public McpManagementService(JdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
    this.jdbcTemplate = jdbcTemplate;
    this.objectMapper = objectMapper;
  }

  /** 将 JSON 字符串解析为 Map；失败返回 null */
  private Map<String, Object> parseJsonObject(String raw) {
    if (raw == null || raw.trim().isEmpty()) return null;
    try {
      return objectMapper.readValue(raw, new TypeReference<Map<String, Object>>() {});
    } catch (Exception e) {
      return null;
    }
  }

  /** JDBC 一行 → DTO */
  private McpServerDto mapServer(Map<String, Object> r) {
    String id = String.valueOf(r.get("id"));
    String userId = String.valueOf(r.get("userId"));
    String name = String.valueOf(r.get("name"));
    String serverKey = String.valueOf(r.get("serverKey"));
    String endpoint = r.get("endpoint") == null ? null : String.valueOf(r.get("endpoint"));
    Object config = r.get("config") == null ? null : parseJsonObject(String.valueOf(r.get("config")));
    boolean enabled = r.get("enabled") != null && String.valueOf(r.get("enabled")).equals("1");
    String authStatus = String.valueOf(r.get("authStatus"));
    String lastHealthStatus = r.get("lastHealthStatus") == null ? null : String.valueOf(r.get("lastHealthStatus"));
    String lastHealthMessage = r.get("lastHealthMessage") == null ? null : String.valueOf(r.get("lastHealthMessage"));
    String lastHealthAt = r.get("lastHealthAt") == null ? null : String.valueOf(r.get("lastHealthAt"));
    String createdAt = r.get("createdAt") == null ? null : String.valueOf(r.get("createdAt"));
    String updatedAt = r.get("updatedAt") == null ? null : String.valueOf(r.get("updatedAt"));

    return new McpServerDto(id, userId, name, serverKey, endpoint, config, enabled, authStatus, lastHealthStatus,
        lastHealthMessage, lastHealthAt, createdAt, updatedAt);
  }

  private McpLogDto mapLog(Map<String, Object> r) {
    String id = String.valueOf(r.get("id"));
    String userId = String.valueOf(r.get("userId"));
    String serverId = String.valueOf(r.get("serverId"));
    String action = String.valueOf(r.get("action"));
    String status = String.valueOf(r.get("status"));
    String message = r.get("message") == null ? null : String.valueOf(r.get("message"));
    Object meta = r.get("meta") == null ? null : parseJsonObject(String.valueOf(r.get("meta")));
    String createdAt = r.get("createdAt") == null ? null : String.valueOf(r.get("createdAt"));
    return new McpLogDto(id, userId, serverId, action, status, message, meta, createdAt);
  }

  /** 列出某用户全部 MCP Server */
  public List<McpServerDto> listServers(String userId) {
    List<Map<String, Object>> rows = jdbcTemplate.queryForList(
        "SELECT id, userId, name, serverKey, endpoint, config, enabled, authStatus, lastHealthStatus, lastHealthMessage, lastHealthAt, createdAt, updatedAt " +
            "FROM mcp_servers WHERE userId = ? ORDER BY createdAt DESC",
        userId);
    return rows.stream().map(this::mapServer).toList();
  }

  /** 新建 MCP Server 并写入日志 */
  public McpServerDto createServer(String userId, String name, String serverKey, String endpoint, Object config) {
    String id = UUID.randomUUID().toString();
    String configJson = null;
    if (config != null) {
      try {
        configJson = objectMapper.writeValueAsString(config);
      } catch (Exception e) {
        configJson = null;
      }
    }

    jdbcTemplate.update(
        "INSERT INTO mcp_servers (id, userId, name, serverKey, endpoint, config, enabled, authStatus, createdAt, updatedAt) " +
            "VALUES (?, ?, ?, ?, ?, ?, 1, 'unknown', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
        id, userId, name, serverKey, endpoint, configJson);

    jdbcTemplate.update(
        "INSERT INTO mcp_logs (id, userId, serverId, action, status, message, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
        UUID.randomUUID().toString(),
        userId,
        id,
        "create",
        "ok",
        "MCP server created",
        safeJson(Map.of("name", name, "serverKey", serverKey)));

    return getServerOwned(userId, id).orElseThrow();
  }

  /** 按 id 读取且必须属于该 user */
  public Optional<McpServerDto> getServerOwned(String userId, String serverId) {
    try {
      List<Map<String, Object>> rows = jdbcTemplate.queryForList(
          "SELECT id, userId, name, serverKey, endpoint, config, enabled, authStatus, lastHealthStatus, lastHealthMessage, lastHealthAt, createdAt, updatedAt " +
              "FROM mcp_servers WHERE id = ? AND userId = ?",
          serverId, userId);
      if (rows.isEmpty()) return Optional.empty();
      return Optional.of(mapServer(rows.get(0)));
    } catch (Exception e) {
      return Optional.empty();
    }
  }

  /** 部分更新：body 未出现的字段保留原值 */
  public McpServerDto updateServer(String userId, String serverId, Map<String, Object> body) {
    McpServerDto current = getServerOwned(userId, serverId).orElseThrow();

    String nextName = body.containsKey("name") ? String.valueOf(body.get("name")) : current.name();
    String nextServerKey = body.containsKey("serverKey") ? String.valueOf(body.get("serverKey")) : current.serverKey();
    String nextEndpoint = body.containsKey("endpoint") ? (body.get("endpoint") == null ? null : String.valueOf(body.get("endpoint"))) : current.endpoint();
    Object nextConfig = body.containsKey("config") ? body.get("config") : current.config();

    String nextConfigJson = null;
    if (nextConfig != null) {
      try {
        nextConfigJson = objectMapper.writeValueAsString(nextConfig);
      } catch (Exception e) {
        nextConfigJson = null;
      }
    }

    jdbcTemplate.update(
        "UPDATE mcp_servers SET name = ?, serverKey = ?, endpoint = ?, config = ?, updatedAt = CURRENT_TIMESTAMP " +
            "WHERE id = ? AND userId = ?",
        nextName, nextServerKey, nextEndpoint, nextConfigJson, serverId, userId);

    jdbcTemplate.update(
        "INSERT INTO mcp_logs (id, userId, serverId, action, status, message, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
        UUID.randomUUID().toString(),
        userId,
        serverId,
        "update",
        "ok",
        "MCP server updated",
        null);

    return getServerOwned(userId, serverId).orElseThrow();
  }

  /** 删除 MCP Server */
  public boolean deleteServer(String userId, String serverId) {
    int changes = jdbcTemplate.update("DELETE FROM mcp_servers WHERE id = ? AND userId = ?", serverId, userId);
    return changes > 0;
  }

  /** 启用/停用 */
  public McpServerDto setServerEnabled(String userId, String serverId, boolean enabled) {
    jdbcTemplate.update(
        "UPDATE mcp_servers SET enabled = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?",
        enabled ? 1 : 0, serverId, userId);

    jdbcTemplate.update(
        "INSERT INTO mcp_logs (id, userId, serverId, action, status, message, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
        UUID.randomUUID().toString(),
        userId,
        serverId,
        enabled ? "enable" : "disable",
        "ok",
        enabled ? "Server enabled" : "Server disabled",
        null);

    return getServerOwned(userId, serverId).orElseThrow();
  }

  /** 认证触发（与历史 Node parity：简化校验 serverKey/endpoint 并写日志） */
  public AuthResult runServerAuth(String userId, String serverId) {
    String lockKey = userId + ":" + serverId + ":auth";
    if (activeOps.putIfAbsent(lockKey, Boolean.TRUE) != null) {
      throw new IllegalStateException("Authentication already in progress.");
    }

    try {
      McpServerDto server = getServerOwned(userId, serverId).orElseThrow();

      jdbcTemplate.update("UPDATE mcp_servers SET authStatus = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?",
          "pending", serverId, userId);

      boolean hasServerKey = server.serverKey() != null && !server.serverKey().trim().isEmpty();
      boolean hasEndpoint = server.endpoint() != null && !server.endpoint().trim().isEmpty();
      String status = hasServerKey ? "ok" : "failed";
      String message = hasServerKey
          ? (hasEndpoint ? "Auth trigger accepted." : "Auth trigger accepted (no endpoint configured).")
          : "Missing serverKey.";

      jdbcTemplate.update("UPDATE mcp_servers SET authStatus = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?",
          status, serverId, userId);

      jdbcTemplate.update(
          "INSERT INTO mcp_logs (id, userId, serverId, action, status, message, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
          UUID.randomUUID().toString(),
          userId,
          serverId,
          "auth",
          status,
          message,
          safeJson(Map.of("serverKey", server.serverKey(), "endpoint", server.endpoint())));

      McpServerDto updated = getServerOwned(userId, serverId).orElseThrow();
      return new AuthResult(status, message, updated);
    } finally {
      activeOps.remove(lockKey);
    }
  }

  /** 健康检查：对 endpoint 做 GET */
  public HealthResult runHealthCheck(String userId, String serverId) {
    String lockKey = userId + ":" + serverId + ":health";
    if (activeOps.putIfAbsent(lockKey, Boolean.TRUE) != null) {
      throw new IllegalStateException("Health check already in progress.");
    }

    try {
      McpServerDto server = getServerOwned(userId, serverId).orElseThrow();
      String status = "healthy";
      String message = "Health check passed.";
      Integer code = null;

      if (server.endpoint() != null && !server.endpoint().trim().isEmpty()) {
        try {
          HttpRequest req = HttpRequest.newBuilder().uri(URI.create(server.endpoint())).GET().build();
          HttpResponse<String> res = httpClient.send(req, HttpResponse.BodyHandlers.ofString());
          code = res.statusCode();
          if (code < 200 || code >= 300) {
            status = "unhealthy";
            message = "Endpoint returned HTTP " + code + ".";
          }
        } catch (Exception e) {
          status = "unhealthy";
          message = e.getMessage() != null ? e.getMessage() : String.valueOf(e);
        }
      } else {
        status = "unhealthy";
        message = "Endpoint is not configured.";
      }

      jdbcTemplate.update(
          "UPDATE mcp_servers SET lastHealthStatus = ?, lastHealthMessage = ?, lastHealthAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP " +
              "WHERE id = ? AND userId = ?",
          status, message, serverId, userId);

      jdbcTemplate.update(
          "INSERT INTO mcp_logs (id, userId, serverId, action, status, message, meta) VALUES (?, ?, ?, ?, ?, ?, ?)",
          UUID.randomUUID().toString(),
          userId,
          serverId,
          "health_check",
          status.equals("healthy") ? "ok" : "error",
          message,
          safeJson(Map.of("endpoint", server.endpoint(), "code", code)));

      McpServerDto updated = getServerOwned(userId, serverId).orElseThrow();
      return new HealthResult(status, message, updated);
    } finally {
      activeOps.remove(lockKey);
    }
  }

  /** 查询 mcp_logs */
  public List<McpLogDto> listLogs(String userId, String serverId, int limit) {
    int bounded = Math.max(1, Math.min(500, limit));
    String sql = serverId != null
        ? "SELECT id, userId, serverId, action, status, message, meta, createdAt FROM mcp_logs " +
            "WHERE userId = ? AND serverId = ? ORDER BY createdAt DESC LIMIT ?"
        : "SELECT id, userId, serverId, action, status, message, meta, createdAt FROM mcp_logs " +
            "WHERE userId = ? ORDER BY createdAt DESC LIMIT ?";

    List<Map<String, Object>> rows = serverId != null
        ? jdbcTemplate.queryForList(sql, userId, serverId, bounded)
        : jdbcTemplate.queryForList(sql, userId, bounded);

    return rows.stream().map(this::mapLog).toList();
  }

  /** 安全写入 meta 字段：序列化失败返回 null */
  private String safeJson(Object obj) {
    try {
      return objectMapper.writeValueAsString(obj);
    } catch (Exception e) {
      return null;
    }
  }
}

