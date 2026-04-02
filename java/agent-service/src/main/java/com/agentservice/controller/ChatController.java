package com.agentservice.controller;

import java.util.Map;
import java.util.Optional;

import com.agentservice.service.ChatService;
import com.agentservice.service.McpAuthService;
import com.agentservice.dto.ChatDtos.ChatRequestBody;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

/**
 * 聊天接口：接收前端（经 Next 代理）转发的对话请求，并以 SSE 流式返回。
 */
@RestController
public class ChatController {
  private static final Logger log = LoggerFactory.getLogger(ChatController.class);

  private final McpAuthService authService;
  private final ChatService chatService;

  public ChatController(McpAuthService authService, ChatService chatService) {
    this.authService = authService;
    this.chatService = chatService;
  }

  /**
   * POST /api/chat
   *
   * <p>使用 {@link SseEmitter} 异步推送。实际业务在新线程里执行，避免阻塞请求线程。</p>
   */
  @PostMapping(value = "/api/chat", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
  public SseEmitter chat(
      @RequestHeader(value = "Authorization", required = false) String authorization,
      @RequestBody ChatRequestBody body) {

    SseEmitter emitter = new SseEmitter(0L);

    new Thread(() -> {
      try {
        int msgCount = body == null || body.messages == null ? 0 : body.messages.size();
        log.info("Java ChatController hit: hasAuthHeader={}, msgCount={}, hasConversationId={}",
            authorization != null && !authorization.isBlank(),
            msgCount,
            body != null && body.conversationId != null && !body.conversationId.isBlank());

        Optional<String> uidOpt = authService.getUserIdFromAuthorization(authorization);
        if (uidOpt.isEmpty()) {
          log.warn("Java ChatController unauthorized: userId not found/expired.");
          emitter.send(SseEmitter.event().name("error").data(Map.of("error", "Unauthorized")));
          emitter.complete();
          return;
        }
        String userId = uidOpt.get();
        log.info("Java ChatController authorized: userId={}", userId);
        chatService.handleChatSse(userId, authorization, body, emitter);
      } catch (Exception e) {
        try {
          String errMsg = e.getMessage() == null ? String.valueOf(e) : e.getMessage();
          emitter.send(SseEmitter.event().name("error").data(Map.of("error", errMsg)));
        } catch (Exception ignored) {
        }
        emitter.completeWithError(e);
      }
    }).start();

    return emitter;
  }
}

