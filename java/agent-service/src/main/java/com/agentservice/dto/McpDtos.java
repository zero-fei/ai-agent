package com.agentservice.dto;

/**
 * 与 MCP 管理/工具调用相关的 DTO 集合。
 */
public final class McpDtos {
  private McpDtos() {}

  /** 返回给前端的 MCP Server 一行数据（字段与 Node API 对齐）。 */
  public record McpServerDto(
      String id,
      String userId,
      String name,
      String serverKey,
      String endpoint,
      Object config,
      boolean enabled,
      String authStatus,
      String lastHealthStatus,
      String lastHealthMessage,
      String lastHealthAt,
      String createdAt,
      String updatedAt) {
  }

  /** 触发认证后的结果：状态文案 + 更新后的 server 快照。 */
  public record AuthResult(String status, String message, McpServerDto server) {
  }

  /** 健康检查结果：状态文案 + 更新后的 server 快照。 */
  public record HealthResult(String status, String message, McpServerDto server) {
  }

  /** 单条 MCP 操作日志。 */
  public record McpLogDto(
      String id,
      String userId,
      String serverId,
      String action,
      String status,
      String message,
      Object meta,
      String createdAt) {
  }
}

