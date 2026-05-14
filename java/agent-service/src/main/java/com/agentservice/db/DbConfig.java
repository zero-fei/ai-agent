package com.agentservice.db;

import javax.sql.DataSource;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * 数据源配置：与 Next.js 共用同一份 SQLite（默认仓库根目录下的 {@code database.db}）。
 *
 * <p>可通过 {@code DB_PATH} 指定文件路径；未指定时由 {@link AgentServiceApplication} 在启动前解析为与
 * Next {@code process.cwd()/database.db} 一致的路径，避免从 {@code java/agent-service} 目录启动时连错库。</p>
 */
@Configuration
public class DbConfig {
  /** SQLite 文件路径，未配置时默认为当前工作目录下的 {@code database.db} */
  @Value("${DB_PATH:./database.db}")
  private String dbPath;

  /** 注册 JDBC {@link DataSource}，供 {@link org.springframework.jdbc.core.JdbcTemplate} 使用。 */
  @Bean
  public DataSource dataSource() {
    DriverManagerDataSource ds = new DriverManagerDataSource();
    ds.setDriverClassName("org.sqlite.JDBC");
    ds.setUrl("jdbc:sqlite:" + dbPath);
    return ds;
  }
}

