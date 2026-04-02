package com.agentservice.db;

import javax.sql.DataSource;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

/**
 * 数据源配置：与 Next.js 应用共用同一份 SQLite 文件（默认 {@code database.db}）。
 *
 * <p>可通过环境变量或配置项 {@code DB_PATH} 指定数据库文件路径。</p>
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

