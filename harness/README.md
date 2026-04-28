# Harness 回归骨架

这个目录用于维护可重复执行的回归用例。

## 结构

- `cases/*.json`：单条场景输入与断言
- `run-harness.ps1`：批量执行脚本（最小版本）

## 运行

```powershell
# 基础运行（未授权用例 + 可直接跑的公开用例）
pwsh ./harness/run-harness.ps1 -BaseUrl http://localhost:3000

# 带登录态运行（会执行 requiresToken=true 的用例）
pwsh ./harness/run-harness.ps1 -BaseUrl http://localhost:3000 -Token "<auth-token>"

# 自动登录后运行（无需手动复制 token）
pwsh ./harness/run-harness.ps1 -BaseUrl http://localhost:3000 -Username "<username>" -Password "<password>"

# 故障注入演练（需 Java 设置 HARNESS_FAULT_INJECTION_ENABLED=true）
pwsh ./harness/run-harness.ps1 -BaseUrl http://localhost:3000 -Token "<auth-token>" -EnableFaultInjection

# 启用 LLM 正向用例（会执行 requiresLlm=true 的 chat happy path）
pwsh ./harness/run-harness.ps1 -BaseUrl http://localhost:3000 -Username "<username>" -Password "<password>" -EnableLlmCases
```

也可用 npm 脚本一键执行（再通过 `--` 追加参数）：

```powershell
# 等价于基础回归
npm run harness

# 附加登录参数
npm run harness -- -Username "<username>" -Password "<password>"

# 故障注入与 LLM 用例
npm run harness:fault -- -Username "<username>" -Password "<password>"
npm run harness:llm -- -Username "<username>" -Password "<password>"

# 全量串行执行（基础 -> fault -> llm）
npm run harness:full
```

推荐执行顺序：
1. `npm run harness`（快速冒烟）
2. `npm run harness:fault -- -Username "<username>" -Password "<password>"`（容灾/降级路径）
3. `npm run harness:llm -- -Username "<username>" -Password "<password>"`（上游依赖路径）

说明：`harness:full` 用于快速本地串行跑三段基础命令；若需传登录参数，建议按上面的三条命令分别执行。

## CI 模板

最小 CI 环境变量建议：
- `MCP_JAVA_SERVICE_BASE_URL`（Next 代理到 Java）
- `HARNESS_FAULT_INJECTION_ENABLED=true`（执行 fault 用例时）
- `DASHSCOPE_API_KEY`（执行 llm 用例时）
- `HARNESS_USERNAME` / `HARNESS_PASSWORD`（自动登录）
- `HARNESS_ENABLE_FAULT=true`（执行 fault 阶段）
- `HARNESS_ENABLE_LLM=true`（执行 llm 阶段）

示例（Windows runner）：

```powershell
npm ci
npm run dev:all
# 等待服务健康后执行
npm run harness -- -Username "$env:HARNESS_USERNAME" -Password "$env:HARNESS_PASSWORD"
npm run harness:fault -- -Username "$env:HARNESS_USERNAME" -Password "$env:HARNESS_PASSWORD"
npm run harness:llm -- -Username "$env:HARNESS_USERNAME" -Password "$env:HARNESS_PASSWORD"
```

也可以直接使用 CI 包装脚本：

```powershell
$env:HARNESS_BASE_URL = "http://localhost:3000"
$env:HARNESS_USERNAME = "<username>"
$env:HARNESS_PASSWORD = "<password>"
$env:HARNESS_ENABLE_FAULT = "true"
$env:HARNESS_ENABLE_LLM = "false"
npm run harness:ci
```

GitHub Actions 已提供示例工作流：`.github/workflows/harness.yml`

触发策略：
- `pull_request`（到 `main`）：自动执行 base 冒烟（fault/llm 默认关闭）
- `workflow_dispatch`：可手动选择 `enable_fault` / `enable_llm`
- PR 自动触发仅在以下目录有改动时生效：`harness/`、`scripts/`、`src/app/api/`、`java/agent-service/`、`.github/workflows/harness.yml`

需要在仓库 Secrets 中配置：
- `HARNESS_USERNAME`
- `HARNESS_PASSWORD`
- `DASHSCOPE_API_KEY`（仅在开启 LLM 阶段时需要）

触发方式：
- 手动触发 `Harness Regression` 工作流
- 可选输入：
  - `enable_fault=true|false`
  - `enable_llm=true|false`

## 用例格式

```json
{
  "name": "chat-basic",
  "path": "/api/chat",
  "method": "POST",
  "requiresToken": true,
  "requiresFaultInjection": false,
  "includeAuth": true,
  "headers": {
    "X-Fault-Inject": "mcp.logs.list"
  },
  "body": {
    "messages": [{ "role": "user", "content": "你好" }]
  },
  "expectStatus": 200,
  "expectSseEvents": ["delta", "end"],
  "expectBodyContains": ["event:"],
  "expectTraceId": true
}
```

字段说明：
- `requiresToken`: 没传 `-Token` 时自动 `SKIP`
- `requiresFaultInjection`: 没传 `-EnableFaultInjection` 时自动 `SKIP`
- `requiresLlm`: 没传 `-EnableLlmCases` 时自动 `SKIP`
- `includeAuth`: 是否附带 `auth-token` cookie（默认 `true`）
- `headers`: 自定义请求头（例如 `X-Fault-Inject`）
- `expectBodyContains`: 响应文本包含断言
- `expectTraceId`: 断言响应头包含 `X-Trace-Id`

建议至少覆盖三类 `chat` 用例：
- 已授权正常输入（`delta/end`）
- 已授权参数非法（`event: error`，不依赖 LLM）
- 故障注入（`X-Fault-Inject` + `event: error`）

脚本参数说明：
- `-Token`: 显式指定已有 `auth-token`
- `-Username/-Password`: 自动调用 `/api/auth/login` 获取 token（若失败则视为未登录）
- `-EnableFaultInjection`: 开启 `requiresFaultInjection=true` 用例执行（需 Java 同时开启 `HARNESS_FAULT_INJECTION_ENABLED=true`）
- `-EnableLlmCases`: 开启 `requiresLlm=true` 用例执行（建议在 LLM key 与上游网络都稳定时开启）

