package com.agentservice.controller;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.agentservice.service.McpAuthService;
import com.agentservice.service.McpManagementService;

/**
 * MCP 操作日志查询。
 *
 * 对应 Next 代理：{@code GET /api/mcp/logs} -> {@code GET /mcp/logs}。
 */
@RestController
public class McpLogsController {

  private final McpAuthService authService;
  private final McpManagementService managementService;

  public McpLogsController(McpAuthService authService, McpManagementService managementService) {
    this.authService = authService;
    this.managementService = managementService;
  }

  /** GET /mcp/logs */
  @GetMapping("/mcp/logs")
  public ResponseEntity<?> logs(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestParam(value = "serverId", required = false) String serverId,
      @RequestParam(value = "limit", required = false, defaultValue = "100") Integer limit) {
    var uidOpt = authService.getUserIdFromAuthorization(authorization);
    if (uidOpt.isEmpty()) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Unauthorized"));
    }
    int boundedLimit = limit == null ? 100 : limit;
    return ResponseEntity.ok(managementService.listLogs(uidOpt.get(), serverId, boundedLimit));
  }
}

