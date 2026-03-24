import { randomUUID } from 'crypto';
import vm from 'node:vm';
import db from '@/lib/db';

type JsonRecord = Record<string, unknown>;

type McpServerRow = {
  id: string;
  userId: string;
  name: string;
  serverKey: string;
  endpoint: string | null;
  config: string | null;
  enabled: number;
  authStatus: string;
  lastHealthStatus: string | null;
  lastHealthMessage: string | null;
  lastHealthAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type McpLogRow = {
  id: string;
  userId: string;
  serverId: string;
  action: string;
  status: string;
  message: string | null;
  meta: string | null;
  createdAt: string;
};

export type McpServer = {
  id: string;
  userId: string;
  name: string;
  serverKey: string;
  endpoint: string | null;
  config: JsonRecord | null;
  enabled: boolean;
  authStatus: 'unknown' | 'pending' | 'ok' | 'failed' | string;
  lastHealthStatus: 'healthy' | 'unhealthy' | 'unknown' | null | string;
  lastHealthMessage: string | null;
  lastHealthAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type McpLog = {
  id: string;
  userId: string;
  serverId: string;
  action: string;
  status: 'ok' | 'error' | 'running' | string;
  message: string | null;
  meta: JsonRecord | null;
  createdAt: string;
};

export type McpToolDefinition = {
  serverKey: string;
  toolName: string;
  description: string;
};

const activeOps = new Set<string>();

type LocalNodeRuntimeConfig = {
  runtime?: string;
  tools?: Record<string, string>;
};

const parseJsonObject = (raw: string | null): JsonRecord | null => {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonRecord)
      : null;
  } catch {
    return null;
  }
};

const mapServer = (r: McpServerRow): McpServer => ({
  id: r.id,
  userId: r.userId,
  name: r.name,
  serverKey: r.serverKey,
  endpoint: r.endpoint,
  config: parseJsonObject(r.config),
  enabled: r.enabled === 1,
  authStatus: r.authStatus,
  lastHealthStatus: r.lastHealthStatus,
  lastHealthMessage: r.lastHealthMessage,
  lastHealthAt: r.lastHealthAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

const mapLog = (r: McpLogRow): McpLog => ({
  id: r.id,
  userId: r.userId,
  serverId: r.serverId,
  action: r.action,
  status: r.status,
  message: r.message,
  meta: parseJsonObject(r.meta),
  createdAt: r.createdAt,
});

function getServerOwned(userId: string, serverId: string): McpServerRow {
  const row = db
    .prepare(
      `SELECT id, userId, name, serverKey, endpoint, config, enabled, authStatus, lastHealthStatus, lastHealthMessage, lastHealthAt, createdAt, updatedAt
       FROM mcp_servers
       WHERE id = ? AND userId = ?`
    )
    .get(serverId, userId) as McpServerRow | undefined;
  if (!row) throw new Error('MCP server not found');
  return row;
}

export function listServers(userId: string): McpServer[] {
  const rows = db
    .prepare(
      `SELECT id, userId, name, serverKey, endpoint, config, enabled, authStatus, lastHealthStatus, lastHealthMessage, lastHealthAt, createdAt, updatedAt
       FROM mcp_servers
       WHERE userId = ?
       ORDER BY createdAt DESC`
    )
    .all(userId) as McpServerRow[];
  return rows.map(mapServer);
}

export function listEnabledServers(userId: string): McpServer[] {
  const rows = db
    .prepare(
      `SELECT id, userId, name, serverKey, endpoint, config, enabled, authStatus, lastHealthStatus, lastHealthMessage, lastHealthAt, createdAt, updatedAt
       FROM mcp_servers
       WHERE userId = ? AND enabled = 1
       ORDER BY createdAt DESC`
    )
    .all(userId) as McpServerRow[];
  return rows.map(mapServer);
}

export function listEnabledToolDefinitions(userId: string): McpToolDefinition[] {
  const servers = listEnabledServers(userId);
  const defs: McpToolDefinition[] = [];
  for (const server of servers) {
    const cfg = (server.config || {}) as { tools?: Record<string, string> };
    const tools = cfg.tools || {};
    for (const [toolName, code] of Object.entries(tools)) {
      if (typeof code !== 'string' || !code.trim()) continue;
      defs.push({
        serverKey: server.serverKey,
        toolName,
        description: `Local MCP tool ${server.serverKey}/${toolName}`,
      });
    }
  }
  return defs;
}

export function getServerByKey(params: { userId: string; serverKey: string; enabledOnly?: boolean }) {
  const { userId, serverKey, enabledOnly = false } = params;
  const row = db
    .prepare(
      `SELECT id, userId, name, serverKey, endpoint, config, enabled, authStatus, lastHealthStatus, lastHealthMessage, lastHealthAt, createdAt, updatedAt
       FROM mcp_servers
       WHERE userId = ? AND serverKey = ?
         ${enabledOnly ? 'AND enabled = 1' : ''}
       ORDER BY createdAt DESC
       LIMIT 1`
    )
    .get(userId, serverKey) as McpServerRow | undefined;
  return row ? mapServer(row) : null;
}

export function resolveDefaultToolName(params: { userId: string; serverKey: string }) {
  const { userId, serverKey } = params;
  const server = getServerByKey({ userId, serverKey, enabledOnly: true });
  if (!server) {
    throw new Error(`Enabled MCP server not found: ${serverKey}`);
  }

  const cfg = (server.config || {}) as { tools?: Record<string, unknown> };
  const toolNames = Object.keys(cfg.tools || {}).filter((name) => typeof cfg.tools?.[name] === 'string');
  if (toolNames.length === 0) {
    throw new Error(`No tools configured on server: ${serverKey}`);
  }
  if (toolNames.length > 1) {
    throw new Error(`Multiple tools found on server ${serverKey}: ${toolNames.join(', ')}. Please specify toolName.`);
  }
  return toolNames[0]!;
}

export function createServer(params: {
  userId: string;
  name: string;
  serverKey: string;
  endpoint?: string | null;
  config?: JsonRecord | null;
}) {
  const { userId, name, serverKey, endpoint = null, config = null } = params;
  if (!name.trim()) throw new Error('name is required');
  if (!serverKey.trim()) throw new Error('serverKey is required');

  const id = randomUUID();
  db.prepare(
    `INSERT INTO mcp_servers
     (id, userId, name, serverKey, endpoint, config, enabled, authStatus, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 1, 'unknown', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(id, userId, name.trim(), serverKey.trim(), endpoint, config ? JSON.stringify(config) : null);

  writeLog({
    userId,
    serverId: id,
    action: 'create',
    status: 'ok',
    message: 'MCP server created',
    meta: { name: name.trim(), serverKey: serverKey.trim() },
  });

  return mapServer(getServerOwned(userId, id));
}

export function updateServer(params: {
  userId: string;
  serverId: string;
  name?: string;
  serverKey?: string;
  endpoint?: string | null;
  config?: JsonRecord | null;
}) {
  const { userId, serverId, name, serverKey, endpoint, config } = params;
  const current = getServerOwned(userId, serverId);

  const nextName = typeof name === 'string' ? name.trim() : current.name;
  const nextServerKey = typeof serverKey === 'string' ? serverKey.trim() : current.serverKey;
  if (!nextName) throw new Error('name is required');
  if (!nextServerKey) throw new Error('serverKey is required');

  const nextEndpoint = endpoint === undefined ? current.endpoint : endpoint;
  const nextConfig = config === undefined ? parseJsonObject(current.config) : config;

  db.prepare(
    `UPDATE mcp_servers
     SET name = ?, serverKey = ?, endpoint = ?, config = ?, updatedAt = CURRENT_TIMESTAMP
     WHERE id = ? AND userId = ?`
  ).run(
    nextName,
    nextServerKey,
    nextEndpoint,
    nextConfig ? JSON.stringify(nextConfig) : null,
    serverId,
    userId
  );

  writeLog({
    userId,
    serverId,
    action: 'update',
    status: 'ok',
    message: 'MCP server updated',
  });

  return mapServer(getServerOwned(userId, serverId));
}

export function deleteServer(params: { userId: string; serverId: string }) {
  const { userId, serverId } = params;
  getServerOwned(userId, serverId);
  db.prepare('DELETE FROM mcp_servers WHERE id = ? AND userId = ?').run(serverId, userId);
  return { deleted: true };
}

export function setServerEnabled(params: { userId: string; serverId: string; enabled: boolean }) {
  const { userId, serverId, enabled } = params;
  getServerOwned(userId, serverId);
  db.prepare('UPDATE mcp_servers SET enabled = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?').run(
    enabled ? 1 : 0,
    serverId,
    userId
  );

  writeLog({
    userId,
    serverId,
    action: enabled ? 'enable' : 'disable',
    status: 'ok',
    message: enabled ? 'Server enabled' : 'Server disabled',
  });

  return mapServer(getServerOwned(userId, serverId));
}

export function writeLog(params: {
  userId: string;
  serverId: string;
  action: string;
  status: string;
  message?: string | null;
  meta?: JsonRecord | null;
}) {
  const { userId, serverId, action, status, message = null, meta = null } = params;
  const id = randomUUID();
  db.prepare(
    `INSERT INTO mcp_logs (id, userId, serverId, action, status, message, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, userId, serverId, action, status, message, meta ? JSON.stringify(meta) : null);
  return id;
}

export function listLogs(params: { userId: string; serverId?: string; limit?: number }) {
  const { userId, serverId, limit = 100 } = params;
  const boundedLimit = Math.max(1, Math.min(500, limit));
  const rows = serverId
    ? (db
        .prepare(
          `SELECT id, userId, serverId, action, status, message, meta, createdAt
           FROM mcp_logs
           WHERE userId = ? AND serverId = ?
           ORDER BY createdAt DESC
           LIMIT ?`
        )
        .all(userId, serverId, boundedLimit) as McpLogRow[])
    : (db
        .prepare(
          `SELECT id, userId, serverId, action, status, message, meta, createdAt
           FROM mcp_logs
           WHERE userId = ?
           ORDER BY createdAt DESC
           LIMIT ?`
        )
        .all(userId, boundedLimit) as McpLogRow[]);
  return rows.map(mapLog);
}

export function runServerAuth(params: { userId: string; serverId: string }) {
  const { userId, serverId } = params;
  const lockKey = `${userId}:${serverId}:auth`;
  if (activeOps.has(lockKey)) {
    throw new Error('Authentication already in progress.');
  }

  activeOps.add(lockKey);
  try {
    const server = getServerOwned(userId, serverId);
    db.prepare('UPDATE mcp_servers SET authStatus = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?').run(
      'pending',
      serverId,
      userId
    );

    const hasServerKey = Boolean(server.serverKey?.trim());
    const hasEndpoint = Boolean(server.endpoint?.trim());
    const status = hasServerKey ? 'ok' : 'failed';
    const message = hasServerKey
      ? hasEndpoint
        ? 'Auth trigger accepted.'
        : 'Auth trigger accepted (no endpoint configured).'
      : 'Missing serverKey.';

    db.prepare('UPDATE mcp_servers SET authStatus = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND userId = ?').run(
      status,
      serverId,
      userId
    );
    writeLog({
      userId,
      serverId,
      action: 'auth',
      status,
      message,
      meta: { serverKey: server.serverKey, endpoint: server.endpoint },
    });

    return { status, message, server: mapServer(getServerOwned(userId, serverId)) };
  } finally {
    activeOps.delete(lockKey);
  }
}

export async function runHealthCheck(params: { userId: string; serverId: string }) {
  const { userId, serverId } = params;
  const lockKey = `${userId}:${serverId}:health`;
  if (activeOps.has(lockKey)) {
    throw new Error('Health check already in progress.');
  }

  activeOps.add(lockKey);
  try {
    const server = getServerOwned(userId, serverId);
    let status: 'healthy' | 'unhealthy' = 'healthy';
    let message = 'Health check passed.';
    let code: number | null = null;

    if (server.endpoint?.trim()) {
      try {
        const res = await fetch(server.endpoint, { method: 'GET' });
        code = res.status;
        if (!res.ok) {
          status = 'unhealthy';
          message = `Endpoint returned HTTP ${res.status}.`;
        }
      } catch (err) {
        status = 'unhealthy';
        message = err instanceof Error ? err.message : String(err);
      }
    } else {
      status = 'unhealthy';
      message = 'Endpoint is not configured.';
    }

    db.prepare(
      `UPDATE mcp_servers
       SET lastHealthStatus = ?, lastHealthMessage = ?, lastHealthAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
       WHERE id = ? AND userId = ?`
    ).run(status, message, serverId, userId);

    writeLog({
      userId,
      serverId,
      action: 'health_check',
      status: status === 'healthy' ? 'ok' : 'error',
      message,
      meta: { endpoint: server.endpoint, code },
    });

    return { status, message, server: mapServer(getServerOwned(userId, serverId)) };
  } finally {
    activeOps.delete(lockKey);
  }
}

export async function callServerTool(params: {
  userId: string;
  serverKey: string;
  toolName: string;
  arguments?: JsonRecord;
}) {
  const { userId, serverKey, toolName, arguments: args = {} } = params;
  const server = getServerByKey({ userId, serverKey, enabledOnly: true });
  if (!server) {
    throw new Error(`Enabled MCP server not found: ${serverKey}`);
  }

  const lockKey = `${userId}:${server.id}:tool:${toolName}`;
  if (activeOps.has(lockKey)) {
    throw new Error(`Tool call already in progress: ${toolName}`);
  }

  activeOps.add(lockKey);
  try {
    writeLog({
      userId,
      serverId: server.id,
      action: `tool_call:${toolName}`,
      status: 'running',
      message: 'Tool call started',
      meta: { arguments: args },
    });

    const parseResponse = async (response: Response) => {
      const text = await response.text();
      let parsed: unknown = text;
      try {
        parsed = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        parsed = text;
      }
      return parsed;
    };

    // 0) Local Node runtime first: allow user-defined tool code in MCP config JSON.
    // Config format:
    // {
    //   "runtime": "node",
    //   "tools": { "hello": "return 'hello world';" }
    // }
    const cfg = (server.config || {}) as LocalNodeRuntimeConfig;
    const localToolCode = cfg.runtime === 'node' && cfg.tools ? cfg.tools[toolName] : undefined;
    if (typeof localToolCode === 'string' && localToolCode.trim()) {
      const context = vm.createContext({
        args,
        serverKey,
        toolName,
        console,
        JSON,
      });
      const wrappedCode = `
        (async function() {
          const tool = async (args) => {
            ${localToolCode}
          };
          return await tool(args);
        })()
      `;
      try {
        const script = new vm.Script(wrappedCode);
        const result = await script.runInContext(context, { timeout: 2000 });
        writeLog({
          userId,
          serverId: server.id,
          action: `tool_call:${toolName}`,
          status: 'ok',
          message: 'Tool call succeeded (local node runtime)',
        });
        return { server, toolName, result };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        writeLog({
          userId,
          serverId: server.id,
          action: `tool_call:${toolName}`,
          status: 'error',
          message: `Local node runtime failed: ${message}`,
        });
        throw new Error(`Local node runtime failed: ${message}`);
      }
    }

    // Prefer direct MCP bridge first (acts like built-in call channel).
    // If unavailable or failed, fallback to configured endpoint.
    const bridgeUrl = process.env.MCP_DIRECT_BRIDGE_URL?.trim();
    let parsed: unknown = null;
    let success = false;
    let lastErrorMessage = '';

    if (bridgeUrl) {
      try {
        const bridgeRes = await fetch(bridgeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            serverKey,
            toolName,
            arguments: args,
          }),
        });
        parsed = await parseResponse(bridgeRes);
        if (bridgeRes.ok) {
          success = true;
        } else {
          lastErrorMessage = `Direct bridge failed with HTTP ${bridgeRes.status}`;
        }
      } catch (err) {
        lastErrorMessage = err instanceof Error ? err.message : String(err);
      }
    }

    if (!success) {
      if (!server.endpoint?.trim()) {
        const missingEndpointMessage = bridgeUrl
          ? `MCP direct bridge failed (${lastErrorMessage || 'unknown error'}) and endpoint is not configured: ${serverKey}`
          : `MCP direct bridge is not configured and endpoint is not configured: ${serverKey}. Set MCP_DIRECT_BRIDGE_URL or fill endpoint in MCP management.`;
        writeLog({
          userId,
          serverId: server.id,
          action: `tool_call:${toolName}`,
          status: 'error',
          message: missingEndpointMessage,
        });
        throw new Error(missingEndpointMessage);
      }

      const endpointRes = await fetch(server.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serverKey,
          toolName,
          arguments: args,
        }),
      });
      parsed = await parseResponse(endpointRes);
      if (!endpointRes.ok) {
        const message = `Endpoint fallback failed with HTTP ${endpointRes.status}`;
        writeLog({
          userId,
          serverId: server.id,
          action: `tool_call:${toolName}`,
          status: 'error',
          message,
          meta: { response: parsed },
        });
        throw new Error(message);
      }
    }

    writeLog({
      userId,
      serverId: server.id,
      action: `tool_call:${toolName}`,
      status: 'ok',
      message: 'Tool call succeeded',
    });

    return { server, toolName, result: parsed };
  } finally {
    activeOps.delete(lockKey);
  }
}
