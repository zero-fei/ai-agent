package com.agentservice.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;

/**
 * 启动期配置契约校验（fail-fast）。
 *
 * <p>默认要求配置 DASHSCOPE_API_KEY，避免运行期才暴露关键配置缺失问题。
 * 如需本地临时跳过，可设置 ALLOW_MISSING_LLM_KEY=true。</p>
 */
@Component
public class StartupConfigValidator {
  @Value("${DASHSCOPE_API_KEY:}")
  private String dashscopeApiKey;

  @Value("${ALLOW_MISSING_LLM_KEY:false}")
  private boolean allowMissingLlmKey;

  @PostConstruct
  public void validate() {
    if (!allowMissingLlmKey && (dashscopeApiKey == null || dashscopeApiKey.isBlank())) {
      throw new IllegalStateException(
          "DASHSCOPE_API_KEY is required. Set ALLOW_MISSING_LLM_KEY=true to bypass in local/dev.");
    }
  }
}

