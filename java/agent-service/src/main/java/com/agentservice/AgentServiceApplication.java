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
    // 与 Next.js（process.cwd()/database.db）对齐：从 java/agent-service 启动时不要用错库
    ensureSharedDatabasePathWithNext();
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

  /**
   * 将 {@code DB_PATH} 对齐到与 Next 相同的 {@code database.db}（仓库根目录）。
   *
   * <p>Next 使用 {@code path.resolve(process.cwd(), 'database.db')}；若从 {@code java/agent-service} 下执行
   * {@code mvn spring-boot:run}，默认 {@code ./database.db} 会落到子目录，导致 sessions 与 Next 不一致，
   * 出现 {@code chat_unauthorized}（有 Bearer 但查不到用户）。</p>
   *
   * <p>规则：已配置<strong>绝对路径</strong>的 {@code DB_PATH} 时不覆盖；相对路径且为默认文件名时改为根目录下的库。</p>
   */
  private static void ensureSharedDatabasePathWithNext() {
    Path cwd = Paths.get("").toAbsolutePath().normalize();
    Path repoRoot = resolveMonorepoAppRoot(cwd, 14);
    Path sharedDb = repoRoot.resolve("database.db").toAbsolutePath().normalize();

    String raw = System.getProperty("DB_PATH");
    if (raw == null) {
      raw = System.getenv("DB_PATH");
    }
    if (raw == null || raw.isBlank()) {
      System.setProperty("DB_PATH", sharedDb.toString());
      log.info("未设置 DB_PATH，已对齐 Next 默认 SQLite：{}", sharedDb);
      return;
    }

    String trimmed = raw.trim();
    Path configured = Paths.get(trimmed);
    if (configured.isAbsolute()) {
      log.info("DB_PATH 为绝对路径，保持用户配置：{}", configured.toAbsolutePath().normalize());
      return;
    }

    String norm = trimmed.replace('\\', '/');
    if ("./database.db".equals(norm) || "database.db".equals(norm)) {
      System.setProperty("DB_PATH", sharedDb.toString());
      log.info("DB_PATH 为相对默认库名，已对齐 Next 仓库根目录：{}（原相对值：{}）", sharedDb, trimmed);
      return;
    }

    Path resolved = cwd.resolve(configured).normalize().toAbsolutePath();
    System.setProperty("DB_PATH", resolved.toString());
    log.info("DB_PATH 为相对路径，已基于当前工作目录解析为：{}", resolved);
  }

  /**
   * 解析「含 package.json 与 java/agent-service/pom.xml」的仓库根（agent-app 根目录）。
   */
  private static Path resolveMonorepoAppRoot(Path start, int maxUp) {
    Path cur = start;
    for (int i = 0; i <= maxUp; i++) {
      Path pkg = cur.resolve("package.json");
      Path nestedPom = cur.resolve("java/agent-service/pom.xml");
      if (Files.isRegularFile(pkg) && Files.isRegularFile(nestedPom)) {
        return cur;
      }
      Path parent = cur.getParent();
      if (parent == null) {
        break;
      }
      cur = parent;
    }
    log.warn("未解析到含 package.json 与 java/agent-service 的根目录，DB_PATH 回退使用当前目录：{}", start);
    return start;
  }
}

