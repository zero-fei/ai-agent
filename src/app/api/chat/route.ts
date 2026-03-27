import { NextRequest, NextResponse } from 'next/server';
import { getChatStream } from '@/lib/llm';
import db from '@/lib/db';
import { randomUUID } from 'crypto';
import { getSession } from '@/lib/auth';
import { buildRagSystemPrompt, isEmbeddingsConfigured, kbSearch } from '@/lib/rag';
import { callServerTool, listEnabledServers, listEnabledToolDefinitions, resolveDefaultToolName } from '@/lib/mcp';
import { buildMemorySystemPrompt, extractMemoriesFromTurn, searchMemories, upsertMemories } from '@/lib/memory';
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createSkillDoc, getSkillByName, listSkills, SkillDoc } from '@/lib/skills';

export const dynamic = 'force-dynamic';

/**
 * Chat API（流式输出）。
 *
 * 职责：
 * - Cookie Session 鉴权
 * - 对话/消息落库（SQLite）
 * - 向客户端流式返回 LLM 输出
 * - RAG：从知识库检索上下文并注入到 system prompt
 */
type IncomingMessage = {
  role: string;
  content: string;
};

type ChatRequestBody = {
  messages: IncomingMessage[];
  conversationId?: string | null;
  collectionId?: string | null;
  skillName?: string | null;
  skillArgs?: Record<string, unknown> | null;
};

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

type LlmMessage = {
  role: 'user' | 'assistant';
  content: string;
};

const isLlmRole = (role: string): role is LlmMessage['role'] => role === 'user' || role === 'assistant';

const MCP_CALL_WITH_TOOL_PATTERN = /@mcp\(\s*([^)]+?)\s*,\s*([^)]+?)\s*\)\s*(\{[\s\S]*\})?/i;
const MCP_CALL_SERVER_ONLY_PATTERN = /@mcp\(\s*([^)]+?)\s*\)\s*(\{[\s\S]*\})?/i;
const MCP_CALL_NL_PATTERN = /调用\s*([A-Za-z0-9_-]+)\s*(\{[\s\S]*\})?/i;

const parseMcpArgs = (argsRaw?: string) => {
  let args: Record<string, unknown> = {};
  if (argsRaw?.trim()) {
    const parsed = JSON.parse(argsRaw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('MCP arguments must be a JSON object.');
    }
    args = parsed as Record<string, unknown>;
  }
  return args;
};

const parseMcpToolCall = (content: string) => {
  const text = content.trim().replace(/[，。；]/g, ' ');

  const fullMatch = text.match(MCP_CALL_WITH_TOOL_PATTERN);
  if (fullMatch) {
    const [, serverKeyRaw, toolNameRaw, argsRaw] = fullMatch;
    const serverKey = (serverKeyRaw || '').trim();
    const toolName = (toolNameRaw || '').trim();
    if (!serverKey || !toolName) return null;
    return { serverKey, toolName, args: parseMcpArgs(argsRaw) };
  }

  const serverOnlyMatch = text.match(MCP_CALL_SERVER_ONLY_PATTERN);
  if (serverOnlyMatch) {
    const [, serverKeyRaw, argsRaw] = serverOnlyMatch;
    const serverKey = (serverKeyRaw || '').trim();
    if (!serverKey) return null;
    return { serverKey, toolName: null as string | null, args: parseMcpArgs(argsRaw) };
  }

  const nlMatch = text.match(MCP_CALL_NL_PATTERN);
  if (nlMatch) {
    const [, serverKeyRaw, argsRaw] = nlMatch;
    const serverKey = (serverKeyRaw || '').trim();
    if (!serverKey) return null;
    return { serverKey, toolName: null as string | null, args: parseMcpArgs(argsRaw) };
  }

  return null;
};

const containsToolTriggerWord = (text: string) => {
  const triggers = ['调用', '执行', '使用工具', '@mcp', 'tool', 'invoke', 'call'];
  const lower = text.toLowerCase();
  return triggers.some((t) => lower.includes(t.toLowerCase()));
};

const shouldAllowAutoToolCall = (userText: string, tools: Array<{ serverKey: string; toolName: string }>) => {
  const lower = userText.toLowerCase();
  const hasToolNameMatch = tools.some(
    (t) => lower.includes(t.serverKey.toLowerCase()) || lower.includes(t.toolName.toLowerCase())
  );
  if (!hasToolNameMatch) return false;

  // Fast path: user sends only serverKey/toolName-like short text, allow direct call.
  const compact = lower.replace(/\s+/g, '');
  const isDirectNameOnly = tools.some(
    (t) => compact === t.serverKey.toLowerCase() || compact === t.toolName.toLowerCase()
  );
  if (isDirectNameOnly) return true;

  // General path: still require explicit trigger words.
  return containsToolTriggerWord(userText);
};

const resolveDirectNameTrigger = (
  userText: string,
  tools: Array<{ serverKey: string; toolName: string }>
) => {
  const compact = userText.toLowerCase().replace(/\s+/g, '');
  const byServer = tools.find((t) => compact === t.serverKey.toLowerCase());
  if (byServer) return { serverKey: byServer.serverKey, toolName: byServer.toolName };
  const byTool = tools.find((t) => compact === t.toolName.toLowerCase());
  if (byTool) return { serverKey: byTool.serverKey, toolName: byTool.toolName };
  return null;
};

type FunctionToolBinding = {
  functionName: string;
  serverKey: string;
  toolName: string;
  description: string;
};

const toFunctionSafeName = (serverKey: string, toolName: string) => {
  const safeServer = serverKey.replace(/[^a-zA-Z0-9_]/g, '_');
  const safeTool = toolName.replace(/[^a-zA-Z0-9_]/g, '_');
  return `mcp_${safeServer}__${safeTool}`.slice(0, 64);
};

const buildFunctionToolBindings = (tools: Array<{ serverKey: string; toolName: string; description: string }>) => {
  const usedNames = new Set<string>();
  const bindings: FunctionToolBinding[] = [];
  for (const t of tools) {
    const baseName = toFunctionSafeName(t.serverKey, t.toolName);
    let fnName = baseName;
    let i = 1;
    while (usedNames.has(fnName)) {
      fnName = `${baseName}_${i++}`.slice(0, 64);
    }
    usedNames.add(fnName);
    bindings.push({
      functionName: fnName,
      serverKey: t.serverKey,
      toolName: t.toolName,
      description: t.description,
    });
  }
  return bindings;
};

const getFunctionCallingDecision = async (params: {
  latestUserText: string;
  toolDefs: Array<{ serverKey: string; toolName: string; description: string }>;
}) => {
  const { latestUserText, toolDefs } = params;
  if (!toolDefs.length) return null;

  const bindings = buildFunctionToolBindings(toolDefs);
  const tools = bindings.map((b) => ({
    type: 'function' as const,
    function: {
      name: b.functionName,
      description: b.description,
      parameters: {
        type: 'object',
        additionalProperties: true,
      },
    },
  }));

  const plannerModel = new ChatOpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    modelName: 'qwen3.5-plus',
    configuration: {
      baseURL: process.env.DASHSCOPE_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1',
    },
    modelKwargs: {
      enable_thinking: false,
    },
    temperature: 0,
  }).bindTools(tools);

  const plannerResponse = await plannerModel.invoke([
    new SystemMessage(
      [
        '你是工具选择器。',
        '当且仅当用户明确要求调用/执行工具，或明确给出了工具相关指令时，才调用 function。',
        '如果是普通问答、闲聊、润色、夸赞，不要调用任何 function。',
        '如果要调用，arguments 必须是 JSON object。',
      ].join('\n')
    ),
    new HumanMessage(latestUserText),
  ]);

  const toolCalls = plannerResponse instanceof AIMessage ? plannerResponse.tool_calls ?? [] : [];
  if (!toolCalls.length) return null;

  const first = toolCalls[0];
  const binding = bindings.find((b) => b.functionName === first.name);
  if (!binding) return null;

  const args =
    first.args && typeof first.args === 'object' && !Array.isArray(first.args)
      ? (first.args as Record<string, unknown>)
      : {};

  return { binding, args };
};

const parseSkillArgs = (raw: unknown) => {
  if (!raw) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('skillArgs must be a JSON object.');
  }
  return raw as Record<string, unknown>;
};

const buildSkillSystemPrompt = (skill: SkillDoc, args: Record<string, unknown>) =>
  [
    `当前启用 Skill: ${skill.name}`,
    `Skill 描述: ${skill.description}`,
    '必须严格遵循以下 Skill 文档约束执行：',
    skill.content,
    `Skill 参数(JSON): ${JSON.stringify(args)}`,
  ].join('\n\n');

const mergeSystemPrompts = (...prompts: Array<string | null | undefined>) =>
  prompts.filter(Boolean).join('\n\n') || undefined;

const toSafeHeaderValue = (value: string) => {
  if (!value) return '';
  // Response headers must be ByteString (latin1). Encode non-ASCII safely.
  return encodeURIComponent(value);
};

const filterToolDefsByAllowedTools = (
  toolDefs: Array<{ serverKey: string; toolName: string; description: string }>,
  allowedTools: string[]
) => {
  if (!allowedTools.length) return toolDefs;
  const allowSet = new Set(allowedTools.map((s) => s.toLowerCase().trim()));
  return toolDefs.filter((t) => allowSet.has(`${t.serverKey}/${t.toolName}`.toLowerCase()));
};

const filterServersByAllowedTools = (
  servers: Array<{ serverKey: string; endpoint: string | null }>,
  allowedTools: string[]
) => {
  if (!allowedTools.length) return servers;
  const allowServerSet = new Set(
    allowedTools
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => s.split('/')[0]!.toLowerCase())
  );
  return servers.filter((s) => allowServerSet.has(s.serverKey.toLowerCase()));
};

const selectSkillByFunctionCalling = async (params: { latestUserText: string; skills: SkillDoc[] }) => {
  const { latestUserText, skills } = params;
  if (!skills.length) return null;

  const options = skills.map((s) => ({ name: s.name, description: s.description }));
  const model = new ChatOpenAI({
    apiKey: process.env.DASHSCOPE_API_KEY,
    modelName: 'qwen3.5-plus',
    configuration: {
      baseURL: process.env.DASHSCOPE_BASE_URL || 'https://coding.dashscope.aliyuncs.com/v1',
    },
    modelKwargs: {
      enable_thinking: false,
    },
    temperature: 0,
  }).bindTools([
    {
      type: 'function' as const,
      function: {
        name: 'select_skill',
        description: 'Select a skill only when user request clearly matches that skill.',
        parameters: {
          type: 'object',
          properties: {
            skillName: { type: 'string' },
            arguments: {
              type: 'object',
              additionalProperties: true,
            },
          },
          required: ['skillName'],
          additionalProperties: false,
        },
      },
    },
  ]);

  const response = await model.invoke([
    new SystemMessage(
      [
        '你是技能选择器。',
        `可用技能: ${JSON.stringify(options)}`,
        '只有在用户意图与某个技能高度匹配时才调用 select_skill。',
        '普通问答、闲聊、夸赞、润色时不要调用任何 function。',
      ].join('\n')
    ),
    new HumanMessage(latestUserText),
  ]);
  const toolCalls = response instanceof AIMessage ? response.tool_calls ?? [] : [];
  if (!toolCalls.length) return null;
  const first = toolCalls[0];
  if (first.name !== 'select_skill') return null;
  const args =
    first.args && typeof first.args === 'object' && !Array.isArray(first.args)
      ? (first.args as Record<string, unknown>)
      : {};
  const skillName = typeof args.skillName === 'string' ? args.skillName.trim() : '';
  if (!skillName) return null;
  const skillArgs = parseSkillArgs(args.arguments);
  return { skillName, skillArgs };
};

const parseCreateSkillIntent = (text: string): { name: string; description?: string; intentSeed?: string } | null => {
  const normalized = text.trim();

  // CN quick command: 帮我写个 user.md，主要是...
  const mdQuickMatch = normalized.match(
    /(?:帮我)?(?:写|生成|创建)(?:一个|个)?\s*([A-Za-z0-9_\-\u4e00-\u9fa5]+)\.md(?:\s*[，,。:：]\s*([\s\S]+))?/i
  );
  if (mdQuickMatch?.[1]) {
    const nameFromFile = mdQuickMatch[1].trim();
    const requirement = (mdQuickMatch[2] || '').trim();
    return {
      name: nameFromFile,
      description: requirement ? requirement.slice(0, 180) : undefined,
      intentSeed: requirement || undefined,
    };
  }

  // CN: 基于这个需求创建 skill 文档：xxx；名称尽量从“创建xxx技能”里提取，否则用首段文本生成。
  const withRequirementMatch = normalized.match(
    /基于(?:这个|以下)?需求创建(?:一个)?\s*(?:(.+?)\s*(?:技能)?(?:的)?\s*)?skill\s*文档[：:]\s*([\s\S]+)/i
  );
  if (withRequirementMatch) {
    const maybeName = (withRequirementMatch[1] || '').trim();
    const requirement = (withRequirementMatch[2] || '').trim();
    if (requirement) {
      const fallbackName = requirement.split(/[\n。.!?；;，,]/)[0]?.slice(0, 32).trim() || 'new-skill';
      const finalName = maybeName || fallbackName;
      return {
        name: finalName,
        description: requirement.slice(0, 180),
        intentSeed: requirement,
      };
    }
  }

  // Chinese: 创建一个xxx技能的skill文档
  const zhMatch =
    normalized.match(/创建(?:一个)?\s*["“]?([^"”\n]+?)["”]?\s*(?:技能)?(?:的)?\s*skill\s*文档/i) ||
    normalized.match(/创建(?:一个)?\s*["“]?([^"”\n]+?)["”]?\s*(?:技能)?(?:文档|skill文档)/i);
  if (zhMatch?.[1]) {
    return { name: zhMatch[1].trim() };
  }

  // English: create a skill document for xxx
  const enMatch =
    normalized.match(/create\s+(?:a\s+)?skill\s+(?:document|doc)\s+(?:for\s+)?["']?([A-Za-z0-9_\-\s]+?)["']?$/i) ||
    normalized.match(/create\s+["']?([A-Za-z0-9_\-\s]+?)["']?\s+skill\s+(?:document|doc)$/i);
  if (enMatch?.[1]) {
    return { name: enMatch[1].trim() };
  }

  return null;
};

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  try {
    let tAfterAuth = 0;
    let tAfterSaveUserMsg = 0;
    let tAfterKbSearch = 0;
    let tAfterLlmStart = 0;
    let firstTokenAt = 0;
    let mcpPlanAction = 'none';
    let mcpPlanTool = '';
    let mcpPlanMode = 'none';
    let mcpFunctionName = '';
    let skillMode = 'none';
    let selectedSkillName = '';
    let selectedSkillPrompt: string | undefined;
    let selectedSkillAllowedTools: string[] = [];

    const token = req.cookies.get('auth-token')?.value;
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = getSession(token);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    tAfterAuth = Date.now();

    if (!process.env.DASHSCOPE_API_KEY || process.env.DASHSCOPE_API_KEY === "your-api-key") {
      throw new Error("DashScope API key is not configured.");
    }

    const body = (await req.json()) as ChatRequestBody;
    const { messages, collectionId = null } = body;
    let conversationId = body.conversationId ?? undefined;
    if (!messages) {
      throw new Error("Messages are required");
    }

    // 若没有 conversationId，则创建新会话（title 取第一条用户消息的前 50 字）。
    if (!conversationId) {
      conversationId = randomUUID();
      const firstUserMessage = messages.find((m) => m.role === 'user');
      const title = firstUserMessage ? firstUserMessage.content.substring(0, 50) : 'New Conversation';
      const stmt = db.prepare('INSERT INTO conversations (id, userId, title) VALUES (?, ?, ?)');
      stmt.run(conversationId, user.id, title);
    }

    // 先保存用户消息，保证即使后续流式输出失败也有可追溯记录。
    const lastUserMessage = messages[messages.length - 1];
    const saveUserMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
    saveUserMsgStmt.run(randomUUID(), conversationId, lastUserMessage.role, lastUserMessage.content);
    tAfterSaveUserMsg = Date.now();

    const llmMessages: LlmMessage[] = messages
      .filter((m): m is IncomingMessage => typeof m?.role === 'string' && typeof m?.content === 'string')
      .filter((m): m is LlmMessage => isLlmRole(m.role))
      .map((m) => ({ role: m.role, content: m.content }));

    if (llmMessages.length === 0) {
      throw new Error('No valid messages for LLM.');
    }

    const latestUser = llmMessages[llmMessages.length - 1]!;

    // Memory recall: retrieve memories for current query and inject into system prompt.
    let memorySystemPrompt: string | null = null;
    try {
      const memories = await searchMemories({ userId: user.id, query: latestUser.content });
      memorySystemPrompt = buildMemorySystemPrompt({ query: latestUser.content, memories });
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.log('[memory-recall]', err);
      }
    }

    // Memory update: extract and persist after assistant finishes generating.
    const updateMemoriesForTurn = async (assistantText: string) => {
      try {
        if (!assistantText?.trim()) return;
        const items = await extractMemoriesFromTurn({ userText: latestUser.content, assistantText });
        if (!items.length) return;
        await upsertMemories({ userId: user.id, items });
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[memory-update]', err);
        }
      }
    };

    // Skill resolution: manual skill first, then optional auto skill via function calling.
    const manualSkillName = typeof body.skillName === 'string' ? body.skillName.trim() : '';
    const manualSkillArgs = parseSkillArgs(body.skillArgs);

    // Direct creation intent: create skill markdown in /skills and return confirmation.
    const createSkillIntent = parseCreateSkillIntent(latestUser.content);
    if (createSkillIntent) {
      const created = createSkillDoc({
        name: createSkillIntent.name,
        description: createSkillIntent.description,
        intentSeed: createSkillIntent.intentSeed,
      });
      const responseText = created.created
        ? `已创建 Skill 文档：skills/${created.skill.fileName}\n\n你可以在 Skill 管理页面查看它。`
        : `Skill 已存在：skills/${created.skill.fileName}\n\n如需修改，请让我继续更新该文档。`;

      const saveAiMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
      saveAiMsgStmt.run(randomUUID(), conversationId, 'assistant', responseText);

      const encoder = new TextEncoder();
      const readableStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(responseText));
          controller.close();
        },
      });

      return new Response(readableStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Conversation-Id': conversationId,
          'X-MCP-Plan-Action': toSafeHeaderValue(mcpPlanAction),
          'X-MCP-Plan-Tool': toSafeHeaderValue(mcpPlanTool),
          'X-MCP-Plan-Mode': toSafeHeaderValue(mcpPlanMode),
          'X-MCP-Function-Name': toSafeHeaderValue(mcpFunctionName),
          'X-Skill-Mode': toSafeHeaderValue(skillMode),
          'X-Skill-Name': toSafeHeaderValue(selectedSkillName),
        },
      });
    }

    if (manualSkillName) {
      const skill = getSkillByName(manualSkillName);
      if (!skill) {
        return NextResponse.json({ error: `Skill not found: ${manualSkillName}` }, { status: 400 });
      }
      if (!skill.valid) {
        return NextResponse.json(
          { error: `Skill is invalid: ${skill.name}`, details: skill.errors },
          { status: 400 }
        );
      }
      skillMode = 'manual';
      selectedSkillName = skill.name;
      selectedSkillPrompt = buildSkillSystemPrompt(skill, manualSkillArgs);
      selectedSkillAllowedTools = skill.allowedTools;
    } else {
      const availableSkills = listSkills().filter((s) => s.valid);
      const autoSkill = await selectSkillByFunctionCalling({
        latestUserText: latestUser.content,
        skills: availableSkills,
      });
      if (autoSkill) {
        const skill = getSkillByName(autoSkill.skillName);
        if (skill && skill.valid) {
          skillMode = 'auto';
          selectedSkillName = skill.name;
          selectedSkillPrompt = buildSkillSystemPrompt(skill, autoSkill.skillArgs);
          selectedSkillAllowedTools = skill.allowedTools;
        }
      }
    }
    const mcpCall = parseMcpToolCall(latestUser.content);

    if (mcpCall) {
      mcpPlanAction = 'manual_call';
      mcpPlanMode = 'manual';
      const toolName = mcpCall.toolName || resolveDefaultToolName({ userId: user.id, serverKey: mcpCall.serverKey });
      mcpPlanTool = `${mcpCall.serverKey}/${toolName}`;
      const called = await callServerTool({
        userId: user.id,
        serverKey: mcpCall.serverKey,
        toolName,
        arguments: mcpCall.args,
      });

      const resultText = JSON.stringify(called.result, null, 2);
      const toolAwareMessages: LlmMessage[] = [
        ...llmMessages,
        { role: 'assistant', content: `[MCP工具 ${mcpCall.serverKey}/${toolName} 原始结果]\n${resultText}` },
        {
          role: 'user',
          content:
            '请基于上面的 MCP 工具结果给出最终回答。要求：1) 先给结论；2) 关键字段用简洁列表；3) 如果结果为空或异常，明确说明。',
        },
      ];
      const toolAwareSystemPrompt = [
        '你是一个严谨助手。',
        '你会先调用 MCP 工具，再基于工具结果回答用户。',
        '当前工具结果由系统注入，请优先依据该结果，不要编造。',
        memorySystemPrompt,
        selectedSkillPrompt,
      ].filter(Boolean).join('\n');

      const stream = await getChatStream(toolAwareMessages, { systemPrompt: toolAwareSystemPrompt });
      tAfterLlmStart = Date.now();

      let aiResponseContent = '';
      const encoder = new TextEncoder();
      const readableStream = new ReadableStream({
        async start(controller) {
          for await (const chunk of stream) {
            if (!firstTokenAt) firstTokenAt = Date.now();
            aiResponseContent += chunk;
            controller.enqueue(encoder.encode(chunk));
          }

          const saveAiMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
          saveAiMsgStmt.run(randomUUID(), conversationId, 'assistant', aiResponseContent);
          void updateMemoriesForTurn(aiResponseContent);
          controller.close();
        },
      });

      return new Response(readableStream, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'X-Conversation-Id': conversationId,
          'X-MCP-Plan-Action': toSafeHeaderValue(mcpPlanAction),
          'X-MCP-Plan-Tool': toSafeHeaderValue(mcpPlanTool),
          'X-MCP-Plan-Mode': toSafeHeaderValue(mcpPlanMode),
          'X-MCP-Function-Name': toSafeHeaderValue(mcpFunctionName),
          'X-Skill-Mode': toSafeHeaderValue(skillMode),
          'X-Skill-Name': toSafeHeaderValue(selectedSkillName),
        },
      });
    }

    // Agent tool-selection phase: model decides whether to call MCP tool.
    const toolDefs = filterToolDefsByAllowedTools(listEnabledToolDefinitions(user.id), selectedSkillAllowedTools);
    if (toolDefs.length > 0) {
      const directTrigger = resolveDirectNameTrigger(latestUser.content, toolDefs);
      if (directTrigger) {
        mcpPlanAction = 'direct_name_call';
        mcpPlanMode = 'direct_name';
        mcpPlanTool = `${directTrigger.serverKey}/${directTrigger.toolName}`;
        const called = await callServerTool({
          userId: user.id,
          serverKey: directTrigger.serverKey,
          toolName: directTrigger.toolName,
          arguments: {},
        });
        const resultText = JSON.stringify(called.result, null, 2);
        const toolAwareMessages: LlmMessage[] = [
          ...llmMessages,
          { role: 'assistant', content: `[MCP工具 ${directTrigger.serverKey}/${directTrigger.toolName} 原始结果]\n${resultText}` },
          {
            role: 'user',
            content:
              '请基于上面的 MCP 工具结果给出最终回答。要求：1) 先给结论；2) 关键字段用简洁列表；3) 如果结果为空或异常，明确说明。',
          },
        ];
        const baseSystemPrompt = '你是一个严谨助手。你会先调用工具，再基于工具结果回答；不要编造。';
        const stream = await getChatStream(toolAwareMessages, {
          systemPrompt: mergeSystemPrompts(baseSystemPrompt, memorySystemPrompt, selectedSkillPrompt),
        });
        tAfterLlmStart = Date.now();

        let aiResponseContent = '';
        const encoder = new TextEncoder();
        const readableStream = new ReadableStream({
          async start(controller) {
            for await (const chunk of stream) {
              if (!firstTokenAt) firstTokenAt = Date.now();
              aiResponseContent += chunk;
              controller.enqueue(encoder.encode(chunk));
            }

            const saveAiMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
            saveAiMsgStmt.run(randomUUID(), conversationId, 'assistant', aiResponseContent);
            void updateMemoriesForTurn(aiResponseContent);
            controller.close();
          },
        });

        return new Response(readableStream, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Conversation-Id': conversationId,
            'X-MCP-Plan-Action': toSafeHeaderValue(mcpPlanAction),
            'X-MCP-Plan-Tool': toSafeHeaderValue(mcpPlanTool),
            'X-MCP-Plan-Mode': toSafeHeaderValue(mcpPlanMode),
            'X-MCP-Function-Name': toSafeHeaderValue(mcpFunctionName),
            'X-Skill-Mode': toSafeHeaderValue(skillMode),
            'X-Skill-Name': toSafeHeaderValue(selectedSkillName),
          },
        });
      }

      const autoToolAllowed = shouldAllowAutoToolCall(latestUser.content, toolDefs);
      const decision = await getFunctionCallingDecision({
        latestUserText: latestUser.content,
        toolDefs,
      });
      if (process.env.NODE_ENV !== 'production') {
        console.log('[mcp-fc-planner]', {
          userId: user.id,
          autoToolAllowed,
          decision: decision
            ? {
                serverKey: decision.binding.serverKey,
                toolName: decision.binding.toolName,
                args: decision.args,
              }
            : null,
        });
      }
      if (decision && autoToolAllowed) {
        mcpPlanAction = 'call_tool';
        mcpPlanMode = 'function_calling';
        const serverKey = decision.binding.serverKey;
        const toolName = decision.binding.toolName;
        const args = decision.args;
        mcpFunctionName = decision.binding.functionName;

        mcpPlanTool = `${serverKey}/${toolName}`;
        const called = await callServerTool({
          userId: user.id,
          serverKey,
          toolName,
          arguments: args,
        });
        const resultText = JSON.stringify(called.result, null, 2);
        const toolAwareMessages: LlmMessage[] = [
          ...llmMessages,
          { role: 'assistant', content: `[MCP工具 ${serverKey}/${toolName} 原始结果]\n${resultText}` },
          {
            role: 'user',
            content:
              '请基于上面的 MCP 工具结果给出最终回答。要求：1) 先给结论；2) 关键字段用简洁列表；3) 如果结果为空或异常，明确说明。',
          },
        ];
        const baseSystemPrompt = '你是一个严谨助手。你会先调用工具，再基于工具结果回答；不要编造。';
        const stream = await getChatStream(toolAwareMessages, {
          systemPrompt: mergeSystemPrompts(baseSystemPrompt, memorySystemPrompt, selectedSkillPrompt),
        });
        tAfterLlmStart = Date.now();

        let aiResponseContent = '';
        const encoder = new TextEncoder();
        const readableStream = new ReadableStream({
          async start(controller) {
            for await (const chunk of stream) {
              if (!firstTokenAt) firstTokenAt = Date.now();
              aiResponseContent += chunk;
              controller.enqueue(encoder.encode(chunk));
            }

            const saveAiMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
            saveAiMsgStmt.run(randomUUID(), conversationId, 'assistant', aiResponseContent);
            void updateMemoriesForTurn(aiResponseContent);
            controller.close();
          },
        });

        return new Response(readableStream, {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'X-Conversation-Id': conversationId,
            'X-MCP-Plan-Action': toSafeHeaderValue(mcpPlanAction),
            'X-MCP-Plan-Tool': toSafeHeaderValue(mcpPlanTool),
            'X-MCP-Plan-Mode': toSafeHeaderValue(mcpPlanMode),
            'X-MCP-Function-Name': toSafeHeaderValue(mcpFunctionName),
            'X-Skill-Mode': toSafeHeaderValue(skillMode),
            'X-Skill-Name': toSafeHeaderValue(selectedSkillName),
          },
        });
      }
      if (decision && !autoToolAllowed) {
        if (process.env.NODE_ENV !== 'production') {
          console.log('[mcp-fc-planner] blocked by guardrail', {
            userId: user.id,
            latestUser: latestUser.content,
          });
        }
      }
      if (!mcpPlanAction || mcpPlanAction === 'none') {
        mcpPlanAction = 'no_tool';
      }
    }

    // RAG 检索：
    // - 支持客户端透传 collectionId，用于“每个会话选择知识库/集合”
    // - 未配置 Embeddings key 时直接跳过检索，避免影响主对话链路
    const hits = isEmbeddingsConfigured()
      ? await kbSearch({ userId: user.id, collectionId, query: latestUser.content, topK: 5 })
      : [];
    tAfterKbSearch = Date.now();
    const ragSystemPrompt = buildRagSystemPrompt({
      query: latestUser.content,
      hits: hits.map((h) => ({ content: h.content, score: h.score })),
    });
    const enabledMcpServers = filterServersByAllowedTools(
      listEnabledServers(user.id).map((s) => ({ serverKey: s.serverKey, endpoint: s.endpoint })),
      selectedSkillAllowedTools
    );
    const mcpInstruction = enabledMcpServers.length
      ? [
          '可用 MCP Servers（已启用）：',
          ...enabledMcpServers.map((s) => `- ${s.serverKey}${s.endpoint ? ` (${s.endpoint})` : ''}`),
          '如果需要调用 MCP 工具，请使用严格格式：@mcp(serverKey,toolName) {"arg":"value"}',
          '简化调用也支持：@mcp(serverKey) {} 或 调用serverKey {}（仅当该 server 只有一个工具时）',
          '如果不是显式 MCP 调用，就按正常对话回答。',
        ].join('\n')
      : null;
    const mergedSystemPrompt = mergeSystemPrompts(ragSystemPrompt, mcpInstruction, memorySystemPrompt, selectedSkillPrompt);

    // 通过覆盖 system prompt 注入检索上下文（不改变前端消息结构）。
    const stream = await getChatStream(llmMessages, { systemPrompt: mergedSystemPrompt });
    tAfterLlmStart = Date.now();

    let aiResponseContent = '';
    const encoder = new TextEncoder();
    const readableStream = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          if (!firstTokenAt) firstTokenAt = Date.now();
          aiResponseContent += chunk;
          controller.enqueue(encoder.encode(chunk));
        }
        
        // 流式输出完成后再保存 AI 回复（单条记录保存完整内容）。
        const saveAiMsgStmt = db.prepare('INSERT INTO messages (id, conversationId, role, content) VALUES (?, ?, ?, ?)');
        saveAiMsgStmt.run(randomUUID(), conversationId, 'assistant', aiResponseContent);

        void updateMemoriesForTurn(aiResponseContent);

        const tDone = Date.now();
        console.log(
          `[chat-timing] total=${tDone - t0}ms auth=${tAfterAuth - t0}ms saveUser=${tAfterSaveUserMsg - tAfterAuth}ms kb=${tAfterKbSearch - tAfterSaveUserMsg}ms llmStart=${tAfterLlmStart - tAfterKbSearch}ms firstToken=${firstTokenAt ? firstTokenAt - t0 : -1}ms streamAndSave=${tDone - (firstTokenAt || tAfterLlmStart)}ms hits=${hits.length} skillMode=${skillMode} skill=${selectedSkillName || 'none'}`
        );

        controller.close();
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Conversation-Id': conversationId,
        'X-MCP-Plan-Action': toSafeHeaderValue(mcpPlanAction),
        'X-MCP-Plan-Tool': toSafeHeaderValue(mcpPlanTool),
        'X-MCP-Plan-Mode': toSafeHeaderValue(mcpPlanMode),
        'X-MCP-Function-Name': toSafeHeaderValue(mcpFunctionName),
        'X-Skill-Mode': toSafeHeaderValue(skillMode),
        'X-Skill-Name': toSafeHeaderValue(selectedSkillName),
      },
    });

  } catch (error: unknown) {
    console.error("[API] Chat route error:", error);
    return new NextResponse(JSON.stringify({ error: getErrorMessage(error) || 'An unknown error occurred.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}