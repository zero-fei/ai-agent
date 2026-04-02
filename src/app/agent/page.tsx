"use client";
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Layout, Input, Typography, Alert, Menu, Button, Divider, Spin, Avatar, Select, Modal, AutoComplete, Tag } from 'antd';
import { PlusOutlined, DatabaseOutlined, BookOutlined, MessageOutlined, MenuUnfoldOutlined, MenuFoldOutlined, LogoutOutlined, UserOutlined, ArrowUpOutlined, EditOutlined, DeleteOutlined, ThunderboltOutlined } from '@ant-design/icons';
import Image from 'next/image';
import ChatMessage from './ChatMessage';
import KnowledgeView from './KnowledgeView';
import McpView from './McpView';
import SkillsView from './SkillsView';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

const { Sider, Content, Footer } = Layout;
const { Title, Text } = Typography;

interface Message {
  id: number | string;
  text: string;
  sender: 'user' | 'agent';
  status?: 'loading' | 'done' | 'error';
  createdAt: string;
}

interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

interface User {
  id: string;
  username: string;
  email: string;
}

type ActiveView = 'chat' | 'mcp' | 'knowledge' | 'skills';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

type ConversationRow = Conversation;
type MessageRow = {
  id: number | string;
  conversationId: string;
  role: 'user' | 'assistant' | string;
  content: string;
  createdAt: string;
};

type SkillListItem = {
  name: string;
  description: string;
  valid: boolean;
};

// 根据本地时间生成问候语
const getGreetingText = () => {
  if (typeof window === 'undefined') return '你好';
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return '早上好';
  if (hour >= 12 && hour < 14) return '中午好';
  if (hour >= 14 && hour < 19) return '下午好';
  return '晚上好';
};

const AgentPage = () => {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [greeting, setGreeting] = useState('你好');
  const [collectionsForChat, setCollectionsForChat] = useState<{ id: string; name: string }[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [skillsForChat, setSkillsForChat] = useState<SkillListItem[]>([]);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameConversationId, setRenameConversationId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const response = await fetch('/api/auth/session');
        const data = await response.json();
        if (!data.user) {
          router.push('/auth/login');
          return;
        }
        setUser(data.user);
      } catch (error) {
        console.error('Failed to fetch user:', error);
        router.push('/auth/login');
      }
    };
    fetchUser();
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/auth/login');
    router.refresh();
  };

  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/conversations');
      if (!response.ok) throw new Error('Failed to fetch history');
      const data = (await response.json()) as ConversationRow[];
      setHistory(data);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // 为避免 SSR 与客户端首次渲染不一致，问候语只在客户端计算一次
  useEffect(() => {
    setGreeting(getGreetingText());
  }, []);

  // 加载可用于聊天选择的知识库集合
  useEffect(() => {
    const fetchCollectionsForChat = async () => {
      try {
        const res = await fetch('/api/kb/collections');
        if (!res.ok) return;
        const data = (await res.json()) as Array<{ id: string; name: string }>;
        setCollectionsForChat(data);
      } catch {
        // ignore
      }
    };
    fetchCollectionsForChat();
  }, []);

  useEffect(() => {
    const fetchSkillsForChat = async () => {
      try {
        const res = await fetch('/api/skills');
        if (!res.ok) return;
        const data = (await res.json()) as SkillListItem[];
        setSkillsForChat(data.filter((s) => s.valid));
      } catch {
        // ignore
      }
    };
    fetchSkillsForChat();
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([]);
    setError(null);
    setActiveView('chat');
  };

  const openRenameConversation = (conversationId: string) => {
    const conv = history.find((h) => h.id === conversationId);
    setRenameConversationId(conversationId);
    setRenameTitle(conv?.title ?? '');
    setRenameModalOpen(true);
    setRenameLoading(false);
  };

  const handleRenameConversation = async () => {
    if (!renameConversationId) return;
    const trimmedTitle = renameTitle.trim();
    if (!trimmedTitle) {
      setError('对话标题不能为空');
      return;
    }

    setRenameLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${renameConversationId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: trimmedTitle }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error((data && (data as { error?: string }).error) || 'Failed to rename conversation');
      }

      setRenameModalOpen(false);
      setRenameConversationId(null);
      setRenameTitle('');
      await fetchHistory();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setRenameLoading(false);
    }
  };

  const handleDeleteConversation = (conversationId: string) => {
    Modal.confirm({
      title: '删除会话？',
      content: '删除后会清理该会话的所有消息。',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const res = await fetch(`/api/conversations/${conversationId}`, { method: 'DELETE' });
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            throw new Error((data && (data as { error?: string }).error) || 'Failed to delete conversation');
          }

          if (currentConversationId === conversationId) {
            handleNewConversation();
          }

          await fetchHistory();
        } catch (err: unknown) {
          setError(getErrorMessage(err));
        }
      },
    });
  };

  const handleSelectConversation = async (conversationId: string) => {
    setCurrentConversationId(conversationId);
    setMessages([]);
    setError(null);
    setActiveView('chat');
    setPageLoading(true);
    try {
      const response = await fetch(`/api/conversations/${conversationId}`);
      if (!response.ok) throw new Error('Failed to fetch messages');
      const data = (await response.json()) as MessageRow[];
      const formattedMessages: Message[] = data.map((msg) => ({
        id: msg.id,
        text: msg.content,
        sender: msg.role === 'user' ? 'user' : 'agent',
        status: 'done',
        createdAt: msg.createdAt,
      }));
      setMessages(formattedMessages);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setPageLoading(false);
    }
  };

  const handleSendMessage = async (value: string) => {
    const trimmedValue = value.trim();
    if (trimmedValue === '' || loading) return;

    const userMessage: Message = {
      id: Date.now(),
      text: trimmedValue,
      sender: 'user',
      status: 'done',
      createdAt: new Date().toISOString(),
    };

    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputValue('');
    setError(null);
    setLoading(true);

    const agentMessageId = Date.now() + 1;
    setMessages(prev => [...prev, { id: agentMessageId, text: '', sender: 'agent', status: 'loading', createdAt: new Date().toISOString() }]);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: newMessages.map(m => ({ role: m.sender, content: m.text })),
          conversationId: currentConversationId,
          collectionId: selectedCollectionId,
          skillName: selectedSkillName,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Network response was not ok');
      }
      
      const conversationIdHeader = response.headers.get('X-Conversation-Id');
      if (conversationIdHeader && !currentConversationId) {
        setCurrentConversationId(conversationIdHeader);
        fetchHistory();
      }

      if (!response.body) throw new Error('Response body is null');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let fullText = '';
      let pendingText = '';
      let rafId: number | null = null;
      let sseBuffer = '';
      let lastEventName: string | null = null;

      const flushPendingText = () => {
        const textToApply = pendingText;
        setMessages(prev => prev.map(msg => msg.id === agentMessageId ? { ...msg, text: textToApply } : msg));
      };

      const handleSseEvent = (eventName: string | null, data: string) => {
        const name = eventName || 'message';
        if (name === 'delta') {
          fullText += data;
          pendingText = fullText;
        } else if (name === 'end') {
          try {
            const parsed = JSON.parse(data) as { conversationId?: string };
            if (parsed?.conversationId && !currentConversationId) {
              setCurrentConversationId(parsed.conversationId);
              fetchHistory();
            }
          } catch {
            // ignore
          }
        } else if (name === 'error') {
          // Try to surface server error.
          try {
            const parsed = JSON.parse(data) as { error?: string };
            if (parsed?.error) throw new Error(parsed.error);
          } catch {
            throw new Error(data || 'SSE error');
          }
        } else {
          // Unknown event: treat as text chunk
          fullText += data;
          pendingText = fullText;
        }
      };

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        const chunk = decoder.decode(value, { stream: true });
        sseBuffer += chunk;

        // Parse SSE frames separated by blank line.
        let idx;
        while ((idx = sseBuffer.indexOf('\n\n')) >= 0) {
          const frame = sseBuffer.slice(0, idx);
          sseBuffer = sseBuffer.slice(idx + 2);

          const lines = frame.split('\n').map((l) => l.replace(/\r$/, ''));
          let eventName: string | null = null;
          let dataLines: string[] = [];
          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
              dataLines.push(line.slice(5).trimStart());
            }
          }
          const data = dataLines.join('\n');
          if (!data && !eventName) continue;
          lastEventName = eventName ?? lastEventName;
          handleSseEvent(eventName ?? lastEventName, data);
        }

        if (rafId === null) {
          rafId = window.requestAnimationFrame(() => {
            rafId = null;
            flushPendingText();
          });
        }
      }

      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
      flushPendingText();

      setMessages(prev => prev.map(msg => msg.id === agentMessageId ? { ...msg, status: 'done' } : msg));

    } catch (error: unknown) {
      console.error('Failed to send message:', error);
      const message = getErrorMessage(error);
      setError(message);
      setMessages(prev => prev.map(msg => msg.id === agentMessageId ? { ...msg, status: 'error', text: `Error: ${message}` } : msg));
    } finally {
      setLoading(false);
    }
  };

  const slashQuery = inputValue.startsWith('/') ? inputValue.slice(1).trim().toLowerCase() : '';
  const slashSkillOptions = inputValue.startsWith('/')
    ? skillsForChat
        .filter((s) => !slashQuery || s.name.toLowerCase().includes(slashQuery))
        .slice(0, 8)
        .map((s) => ({
          value: s.name,
          label: (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span>/{s.name}</span>
              <span style={{ color: '#999' }}>{s.description}</span>
            </div>
          ),
        }))
    : [];

  const handleSlashSkillSelect = (skillName: string) => {
    setSelectedSkillName(skillName);
    setInputValue('');
  };

  const renderContent = () => {
    if (pageLoading) {
      return (
        <div className={styles.loadingCenter}>
          <Spin size="large" />
        </div>
      );
    }

    switch (activeView) {
      case 'chat':
        // 空状态欢迎页：没有消息时展示欢迎与输入框（更像“默认对话页面”）
        if (messages.length === 0) {
          const baseGreeting = greeting;
          const finalGreeting = user?.username ? `${baseGreeting}，${user.username}` : baseGreeting;
          return (
            <div className={styles.welcomeWrap}>
              <div className={styles.welcomeInner}>
                <div className={styles.welcomeHeader}>
                  <div className={styles.welcomeText}>
                    <Typography.Title level={2} className={styles.welcomeTitle}>
                      {finalGreeting}
                    </Typography.Title>
                    <Typography.Text type="secondary">
                      有什么我可以帮你的？
                    </Typography.Text>
                  </div>
                </div>

                <div className={styles.welcomeInputRow}>
                  <div className={styles.inputWithSend}>
                    <AutoComplete
                      style={{ width: '100%' }}
                      options={slashSkillOptions}
                      onSelect={handleSlashSkillSelect}
                      open={inputValue.startsWith('/') && slashSkillOptions.length > 0}
                    >
                      <Input
                        placeholder="请输入你的问题…（输入 / 选择技能）"
                        size="large"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        onPressEnter={() => handleSendMessage(inputValue)}
                        disabled={loading}
                        className={styles.textInput}
                      />
                    </AutoComplete>
                    <Button
                      type="primary"
                      size="large"
                      icon={<ArrowUpOutlined />}
                      loading={loading}
                      disabled={loading}
                      onClick={() => handleSendMessage(inputValue)}
                      className={styles.sendBtn}
                      aria-label="发送"
                    />
                  </div>
                  {error && (
                    <Alert
                      title={error}
                      type="error"
                      showIcon
                      className={styles.welcomeError}
                    />
                  )}
                </div>
              </div>
            </div>
          );
        }
        return <ChatMessage messages={messages} listRef={listRef} />;
      case 'mcp':
        return <McpView />;
      case 'knowledge':
        return <KnowledgeView />;
      case 'skills':
        return <SkillsView />;
      default:
        return null;
    }
  };

  return (
    <Layout className={styles.rootLayout}>
      <Sider
        width={260}
        theme="light"
        collapsible
        collapsed={collapsed}
        onCollapse={(value) => setCollapsed(value)}
        trigger={null}
        className={styles.sider}
      >
        <div className={styles.siderHeader}>
          <div className={styles.brand}>
            <Image src="/logo.png" alt="灵析 Logo" width={32} height={32} />
            {!collapsed && <Title level={4} className={styles.brandTitle}>灵析</Title>}
          </div>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            className={styles.collapseBtn}
          />
        </div>
        <Button type="primary" icon={<PlusOutlined />} block size="large" onClick={handleNewConversation}>
          {!collapsed && '新对话'}
        </Button>
        <Menu mode="inline" className={styles.mainMenu} onSelect={({ key }) => setActiveView(key as ActiveView)} selectedKeys={[activeView]} items={[
            { key: 'mcp', icon: <DatabaseOutlined />, label: 'MCP 管理' },
            { key: 'knowledge', icon: <BookOutlined />, label: '知识库' },
            { key: 'skills', icon: <ThunderboltOutlined />, label: 'Skill 管理' },
        ]}/>
        <Divider className={styles.siderDivider} />
        <div className={styles.historyList}>
          {history.map(item => (
            <div
              key={item.id}
              onClick={() => handleSelectConversation(item.id)}
              className={[
                'history-item',
                styles.historyItem,
                collapsed ? styles.historyItemCollapsed : '',
                currentConversationId === item.id ? styles.historyItemActive : '',
              ].filter(Boolean).join(' ')}
            >
              <MessageOutlined />
              {!collapsed && <Typography.Text ellipsis className={styles.historyTitle}>{item.title}</Typography.Text>}
              {!collapsed && (
                <div className={styles.historyItemActions}>
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      openRenameConversation(item.id);
                    }}
                  />
                  <Button
                    type="text"
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteConversation(item.id);
                    }}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
        {!collapsed && user && (
          <div className={styles.userCard}>
            <Avatar icon={<UserOutlined />} className={styles.userAvatar} />
            <div className={styles.userInfo}>
              <Text strong className={styles.userName}>{user.username}</Text>
              <Text type="secondary" ellipsis className={styles.userEmail}>{user.email}</Text>
            </div>
            <Button 
              type="text"
              icon={<LogoutOutlined />} 
              onClick={handleLogout}
              className={styles.logoutBtn}
              title="退出登录"
            />
          </div>
        )}
      </Sider>
      <Layout>
        <Content className={styles.content}>
          {renderContent()}
        </Content>
        {/* Welcome 空状态页已自带输入框，因此 messages 为空时隐藏底部输入栏 */}
        {activeView === 'chat' && messages.length > 0 && (
          <Footer className={styles.footer}>
            {error && <Alert title={error} type="error" showIcon className={styles.errorAlert} />}
            <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Select
                  allowClear
                  placeholder="选择本轮对话使用的知识库（可选）"
                  style={{ width: 300 }}
                  value={selectedCollectionId ?? undefined}
                  onChange={(value) => setSelectedCollectionId(value ?? null)}
                  options={collectionsForChat.map((c) => ({ label: c.name, value: c.id }))}
                />
                {selectedSkillName && (
                  <Tag
                    closable
                    onClose={() => setSelectedSkillName(null)}
                    color="blue"
                    style={{ marginInlineEnd: 0 }}
                  >
                    Skill: {selectedSkillName}
                  </Tag>
                )}
              </div>
            </div>
            <div className={styles.inputWithSend}>
              <AutoComplete
                style={{ width: '100%' }}
                options={slashSkillOptions}
                onSelect={handleSlashSkillSelect}
                open={inputValue.startsWith('/') && slashSkillOptions.length > 0}
              >
                <Input
                  placeholder="Type your message here... (type / to choose skill)"
                  size="large"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onPressEnter={() => handleSendMessage(inputValue)}
                  disabled={loading}
                  className={styles.textInput}
                />
              </AutoComplete>
              <Button
                type="primary"
                size="large"
                icon={<ArrowUpOutlined />}
                loading={loading}
                disabled={loading}
                onClick={() => handleSendMessage(inputValue)}
                className={styles.sendBtn}
                aria-label="Send"
              />
            </div>
          </Footer>
        )}
      </Layout>
      <Modal
        title="重命名会话"
        open={renameModalOpen}
        okText="保存"
        cancelText="取消"
        confirmLoading={renameLoading}
        onOk={handleRenameConversation}
        onCancel={() => {
          setRenameModalOpen(false);
          setRenameConversationId(null);
          setRenameTitle('');
          setRenameLoading(false);
        }}
        destroyOnHidden
      >
        <Input
          value={renameTitle}
          onChange={(e) => setRenameTitle(e.target.value)}
          placeholder="请输入新的标题"
          autoFocus
        />
      </Modal>
    </Layout>
  );
};

export default AgentPage;