## ai-agent-app

一个基于 **Next.js App Router** 的「对话式 AI Agent」Web 应用，内置登录/注册、会话管理、对话历史、流式输出等能力，后续可扩展 MCP 管理与知识库能力。

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
  - MCP 管理入口（页面占位，待实现）
  - 知识库入口（页面占位，待实现）

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
- `src/app/api/*`：后端 API（认证、聊天、会话列表/详情）
- `src/lib/auth.ts`：用户/会话（SQLite）逻辑
- `src/lib/db.ts`：SQLite 连接
- `src/lib/llm.ts`：LangChain 调用与流式输出封装

### 说明与约束

- **数据库**：默认使用本地 SQLite 文件（仓库中可见 `database.db`）。生产部署建议使用持久化存储，并按需迁移到独立 DB 服务。
- **鉴权**：API 主要通过 `auth-token` cookie 识别用户，会话在请求中会自动续期。
- **消息角色**：LLM 输入目前只接收 `user/assistant` 角色（会过滤掉其它 role），如需 `system` 消息请同步扩展 `src/lib/llm.ts` 的消息类型与 prompt 组装逻辑。
