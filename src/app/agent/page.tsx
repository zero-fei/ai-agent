"use client";
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Layout, Input, Avatar, Typography, Alert, Spin, Menu, Button, Divider } from 'antd';
import { UserOutlined, RobotOutlined, PlusOutlined, DatabaseOutlined, BookOutlined, MessageOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import Image from 'next/image';

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

const AgentPage = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

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
  };

  const handleSelectConversation = async (conversationId: string) => {
    setCurrentConversationId(conversationId);
    setMessages([]);
    setError(null);
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

  const formatTime = (isoString: string) => {
    return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider width={260} theme="light" style={{ borderRight: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', padding: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
          <Image src="/logo.png" alt="灵析 Logo" width={40} height={40} />
          <Title level={4} style={{ margin: 0 }}>灵析</Title>
        </div>
        <Button type="primary" icon={<PlusOutlined />} block size="large" onClick={handleNewConversation}>
          新对话
        </Button>
        <Menu mode="inline" style={{ borderRight: 0, marginTop: '20px' }} items={[
            { key: 'mcp', icon: <DatabaseOutlined />, label: 'MCP 管理' },
            { key: 'knowledge', icon: <BookOutlined />, label: '知识库' },
        ]}/>
        <Divider style={{ margin: '20px 0' }} />
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {history.map(item => (
            <div key={item.id} onClick={() => handleSelectConversation(item.id)} style={{ padding: '8px 16px', cursor: 'pointer', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '12px', backgroundColor: currentConversationId === item.id ? '#e6f7ff' : 'transparent' }} className="history-item">
              <MessageOutlined />
              <Typography.Text ellipsis style={{ flex: 1 }}>{item.title}</Typography.Text>
            </div>
          ))}
        </div>
      </Sider>
      <Layout>
        <Content style={{ margin: '24px', overflow: 'hidden', display: 'flex', flexDirection: 'column', backgroundColor: '#fff', borderRadius: '8px' }}>
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '24px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {messages.map((item) => (
                <div key={item.id} style={{ display: 'flex', justifyContent: item.sender === 'user' ? 'flex-end' : 'flex-start' }}>
                  <div style={{ display: 'flex', gap: '12px', flexDirection: item.sender === 'user' ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
                    <Avatar src={item.sender === 'agent' ? '/logo.png' : undefined} icon={item.sender === 'user' ? <UserOutlined /> : undefined} />
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: item.sender === 'user' ? 'flex-end' : 'flex-start' }}>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <Typography.Text type="secondary" style={{ fontSize: '12px' }}>
                          {item.sender === 'user' ? 'You' : '灵析'}
                        </Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: '12px' }}>
                          {formatTime(item.createdAt)}
                        </Typography.Text>
                      </div>
                      <div style={{ background: item.sender === 'user' ? '#e6f7ff' : '#f0f2f5', padding: '10px 15px', borderRadius: '10px', marginTop: '4px', maxWidth: 'calc(100vw - 420px)' }}>
                        {item.status === 'loading' && item.text === '' ? <Spin size="small" /> : <ReactMarkdown>{item.text}</ReactMarkdown>}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Content>
        <Footer style={{ padding: '16px 24px', backgroundColor: '#fff', borderTop: '1px solid #f0f0f0' }}>
          {error && <Alert title={error} type="error" showIcon style={{ marginBottom: '16px' }} />}
          <Search placeholder="Type your message here..." enterButton="Send" size="large" value={inputValue} onChange={(e) => setInputValue(e.target.value)} onSearch={handleSendMessage} loading={loading} disabled={loading}/>
        </Footer>
      </Layout>
    </Layout>
  );
};

export default AgentPage;