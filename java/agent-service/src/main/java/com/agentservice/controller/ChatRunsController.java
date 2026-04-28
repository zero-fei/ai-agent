package com.agentservice.controller;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.agentservice.service.ChatRunService;
import com.agentservice.service.FaultInjectionService;
import com.agentservice.service.McpAuthService;

/**
 * 回放摘要查询接口。
 */
@RestController
public class ChatRunsController {
  private static final Logger log = LoggerFactory.getLogger(ChatRunsController.class);
  private final McpAuthService authService;
  private final ChatRunService chatRunService;
  private final FaultInjectionService faultInjectionService;

  public ChatRunsController(
      McpAuthService authService,
      ChatRunService chatRunService,
      FaultInjectionService faultInjectionService) {
    this.authService = authService;
    this.chatRunService = chatRunService;
    this.faultInjectionService = faultInjectionService;
  }

  @GetMapping("/runs")
  public ResponseEntity<?> list(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestHeader(value = "X-Trace-Id", required = false) String traceId,
      @RequestHeader(value = "X-Fault-Inject", required = false) String faultInjectHeader,
      @RequestParam(value = "traceId", required = false) String traceFilter,
      @RequestParam(value = "limit", required = false, defaultValue = "50") Integer limit) {
    faultInjectionService.raiseIfRequested(faultInjectHeader, "runs.list");
    log.info("chat_runs_list traceId={} traceFilter={} limit={}", traceId, traceFilter, limit);
    var uidOpt = authService.getUserIdFromAuthorization(authorization);
    if (uidOpt.isEmpty()) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Unauthorized"));
    }
    int bounded = limit == null ? 50 : limit;
    return ResponseEntity.ok(chatRunService.listByUser(uidOpt.get(), traceFilter, bounded));
  }

  @GetMapping("/runs/{id}")
  public ResponseEntity<?> get(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestHeader(value = "X-Trace-Id", required = false) String traceId,
      @RequestHeader(value = "X-Fault-Inject", required = false) String faultInjectHeader,
      @PathVariable("id") String id) {
    faultInjectionService.raiseIfRequested(faultInjectHeader, "runs.get");
    log.info("chat_runs_get traceId={} id={}", traceId, id);
    var uidOpt = authService.getUserIdFromAuthorization(authorization);
    if (uidOpt.isEmpty()) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Unauthorized"));
    }
    var run = chatRunService.getById(uidOpt.get(), id);
    if (run == null) {
      return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not found"));
    }
    return ResponseEntity.ok(run);
  }
}

