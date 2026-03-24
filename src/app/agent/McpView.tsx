"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import Editor, { OnMount } from '@monaco-editor/react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Space,
  Switch,
  Tag,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons';
import styles from './page.module.css';

const { Text, Title } = Typography;

type McpServer = {
  id: string;
  name: string;
  serverKey: string;
  endpoint: string | null;
  config: Record<string, unknown> | null;
  enabled: boolean;
  authStatus: string;
  lastHealthStatus: string | null;
  lastHealthMessage: string | null;
  lastHealthAt: string | null;
  createdAt: string;
};

type McpLog = {
  id: string;
  serverId: string;
  action: string;
  status: string;
  message: string | null;
  createdAt: string;
};

type FormValues = {
  name: string;
  serverKey: string;
  endpoint?: string;
  configJson?: string;
};

const parseJsonInput = (raw: string | undefined): Record<string, unknown> | null => {
  if (!raw?.trim()) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('config 必须是 JSON 对象');
  }
  return parsed as Record<string, unknown>;
};

const getTagColor = (status: string | null | undefined) => {
  if (!status) return 'default';
  if (status === 'ok' || status === 'healthy') return 'green';
  if (status === 'failed' || status === 'error' || status === 'unhealthy') return 'red';
  if (status === 'pending' || status === 'running') return 'processing';
  return 'default';
};

const TEMPLATE_HELLO = `{
  "runtime": "node",
  "tools": {
    "hello": "return \\"hello world\\";"
  }
}`;

const TEMPLATE_ECHO = `{
  "runtime": "node",
  "tools": {
    "echo": "return { received: args };"
  }
}`;

const TEMPLATE_CALC = `{
  "runtime": "node",
  "tools": {
    "sum": "const a = Number(args.a || 0); const b = Number(args.b || 0); return { result: a + b };"
  }
}`;

const configureEditor: OnMount = (editor, monaco) => {
  monaco.languages.json.jsonDefaults.setDiagnosticsOptions({
    validate: true,
    allowComments: false,
    schemas: [
      {
        uri: 'mcp-config-schema.json',
        fileMatch: ['*'],
        schema: {
          type: 'object',
          properties: {
            runtime: { type: 'string', enum: ['node'] },
            tools: {
              type: 'object',
              additionalProperties: { type: 'string' },
              description: 'Tool name to JS code mapping',
            },
          },
          additionalProperties: true,
        },
      },
    ],
  });
  editor.getModel()?.updateOptions({ tabSize: 2 });
};

const McpView = () => {
  const [servers, setServers] = useState<McpServer[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [logs, setLogs] = useState<McpLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);
  const [saving, setSaving] = useState(false);
  const [opLoading, setOpLoading] = useState<'auth' | 'health' | null>(null);
  const [form] = Form.useForm<FormValues>();

  const activeServer = useMemo(() => servers.find((s) => s.id === activeId) ?? null, [servers, activeId]);

  const loadServers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/mcp/servers');
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error((data as { error?: string })?.error || '加载 MCP servers 失败');
      const rows = data as McpServer[];
      setServers(rows);
      setActiveId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLogs = useCallback(async (serverId?: string | null) => {
    try {
      const query = serverId ? `?serverId=${encodeURIComponent(serverId)}&limit=100` : '?limit=100';
      const res = await fetch(`/api/mcp/logs${query}`);
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error((data as { error?: string })?.error || '加载日志失败');
      setLogs(data as McpLog[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  useEffect(() => {
    loadLogs(activeId);
  }, [activeId, loadLogs]);

  const openCreate = () => {
    setEditing(null);
    form.setFieldsValue({ name: '', serverKey: '', endpoint: '', configJson: '' });
    setFormOpen(true);
  };

  const openEdit = (server: McpServer) => {
    setEditing(server);
    form.setFieldsValue({
      name: server.name,
      serverKey: server.serverKey,
      endpoint: server.endpoint ?? '',
      configJson: server.config ? JSON.stringify(server.config, null, 2) : '',
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const payload = {
        name: values.name.trim(),
        serverKey: values.serverKey.trim(),
        endpoint: values.endpoint?.trim() || null,
        config: parseJsonInput(values.configJson),
      };
      const url = editing ? `/api/mcp/servers/${editing.id}` : '/api/mcp/servers';
      const method = editing ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string })?.error || '保存失败');
      message.success(editing ? '已更新 MCP server' : '已创建 MCP server');
      setFormOpen(false);
      await loadServers();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleEnabled = async (server: McpServer, enabled: boolean) => {
    try {
      const res = await fetch(`/api/mcp/servers/${server.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string })?.error || '切换状态失败');
      setServers((prev) => prev.map((s) => (s.id === server.id ? (data as McpServer) : s)));
      await loadLogs(activeId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDelete = (server: McpServer) => {
    Modal.confirm({
      title: `删除 ${server.name}？`,
      content: '删除后将同时清理该 server 的操作日志。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        const res = await fetch(`/api/mcp/servers/${server.id}`, { method: 'DELETE' });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          message.error((data as { error?: string })?.error || '删除失败');
          return;
        }
        message.success('已删除');
        await loadServers();
        await loadLogs(activeId);
      },
    });
  };

  const runOperation = async (action: 'auth' | 'health') => {
    if (!activeServer) return;
    setOpLoading(action);
    try {
      const res = await fetch(`/api/mcp/servers/${activeServer.id}/${action}`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string })?.error || `${action} 失败`);
      message.success(action === 'auth' ? '认证已触发' : '健康检查已完成');
      await loadServers();
      await loadLogs(activeServer.id);
    } catch (err) {
      message.error(err instanceof Error ? err.message : String(err));
    } finally {
      setOpLoading(null);
    }
  };

  const applyTemplate = (template: string) => {
    form.setFieldValue('configJson', template);
  };

  return (
    <div className={styles.kbRoot}>
      {error && (
        <Alert
          type="error"
          showIcon
          className={styles.kbAlert}
          message={error}
          closable
          onClose={() => setError(null)}
        />
      )}
      <div className={styles.kbHeader}>
        <div>
          <Title level={4} className={styles.kbTitle}>
            MCP 管理
          </Title>
          <Text type="secondary">管理 server 配置、认证、健康状态和操作日志（支持在 Config JSON 写本地 Node 工具代码）</Text>
        </div>
        <Space>
          <Button icon={<SyncOutlined />} onClick={() => loadServers()} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            新建 Server
          </Button>
        </Space>
      </div>

      <div className={styles.kbBody}>
        <div className={styles.kbCollections}>
          <div className={styles.kbCollectionsHeader}>
            <Text strong>Servers</Text>
          </div>
          {servers.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 MCP server" />
          ) : (
            <List
              dataSource={servers}
              loading={loading}
              renderItem={(item) => (
                <List.Item
                  className={item.id === activeId ? styles.kbCollectionActive : styles.kbCollection}
                  onClick={() => setActiveId(item.id)}
                  actions={[
                    <Switch
                      key="enabled"
                      size="small"
                      checked={item.enabled}
                      onChange={(v) => handleToggleEnabled(item, v)}
                    />,
                  ]}
                >
                  <List.Item.Meta
                    title={item.name}
                    description={
                      <Space size={6}>
                        <Tag color={getTagColor(item.authStatus)}>auth:{item.authStatus}</Tag>
                        <Tag color={getTagColor(item.lastHealthStatus)}>health:{item.lastHealthStatus || 'unknown'}</Tag>
                      </Space>
                    }
                  />
                </List.Item>
              )}
            />
          )}
        </div>

        <div className={styles.kbRightPane}>
          {!activeServer ? (
            <div className={styles.loadingCenter}>
              <Empty description="请选择左侧一个 MCP server，或先新建一个" />
            </div>
          ) : (
            <>
              <Card
                title={activeServer.name}
                extra={
                  <Space>
                    <Button icon={<EditOutlined />} onClick={() => openEdit(activeServer)}>
                      编辑
                    </Button>
                    <Button
                      loading={opLoading === 'auth'}
                      onClick={() => runOperation('auth')}
                    >
                      认证
                    </Button>
                    <Button
                      loading={opLoading === 'health'}
                      onClick={() => runOperation('health')}
                    >
                      健康检查
                    </Button>
                    <Button danger icon={<DeleteOutlined />} onClick={() => handleDelete(activeServer)}>
                      删除
                    </Button>
                  </Space>
                }
              >
                <Space direction="vertical" size={4}>
                  <Text>serverKey: {activeServer.serverKey}</Text>
                  <Text>endpoint: {activeServer.endpoint || '-'}</Text>
                  <Text>enabled: {activeServer.enabled ? 'true' : 'false'}</Text>
                  <Text>authStatus: {activeServer.authStatus}</Text>
                  <Text>lastHealthStatus: {activeServer.lastHealthStatus || 'unknown'}</Text>
                  <Text type="secondary">lastHealthAt: {activeServer.lastHealthAt || '-'}</Text>
                  {activeServer.lastHealthMessage && <Text type="secondary">{activeServer.lastHealthMessage}</Text>}
                </Space>
                <Alert
                  style={{ marginTop: 12 }}
                  type="info"
                  showIcon
                  message="聊天调用格式"
                  description='@mcp(serverKey,toolName) {"arg":"value"}；若配置 runtime=node + tools，则会优先执行本地 Node 工具代码。'
                />
              </Card>
              <Card title="操作日志（最近 100 条）" className={styles.kbDocsCard}>
                {logs.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无日志" />
                ) : (
                  <List
                    size="small"
                    dataSource={logs}
                    renderItem={(log) => (
                      <List.Item>
                        <Space size={8}>
                          <Tag color={getTagColor(log.status)}>{log.status}</Tag>
                          <Text code>{log.action}</Text>
                          <Text>{log.message || '-'}</Text>
                          <Text type="secondary">{new Date(log.createdAt).toLocaleString()}</Text>
                        </Space>
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </>
          )}
        </div>
      </div>

      <Modal
        title={editing ? '编辑 MCP Server' : '新建 MCP Server'}
        open={formOpen}
        onCancel={() => setFormOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText={editing ? '保存' : '创建'}
        cancelText="取消"
        width={760}
        destroyOnHidden
      >
        <Form layout="vertical" form={form}>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: '请输入名称' }]}>
            <Input placeholder="例如：GitKraken MCP" />
          </Form.Item>
          <Form.Item label="Server Key" name="serverKey" rules={[{ required: true, message: '请输入 serverKey' }]}>
            <Input placeholder="例如：plugin-figma-figma" />
          </Form.Item>
          <Form.Item label="Endpoint (可选)" name="endpoint">
            <Input placeholder="例如：https://example-mcp-server/health" />
          </Form.Item>
          <Form.Item label="Config JSON (可选)" name="configJson">
            <div className={styles.mcpEditorShell}>
              <div className={styles.mcpEditorToolbar}>
                <Space size={8} wrap>
                  <Button size="small" onClick={() => applyTemplate(TEMPLATE_HELLO)}>
                    模板: Hello
                  </Button>
                  <Button size="small" onClick={() => applyTemplate(TEMPLATE_ECHO)}>
                    模板: Echo
                  </Button>
                  <Button size="small" onClick={() => applyTemplate(TEMPLATE_CALC)}>
                    模板: Sum
                  </Button>
                </Space>
                <Text type="secondary">runtime=node 时优先走本地 Node 执行</Text>
              </div>
              <Form.Item noStyle shouldUpdate>
                {() => (
                  <Editor
                    height="300px"
                    defaultLanguage="json"
                    theme="vs-dark"
                    value={form.getFieldValue('configJson') || ''}
                    onMount={configureEditor}
                    onChange={(value) => {
                      form.setFieldValue('configJson', value ?? '');
                    }}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      automaticLayout: true,
                      padding: { top: 12, bottom: 12 },
                      smoothScrolling: true,
                      cursorBlinking: 'smooth',
                    }}
                  />
                )}
              </Form.Item>
              <div className={styles.mcpEditorFooter}>
                <Text type="secondary">
                  调用示例: <Text code>@mcp(your-server-key,hello) {`{}`}</Text>
                </Text>
              </div>
            </div>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
};

export default McpView;
