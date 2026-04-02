package com.agentservice.dto;

import java.util.Map;

/**
 * MCP 工具调用网关（/mcp/tool/call）对应的 DTO。
 */
public final class McpToolDtos {
  private McpToolDtos() {}

  public static class ToolCallRequest {
    public String serverKey;
    public String toolName;
    public Map<String, Object> arguments;
  }

  public static class ToolCallResponse {
    public Object result;

    public ToolCallResponse(Object result) {
      this.result = result;
    }
  }
}

