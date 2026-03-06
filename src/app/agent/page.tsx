"use client";
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Layout, Input, Typography, Alert, Menu, Button, Divider, Spin } from 'antd';
import { PlusOutlined, DatabaseOutlined, BookOutlined, MessageOutlined, MenuUnfoldOutlined, MenuFoldOutlined } from '@ant-design/icons';
import Image from 'next/image';
import ChatMessage from './ChatMessage';

const { Sider, Content, Footer } = Layout;
const { Title } = Typography;
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

type ActiveView = 'chat' | 'mcp' | 'knowledge';

const AgentPage = () => {
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

  const fetchHistory = useCallback(async () => {
    try {
      const response = await fetch('/api/conversations');
      if (!response.ok) throw new Error('Failed to fetch history');
      const data = await response.json();
      setHistory(data);
    } catch (err: any) {
      setError(err.message);
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
      const data = await response.json();
      const formattedMessages = data.map((msg: any) => ({
        id: msg.id,
        text: msg.content,
        sender: msg.role === 'user' ? 'user' : 'agent',
        status: 'done',
        createdAt: msg.createdAt,
      }));
      setMessages(formattedMessages);
    } catch (err: any) {
      setError(err.message);
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

    } catch (error: any) {
      console.error('Failed to send message:', error);
      setError(error.message);
      setMessages(prev => prev.map(msg => msg.id === agentMessageId ? { ...msg, status: 'error', text: `Error: ${error.message}` } : msg));
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => {
    if (pageLoading) {
      return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
          <Spin size="large" />
        </div>
      );
    }

    switch (activeView) {
      case 'chat':
        return <ChatMessage messages={messages} listRef={listRef} />;
      case 'mcp':
        return <div style={{ padding: 24 }}>MCP 管理页面（待实现）</div>;
      case 'knowledge':
        return <div style={{ padding: 24 }}>知识库页面（待实现）</div>;
      default:
        return null;
    }
  };

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider
        width={260}
        theme="light"
        collapsible
        collapsed={collapsed}
        onCollapse={(value) => setCollapsed(value)}
        trigger={null} // Hide the default trigger
        style={{
          borderRight: '1px solid #f0f0f0',
          display: 'flex',
          flexDirection: 'column',
          padding: '16px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', overflow: 'hidden' }}>
            <Image src="/logo.png" alt="灵析 Logo" width={32} height={32} />
            {!collapsed && <Title level={4} style={{ margin: 0, whiteSpace: 'nowrap' }}>灵析</Title>}
          </div>
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
            style={{ fontSize: '16px' }}
          />
        </div>
        <Button type="primary" icon={<PlusOutlined />} block size="large" onClick={handleNewConversation}>
          {!collapsed && '新对话'}
        </Button>
        <Menu mode="inline" style={{ borderRight: 0, marginTop: '20px' }} onSelect={({ key }) => setActiveView(key as ActiveView)} selectedKeys={[activeView]} items={[
            { key: 'mcp', icon: <DatabaseOutlined />, label: 'MCP 管理' },
            { key: 'knowledge', icon: <BookOutlined />, label: '知识库' },
        ]}/>
        <Divider style={{ margin: '20px 0' }} />
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {history.map(item => (
            <div key={item.id} onClick={() => handleSelectConversation(item.id)} style={{ padding: '8px 16px', cursor: 'pointer', borderRadius: '4px', display: 'flex', justifyContent: collapsed ? 'center' : 'flex-start', alignItems: 'center', gap: '12px', backgroundColor: currentConversationId === item.id ? '#e6f7ff' : 'transparent' }} className="history-item">
              <MessageOutlined />
              {!collapsed && <Typography.Text ellipsis style={{ flex: 1 }}>{item.title}</Typography.Text>}
            </div>
          ))}
        </div>
      </Sider>
      <Layout>
        <Content style={{ margin: '24px', overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: '#fff', borderRadius: '8px' }}>
          {renderContent()}
        </Content>
        {activeView === 'chat' && (
          <Footer style={{ padding: '16px 24px', backgroundColor: '#fff', borderTop: '1px solid #f0f0f0' }}>
            {error && <Alert title={error} type="error" showIcon style={{ marginBottom: '16px' }} />}
            <Search placeholder="Type your message here..." enterButton="Send" size="large" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onSearch={handleSendMessage} loading={loading} disabled={loading}/>
          </Footer>
        )}
      </Layout>
    </Layout>
  );
};

export default AgentPage;