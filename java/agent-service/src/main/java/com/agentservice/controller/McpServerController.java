package com.agentservice.controller;

import java.util.Map;
import java.util.Optional;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.agentservice.dto.McpDtos.McpServerDto;
import com.agentservice.service.McpAuthService;
import com.agentservice.service.McpManagementService;

/**
 * MCP Server 的 CRUD 与运维操作（对应 Next 代理路径 {@code /api/mcp/servers*}）。
 */
@RestController
@RequestMapping("/mcp/servers")
public class McpServerController {

  private final McpAuthService authService;
  private final McpManagementService managementService;

  public McpServerController(McpAuthService authService, McpManagementService managementService) {
    this.authService = authService;
    this.managementService = managementService;
  }

  private Optional<String> getUserId(String authorization) {
    return authService.getUserIdFromAuthorization(authorization);
  }

  /** GET /mcp/servers */
  @GetMapping
  public ResponseEntity<?> list(@RequestHeader(value = "Authorization", required = false) String authorization) {
    Optional<String> uidOpt = getUserId(authorization);
    if (uidOpt.isEmpty()) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Unauthorized"));
    }
    return ResponseEntity.ok(managementService.listServers(uidOpt.get()));
  }

  /** POST /mcp/servers */
  @PostMapping
  public ResponseEntity<?> create(@RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody Map<String, Object> body) {
    Optional<String> uidOpt = getUserId(authorization);
    if (uidOpt.isEmpty()) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Unauthorized"));
    }
    String userId = uidOpt.get();

    String name = body.get("name") == null ? null : String.valueOf(body.get("name")).trim();
    String serverKey = body.get("serverKey") == null ? null : String.valueOf(body.get("serverKey")).trim();
    Object endpointRaw = body.get("endpoint");
    String endpoint = endpointRaw == null ? null : String.valueOf(endpointRaw).trim();
    if (endpoint != null && endpoint.isEmpty()) endpoint = null;
    Object config = body.containsKey("config") ? body.get("config") : null;

    if (name == null || name.isEmpty()) return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", "name is required"));
    if (serverKey == null || serverKey.isEmpty())
      return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", "serverKey is required"));

    McpServerDto created = managementService.createServer(userId, name, serverKey, endpoint, config);
    return ResponseEntity.status(HttpStatus.CREATED).body(created);
  }

  /**
   * PATCH /mcp/servers/{id}
   *
   * <p>若 body 含 {@code enabled}：仅切换启用/停用；否则按字段更新。</p>
   */
  @PatchMapping("/{id}")
  public ResponseEntity<?> update(@RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable("id") String id, @RequestBody Map<String, Object> body) {
    Optional<String> uidOpt = getUserId(authorization);
    if (uidOpt.isEmpty()) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Unauthorized"));
    }
    String userId = uidOpt.get();

    if (body != null && body.containsKey("enabled")) {
      Object enabledRaw = body.get("enabled");
      boolean enabled;
      if (enabledRaw instanceof Boolean b) {
        enabled = b;
      } else if (enabledRaw instanceof Number n) {
        enabled = n.intValue() == 1;
      } else {
        enabled = Boolean.parseBoolean(String.valueOf(enabledRaw));
      }
      return ResponseEntity.ok(managementService.setServerEnabled(userId, id, enabled));
    }

    return ResponseEntity.ok(managementService.updateServer(userId, id, body));
  }

  /** DELETE /mcp/servers/{id} */
  @DeleteMapping("/{id}")
  public ResponseEntity<?> delete(@RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable("id") String id) {
    Optional<String> uidOpt = getUserId(authorization);
    if (uidOpt.isEmpty()) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Unauthorized"));
    }
    boolean deleted = managementService.deleteServer(uidOpt.get(), id);
    if (!deleted) return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", "not found"));
    return ResponseEntity.ok(Map.of("deleted", true));
  }

  /** POST /mcp/servers/{id}/auth */
  @PostMapping("/{id}/auth")
  public ResponseEntity<?> auth(@RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable("id") String id) {
    Optional<String> uidOpt = getUserId(authorization);
    if (uidOpt.isEmpty()) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Unauthorized"));
    }
    try {
      return ResponseEntity.ok(managementService.runServerAuth(uidOpt.get(), id));
    } catch (IllegalStateException e) {
      return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", e.getMessage()));
    }
  }

  /** POST /mcp/servers/{id}/health */
  @PostMapping("/{id}/health")
  public ResponseEntity<?> health(@RequestHeader(value = "Authorization", required = false) String authorization,
      @PathVariable("id") String id) {
    Optional<String> uidOpt = getUserId(authorization);
    if (uidOpt.isEmpty()) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", "Unauthorized"));
    }
    try {
      return ResponseEntity.ok(managementService.runHealthCheck(uidOpt.get(), id));
    } catch (IllegalStateException e) {
      return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", e.getMessage()));
    }
  }
}

