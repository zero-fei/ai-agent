## ai-agent-app

一个基于 **Next.js App Router** 的「对话式 AI Agent」Web 应用，内置登录/注册、会话管理、对话历史、流式输出，并已接入 **MCP 管理 + 工具调用** 与 **RAG 知识库**。

### 技术栈

- **框架**：Next.js 16（App Router / Route Handlers）
- **语言**：TypeScript
- **UI**：React 19 + Ant Design
- **样式**：CSS Modules（页面/组件样式已从行内样式抽离）
- **LLM 编排**：LangChain（`@langchain/*`）
- **数据存储**：SQLite（`better-sqlite3`，本地文件 DB）
- **认证**：Cookie Session（`auth-token`）

### 平台功能

- **账号体系**
  - 注册：`/auth/register`
  - 登录：`/auth/login`
  - 会话查询：`/api/auth/session`
  - 登出：`/api/auth/logout`
- **对话/Agent**
  - 主界面：`/agent`
  - 支持 **流式输出**（Route Handler 返回 `ReadableStream`）
  - 自动创建会话并写入数据库（conversations/messages）
  - 左侧会话列表：支持点击切换历史会话
- **扩展入口**
  - MCP 管理入口（已实现）
  - 知识库入口（已实现）

### MCP 管理与调用（已接入）

#### 管理能力

- MCP Server 列表、创建、编辑、删除
- 启用/停用
- 认证状态与健康检查
- 操作日志（`mcp_logs`）
- 在管理页可编辑 `config JSON`，支持本地 Node 工具代码（Monaco Editor）

#### 聊天调用能力

聊天支持三种 MCP 触发方式：

- 标准：`@mcp(serverKey,toolName) {"arg":"value"}`
- 简化：`@mcp(serverKey) {"arg":"value"}`（仅当该 server 只有一个工具）
- 自然语言：输入包含“调用/执行/工具/tool/call”等关键词时，会尝试命中 serverKey/toolName 并触发调用（否则不触发）

此外，普通聊天在“疑似需要动作/外部查询”时会走一轮「工具规划」：

1. 手动 `@mcp(...)` 优先  
2. 其次启发式（关键词/命中 serverKey/toolName）  
3. 仅当输入看起来像要执行动作/查询外部数据时，才会调用一次 LLM 做 JSON 决策（避免每次聊天都额外耗时）
4. 若命中 MCP：先调用工具，再把工具结果回灌给模型生成最终回答

### Agent Skill（文件驱动，只读管理）

Skill 不走数据库，统一存放在项目目录 `skills/*.md`，并采用固定模板。应用内用户只能查看与使用 Skill，不能在页面里编辑；Skill 变更通过 Agent 修改 md 文件完成。

#### 存储与格式

- 存储目录：`skills/`
- 每个 Skill 一个 markdown 文件（例如 `skills/frontend-code-review.md`）
- 必填 frontmatter：
  - `name`
  - `description`
- 必填章节：
  - `# <title>`
  - `## Intent`
  - `## Checklist`
  - `## Review Process`
  - `## Required output`
- `## Required output` 内必须包含 `Template A` 与 `Template B`

格式不合法的 Skill 会被标记为 `invalid`，并在自动选择时跳过。

#### API（只读）

- `GET /api/skills`：返回 Skill 列表（含 `valid/errors`）
- `GET /api/skills/{name}`：返回 Skill 详情与全文内容

> 不提供 `POST/PATCH/DELETE /api/skills`；前端无编辑入口。

#### 对话接入

`/api/chat` 支持：

- `skillName`（可选）：手动指定 Skill
- `skillArgs`（可选）：Skill 参数 JSON 对象

当前实现为“手动选择 Skill”：仅当传入 `skillName` 时，Java 会读取 `skills/{skillName}.md` 内容并注入 system prompt。

后端实现位置：[ChatService.java](file:///f:/huya/kefu/zx-ai-agent/agent-app/java/agent-service/src/main/java/com/agentservice/service/ChatService.java)

### 本地启动（Next + Java Agent Service）

#### 环境要求

- **Node.js**：建议 **18.18+**，推荐 **20+**（当前项目使用 Next 16 / React 19，Node 14 会出现 `node:timers/promises` 等内置模块缺失错误）
- **Java**：21+

1) 安装依赖：

```bash
npm install
```

2) 配置环境变量（推荐在项目根目录新建 `.env.local`）：

```bash
# 必填：DashScope / 通义模型 API Key
DASHSCOPE_API_KEY=xxxxx

# 可选：自定义 baseURL（推荐使用 compatible-mode）
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# 可选：对话模型（默认 qwen-plus）
DASHSCOPE_CHAT_MODEL=qwen-plus

# 可选：慢请求阈值（毫秒），超过会输出 chat_timing_slow 日志
CHAT_SLOW_MS=8000

# 可选：Embeddings（用于 RAG/Memory 检索）
DASHSCOPE_API_KEY_EMBEDDINGS=xxxxx
DASHSCOPE_EMBEDDINGS_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
DASHSCOPE_EMBEDDING_MODEL=text-embedding-v2

# 可选：MCP 直连桥接地址（优先于 endpoint fallback）
# 未配置时，工具调用会使用 MCP 管理页中的 endpoint
MCP_DIRECT_BRIDGE_URL=http://localhost:8787/mcp/call
```

3) 启动 Java Agent Service：

**注意：聊天与记忆抽取由 Java 直连 DashScope 兼容接口**，`DASHSCOPE_API_KEY` 等必须对 **Java 进程**生效。本项目会在 Java 启动时尝试从项目根目录向上查找 `.env.local` 并注入为 JVM System properties（不打印 value），便于本地开发。

实现位置：[AgentServiceApplication.java](file:///f:/huya/kefu/zx-ai-agent/agent-app/java/agent-service/src/main/java/com/agentservice/AgentServiceApplication.java)

```bash
# 示例（与 .env.local 中 key 保持一致）
export DASHSCOPE_API_KEY=你的Key
cd java/agent-service
mvn -DskipTests spring-boot:run
```

Windows PowerShell：

```powershell
$env:DASHSCOPE_API_KEY="你的Key"
cd java/agent-service; mvn -DskipTests spring-boot:run
```

若出现 **`LLM HTTP 401`**，表示通义侧拒绝鉴权：检查 Key 是否有效、是否已传给 Java、以及 `DASHSCOPE_COMPAT_BASE_URL` 是否与 Key 类型（国际站/北京地域等）一致。

4) 在项目根目录 `.env.local` 增加 Java 网关地址：

```bash
MCP_JAVA_SERVICE_BASE_URL=http://localhost:18081
MCP_JAVA_TOOL_GATEWAY_URL=http://localhost:18081
```

5) 启动 Next.js 开发服务器：

```bash
npm run dev
```

**或**在已配置 `.env.local` 的前提下，一条命令同时起 Next 与 Java（依赖 `devDependencies` 中的 `concurrently`，随 `npm install` 安装）：

```bash
npm run dev:all
```

打开 `http://localhost:3000`。

### 性能与日志（排查“为什么慢”）

Java 侧会输出分阶段耗时日志，推荐用来定位是“前置处理慢”还是“模型首字慢”：

- `chat_timing_preflight`：从请求开始到发起主 LLM 流之前的耗时（包含落库、并行的 RAG/Memory/Skill、MCP 选择等）
  - `preflightMs`：前置总耗时
  - `promptChars`：system + 最新用户输入的字符数（用于判断 prompt 是否过大）
- `chat_timing_total`：主链路总耗时（不包含异步记忆抽取）
  - `llmConnectMs`：建立到 LLM 流响应的耗时
  - `ttftMs`：首 token 时间
  - `streamMs`：流式读取总时间
  - `totalMs`：请求总耗时（到 end 事件发送完成为止）
- `chat_timing_slow`：当 `totalMs >= CHAT_SLOW_MS` 时输出告警
- `chat_async_memory_done`：异步记忆抽取耗时（不会阻塞用户看到回答结束）

### 常用脚本

```bash
# 仅前端
npm run dev

# 仅 Java Agent Service（等价于在 java/agent-service 下 mvn spring-boot:run）
npm run dev:java

# Next + Java 并行（Ctrl+C 会结束两个进程）
npm run dev:all

# 构建
npm run build

# 生产启动
npm run start

# 代码规范检查
npm run lint
```

### 目录结构（简要）

- `src/app/auth/*`：登录/注册页面
- `src/app/agent/*`：Agent 对话页面与消息组件
- `src/app/api/*`：后端 API（认证、聊天、会话、MCP、知识库）
- `src/lib/auth.ts`：用户/会话（SQLite）逻辑
- `src/lib/db.ts`：SQLite 连接
- `src/lib/llm.ts`：LangChain 调用与流式输出封装
- `src/lib/mcp.ts`：MCP Server 管理、工具执行、日志（java_only）
- `src/lib/rag.ts`：RAG 入库/检索与 prompt 构建
- `java/agent-service/*`：Java 侧 Agent 后端（chat/mcp/memory/rag）

### 说明与约束

- **数据库**：默认使用本地 SQLite 文件（仓库中可见 `database.db`）。生产部署建议使用持久化存储，并按需迁移到独立 DB 服务。
- **鉴权**：API 主要通过 `auth-token` cookie 识别用户，会话在请求中会自动续期。
- **消息角色**：LLM 输入目前只接收 `user/assistant` 角色（会过滤掉其它 role），如需 `system` 消息请同步扩展 `src/lib/llm.ts` 的消息类型与 prompt 组装逻辑。
- **System Prompt 规则**：`defaultSystemPrompt` 始终在前，API 传入的 `systemPrompt` 会拼接在后。
- **安全**：不要提交真实密钥到仓库。若曾提交过 `.env.local` 或 Key，请尽快轮换密钥并从版本库移除敏感信息。
- **MCP 调用模式（当前）**：Next API 会将工具调用转发到 Java 网关（`MCP_JAVA_TOOL_GATEWAY_URL`），不再使用 Node fallback。
- **Java 工具执行**：Java 侧支持本地 JS 工具（GraalVM）与 endpoint/bridge 调用，建议生产环境配置白名单与审计策略。

### RAG 知识库（已接入）

本项目的知识库是可直接上线的最小 RAG 方案，核心链路：

1. 文本清洗（可配置）  
2. 分段切片（chunk + overlap）  
3. embeddings 向量化  
4. SQLite 落盘（documents/chunks/fts）  
5. 对话时检索召回并注入 `systemPrompt`

#### 数据模型与能力

- `kb_collections`：知识库集合（多库隔离，按用户隔离）
- `kb_documents`：文档元数据（标题、来源、所属集合）
- `kb_chunks`：切片内容 + embedding（JSON 序列化向量）
- `kb_chunks_fts`：FTS5 候选召回（可选，环境不支持时自动降级）

检索策略是 **Hybrid Retrieval**：

- 第一阶段：FTS5 候选召回（快）
- 第二阶段：对候选按余弦相似度精排（准）
- FTS 不可用时自动回退到 collection 内向量扫描

#### 环境变量

在 `.env.local` 中配置：

```bash
# 主对话模型
DASHSCOPE_API_KEY=xxxxx
DASHSCOPE_BASE_URL=https://coding.dashscope.aliyuncs.com/v1

# embeddings（RAG 用）
DASHSCOPE_API_KEY_EMBEDDINGS=xxxxx
DASHSCOPE_EMBEDDING_MODEL=text-embedding-v2

# 可选：embeddings baseURL（不填则复用 DASHSCOPE_BASE_URL）
DASHSCOPE_EMBEDDINGS_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

说明：

- 未配置 `DASHSCOPE_API_KEY_EMBEDDINGS` 时，`/api/chat` 会自动跳过知识库检索，不影响主对话链路。

#### Collection 配置项（可视化可改）

每个知识库集合支持这些清洗/分段参数：

- `chunkSize`：单片最大长度（默认 `800`）
- `chunkOverlap`：相邻片重叠（默认 `120`）
- `mergeEmptyLines`：合并空行
- `trimSpaces`：行级 trim
- `stripHtml`：去 HTML 标签
- `stripMarkdown`：去 Markdown 语法
- `removeNoiseLines`：去噪声分隔线（如 `-----`）

配置更新接口：`PUT /api/kb/collections/{id}`，body:

```json
{
  "config": {
    "chunkSize": 1000,
    "chunkOverlap": 150,
    "stripMarkdown": true
  }
}
```

#### API（推荐用 `/api/kb/*`）

> 目前同时存在 `/api/kb/*` 与 `/api/knowledge/*` 两套路径，功能基本一致。新接入建议统一走 `/api/kb/*`。

- 集合管理
  - `GET /api/kb/collections`：集合列表
  - `POST /api/kb/collections`：创建集合
    - body: `{ "name": "FAQ", "description": "可选" }`
  - `PUT /api/kb/collections/{id}`：更新集合配置（见上）
  - `DELETE /api/kb/collections/{id}`：删除集合（级联清理 docs/chunks/fts）

- 文档管理
  - `GET /api/kb/documents?collectionId=<id|null>`：文档列表
  - `POST /api/kb/documents`：文本入库
    - body: `{ "name": "xxx", "text": "...", "source": "可选", "collectionId": "可选" }`
  - `DELETE /api/kb/documents/{id}`：删除文档（含 chunks/fts）

- 文件入库
  - `POST /api/kb/upload`（`multipart/form-data`）
  - 支持 `PDF/DOCX/MD/TXT`
  - fields:
    - `file`（必填）
    - `name`（可选，默认文件名）
    - `source`（可选）
    - `collectionId`（可选）

- 检索调试
  - `POST /api/kb/search`
  - body: `{ "query": "...", "collectionId": "可选", "topK": 5, "candidateK": 50 }`

#### 对话集成方式

调用 `/api/chat` 时，服务端会：

1. 取最后一条用户问题  
2. 按当前会话选择的 `collectionId` 检索命中 chunks  
3. 将命中片段拼接为 RAG `systemPrompt`  
4. 再调用 LLM 生成回复

前端只需透传 `collectionId`（可为空）；不需要改消息结构。

#### 生产建议

- 大数据量建议迁移到专业向量库（Milvus/PGVector/ES 等）
- 为 `kb_chunks` 控制总量（归档旧文档）
- 上传前做文件大小与类型限制
- 对高并发场景增加异步入库队列

### MCP 配置示例（本地 Node 工具）

在 MCP 管理页新建一个 server（例如 `serverKey=HelloWordMcp`），`config JSON` 可填：

```json
{
  "runtime": "node",
  "tools": {
    "hello": "return \"hello world\";"
  }
}
```

调用示例：

```text
@mcp(HelloWordMcp,hello) {}
```

或（单工具简化）：

```text
@mcp(HelloWordMcp) {}
```
