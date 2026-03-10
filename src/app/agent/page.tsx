"use client";
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Layout, Input, Typography, Alert, Menu, Button, Divider, Spin, Avatar } from 'antd';
import { PlusOutlined, DatabaseOutlined, BookOutlined, MessageOutlined, MenuUnfoldOutlined, MenuFoldOutlined, LogoutOutlined, UserOutlined } from '@ant-design/icons';
import Image from 'next/image';
import ChatMessage from './ChatMessage';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

const { Sider, Content, Footer } = Layout;
const { Title, Text } = Typography;
const { Search } = Input;

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

type ActiveView = 'chat' | 'mcp' | 'knowledge';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

type ConversationRow = Conversation;
type MessageRow = {
  id: number | string;
  conversationId: string;
  role: 'user' | 'assistant' | string;
  content: string;
  createdAt: string;
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
          conversationId: currentConversationId 
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

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        setMessages(prev => prev.map(msg => msg.id === agentMessageId ? { ...msg, text: fullText } : msg));
      }
      
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
        return <ChatMessage messages={messages} listRef={listRef} />;
      case 'mcp':
        return <div className={styles.placeholder}>MCP 管理页面（待实现）</div>;
      case 'knowledge':
        return <div className={styles.placeholder}>知识库页面（待实现）</div>;
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
        {activeView === 'chat' && (
          <Footer className={styles.footer}>
            {error && <Alert title={error} type="error" showIcon className={styles.errorAlert} />}
            <Search placeholder="Type your message here..." enterButton="Send" size="large" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onSearch={handleSendMessage} loading={loading} disabled={loading}/>
          </Footer>
        )}
      </Layout>
    </Layout>
  );
};

export default AgentPage;