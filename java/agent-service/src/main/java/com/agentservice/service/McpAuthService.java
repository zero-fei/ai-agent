package com.agentservice.service;

import java.time.Instant;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 鉴权服务：把 HTTP 头里的 {@code Authorization: Bearer <token>} 映射为用户 ID。
 *
 * <p>token 存储于 SQLite 表 {@code sessions}，并通过 {@code expiresAt} 判断是否过期。</p>
 */
@Service
public class McpAuthService {
  private final JdbcTemplate jdbcTemplate;

  public McpAuthService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public Optional<String> getUserIdFromAuthorization(String authorizationHeader) {
    String token = extractBearerToken(authorizationHeader);
    if (token == null) return Optional.empty();

    String now = Instant.now().toString();
    try {
      String userId = jdbcTemplate.queryForObject(
          "SELECT userId FROM sessions WHERE token = ? AND expiresAt > ?",
          String.class, token, now);
      return Optional.ofNullable(userId);
    } catch (Exception e) {
      return Optional.empty();
    }
  }

  private String extractBearerToken(String authorizationHeader) {
    if (authorizationHeader == null) return null;
    String h = authorizationHeader.trim();
    if (!h.toLowerCase().startsWith("bearer ")) return null;
    return h.substring(7).trim();
  }
}

