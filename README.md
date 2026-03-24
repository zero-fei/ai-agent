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
- 自然语言：`调用serverKey {"arg":"value"}`（同上）

此外，普通聊天会先走一轮「工具规划」：

1. Agent 将可用工具清单注入给模型  
2. 模型返回 `call_tool` / `no_tool` 决策  
3. 若 `call_tool`，Agent 调用 MCP 工具  
4. 工具结果回灌给模型，生成最终回答

开发环境可通过响应头观察决策：

- `X-MCP-Plan-Action`：`manual_call` / `call_tool` / `no_tool` / `none`
- `X-MCP-Plan-Tool`：如 `HelloWordMcp/hello`

### 本地启动

1) 安装依赖：

```bash
npm install
```

2) 配置环境变量（推荐在项目根目录新建 `.env.local`）：

```bash
# 必填：DashScope / 通义模型 API Key
DASHSCOPE_API_KEY=xxxxx

# 可选：自定义 baseURL（默认 https://coding.dashscope.aliyuncs.com/v1）
DASHSCOPE_BASE_URL=https://coding.dashscope.aliyuncs.com/v1

# 可选：MCP 直连桥接地址（优先于 endpoint fallback）
# 未配置时，工具调用会使用 MCP 管理页中的 endpoint
MCP_DIRECT_BRIDGE_URL=http://localhost:8787/mcp/call
```

3) 启动开发服务器：

```bash
npm run dev
```

打开 `http://localhost:3000`。

### 常用脚本

```bash
# 开发
npm run dev

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
- `src/lib/mcp.ts`：MCP Server 管理、工具执行、日志
- `src/lib/rag.ts`：RAG 入库/检索与 prompt 构建

### 说明与约束

- **数据库**：默认使用本地 SQLite 文件（仓库中可见 `database.db`）。生产部署建议使用持久化存储，并按需迁移到独立 DB 服务。
- **鉴权**：API 主要通过 `auth-token` cookie 识别用户，会话在请求中会自动续期。
- **消息角色**：LLM 输入目前只接收 `user/assistant` 角色（会过滤掉其它 role），如需 `system` 消息请同步扩展 `src/lib/llm.ts` 的消息类型与 prompt 组装逻辑。
- **System Prompt 规则**：`defaultSystemPrompt` 始终在前，API 传入的 `systemPrompt` 会拼接在后。
- **MCP 调用优先级**：
  1) 本地 Node runtime（`config.runtime=node` + `config.tools`）  
  2) `MCP_DIRECT_BRIDGE_URL` 直连  
  3) Server `endpoint` fallback
- **本地 Node 工具安全性**：`config.tools` 中的 JS 代码会在服务端执行（`vm` 沙箱 + 超时），生产环境建议增加白名单、隔离与审计。

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
