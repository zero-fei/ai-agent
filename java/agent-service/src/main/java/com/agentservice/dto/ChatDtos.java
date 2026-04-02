package com.agentservice.dto;

import java.util.List;
import java.util.Map;

/**
 * 与聊天接口相关的入参 DTO。
 *
 * <p>放在独立 dto 包中，便于 controller/service 复用，避免内嵌类导致引用路径复杂。</p>
 */
public final class ChatDtos {
  private ChatDtos() {}

  /** 单条消息：仅 role/content。 */
  public static class IncomingMessage {
    public String role;
    public String content;
  }

  /** /api/chat 的请求体。 */
  public static class ChatRequestBody {
    public List<IncomingMessage> messages;
    public String conversationId;
    public String collectionId;
    public String skillName;
    public Map<String, Object> skillArgs;
  }
}

