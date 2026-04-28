package com.agentservice.service;

import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * dev/test 故障注入器（通过请求头 X-Fault-Inject 指定故障点）。
 */
@Service
public class FaultInjectionService {
  @Value("${HARNESS_FAULT_INJECTION_ENABLED:false}")
  private boolean enabled;

  public void raiseIfRequested(String requestedPoints, String point) {
    if (!enabled || requestedPoints == null || requestedPoints.isBlank() || point == null || point.isBlank()) {
      return;
    }
    Set<String> selected = Arrays.stream(requestedPoints.split(","))
        .map(String::trim)
        .filter(s -> !s.isEmpty())
        .collect(Collectors.toSet());
    if (selected.contains(point) || selected.contains("*")) {
      throw new IllegalStateException("Fault injected at point: " + point);
    }
  }
}

