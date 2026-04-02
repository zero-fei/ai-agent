package com.agentservice;

import java.io.BufferedReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * Agent 服务入口。
 *
 * <p>为了开发便利：允许你只在项目根目录配置 {@code .env.local}，
 * 启动时会把其中的 {@code KEY=VALUE} 注入到 JVM System properties，
 * 使得 Spring 的 {@code @Value("${KEY}")} 能拿到值。</p>
 */
@SpringBootApplication
public class AgentServiceApplication {
  private static final Logger log = LoggerFactory.getLogger(AgentServiceApplication.class);

  public static void main(String[] args) {
    // 在 Spring 容器启动前注入 .env.local（如果能找到）
    loadDotEnvLocalIfPresent();
    SpringApplication.run(AgentServiceApplication.class, args);
  }

  private static final Pattern ENV_LINE = Pattern.compile("^\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*(.*)\\s*$");

  private static void loadDotEnvLocalIfPresent() {
    Path cwd = Paths.get("").toAbsolutePath().normalize();
    Path env = resolveEnvLocalUpwards(cwd, 12);
    if (env == null || !Files.isRegularFile(env)) {
      log.warn("未找到 .env.local（当前工作目录为：{}），将依赖系统环境变量/启动参数。", cwd);
      return;
    }

    try (BufferedReader br = Files.newBufferedReader(env, StandardCharsets.UTF_8)) {
      String line;
      int injected = 0;
      while ((line = br.readLine()) != null) {
        String t = line.trim();
        if (t.isEmpty() || t.startsWith("#")) continue;
        if (t.startsWith("export ")) t = t.substring("export ".length()).trim();

        Matcher m = ENV_LINE.matcher(t);
        if (!m.matches()) continue;

        String key = m.group(1);
        String rawValue = m.group(2);
        if (rawValue == null) rawValue = "";
        String value = stripOptionalQuotes(rawValue.trim());

        System.setProperty(key, value);
        injected++;
      }
      log.info("已从 {} 注入 {} 个配置项（不打印 value）。", env, injected);
    } catch (Exception ignored) {
      // 只做开发期增强，不阻断服务启动
    }
  }

  private static Path resolveEnvLocalUpwards(Path start, int maxUp) {
    Path cur = start;
    for (int i = 0; i <= maxUp; i++) {
      Path candidate = cur.resolve(".env.local");
      if (Files.isRegularFile(candidate)) return candidate;
      Path parent = cur.getParent();
      if (parent == null) break;
      cur = parent;
    }
    return null;
  }

  private static String stripOptionalQuotes(String s) {
    if (s == null || s.isEmpty()) return s;
    if ((s.startsWith("\"") && s.endsWith("\"")) || (s.startsWith("'") && s.endsWith("'"))) {
      return s.substring(1, s.length() - 1);
    }
    return s;
  }
}

