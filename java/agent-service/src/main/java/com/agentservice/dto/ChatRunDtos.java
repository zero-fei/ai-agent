package com.agentservice.dto;

/**
 * Chat run 回放摘要 DTO。
 */
public final class ChatRunDtos {
  private ChatRunDtos() {}

  public record ChatRunDto(
      String id,
      String traceId,
      String userId,
      String conversationId,
      String status,
      String error,
      Long preflightMs,
      Long llmConnectMs,
      Long totalMs,
      String createdAt,
      String updatedAt) {
  }
}

