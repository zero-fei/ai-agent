package com.agentservice.controller;

import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.agentservice.dto.McpToolDtos.ToolCallRequest;
import com.agentservice.service.McpToolService;

/**
 * MCP 工具调用网关（对应 Next {@code src/lib/mcp.ts} 的 {@code MCP_JAVA_TOOL_GATEWAY_URL}）。
 */
@RestController
@RequestMapping("/mcp/tool")
public class McpToolController {
  private final McpToolService toolService;

  public McpToolController(McpToolService toolService) {
    this.toolService = toolService;
  }

  /** POST /mcp/tool/call */
  @PostMapping("/call")
  public ResponseEntity<?> call(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody ToolCallRequest req) {
    try {
      if (req == null || req.serverKey == null || req.toolName == null) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", "serverKey/toolName is required"));
      }
      Map<String, Object> args = req.arguments == null ? Map.of() : req.arguments;
      Map<String, Object> resp = toolService.callTool(authorization, req.serverKey, req.toolName, args);
      return ResponseEntity.ok(resp);
    } catch (IllegalArgumentException e) {
      return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of("error", e.getMessage()));
    } catch (Exception e) {
      return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", e.getMessage()));
    }
  }
}

