package com.agentservice.controller;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 进程与依赖探针：
 * - /healthz: 浅健康，进程可用
 * - /readyz : 深健康，依赖项就绪（DB/关键配置）
 */
@RestController
public class HealthController {
  private final JdbcTemplate jdbcTemplate;

  @Value("${DASHSCOPE_API_KEY:}")
  private String dashscopeApiKey;

  public HealthController(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  @GetMapping("/healthz")
  public ResponseEntity<?> healthz() {
    return ResponseEntity.ok(Map.of("status", "ok", "service", "agent-service"));
  }

  @GetMapping("/readyz")
  public ResponseEntity<?> readyz() {
    Map<String, Object> checks = new LinkedHashMap<>();
    boolean dbOk = false;
    boolean llmKeyOk = dashscopeApiKey != null && !dashscopeApiKey.isBlank();

    try {
      Integer v = jdbcTemplate.queryForObject("SELECT 1", Integer.class);
      dbOk = v != null && v == 1;
    } catch (Exception e) {
      dbOk = false;
    }

    checks.put("db", dbOk ? "ok" : "error");
    checks.put("llmKey", llmKeyOk ? "ok" : "missing");

    boolean ready = dbOk && llmKeyOk;
    checks.put("status", ready ? "ready" : "not_ready");
    return ResponseEntity.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE).body(checks);
  }
}

