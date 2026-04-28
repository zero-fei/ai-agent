package com.agentservice.controller;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import com.agentservice.service.McpAuthService;
import com.agentservice.service.FaultInjectionService;
import com.agentservice.service.McpManagementService;

/**
 * MCP 操作日志查询。
 *
 * 对应 Next 代理：{@code GET /api/mcp/logs} -> {@code GET /mcp/logs}。
 */
@RestController
public class McpLogsController {
  private static final Logger log = LoggerFactory.getLogger(McpLogsController.class);

  private final McpAuthService authService;
  private final McpManagementService managementService;
  private final FaultInjectionService faultInjectionService;

  public McpLogsController(
      McpAuthService authService,
      McpManagementService managementService,
      FaultInjectionService faultInjectionService) {
    this.authService = authService;
    this.managementService = managementService;
    this.faultInjectionService = faultInjectionService;
  }

  /** GET /mcp/logs */
  @GetMapping("/mcp/logs")
  public ResponseEntity<?> logs(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestHeader(value = "X-Trace-Id", required = false) String traceId,
      @RequestHeader(value = "X-Fault-Inject", required = false) String faultInjectHeader,
      @RequestParam(value = "serverId", required = false) String serverId,
      @RequestParam(value = "limit", required = false, defaultValue = "100") Integer limit) {
    faultInjectionService.raiseIfRequested(faultInjectHeader, "mcp.logs.list");
    log.info("mcp_logs_list traceId={} serverId={} limit={}", traceId, serverId, limit);
    var uidOpt = authService.getUserIdFromAuthorization(authorization);
    if (uidOpt.isEmpty()) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Unauthorized"));
    }
    int boundedLimit = limit == null ? 100 : limit;
    return ResponseEntity.ok(managementService.listLogs(uidOpt.get(), serverId, boundedLimit));
  }
}

