"use client";
import React from 'react';
import { Avatar, Typography, Spin } from 'antd';
import { UserOutlined, RobotOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import Image from 'next/image';

interface Message {
  id: number | string;
  text: string;
  sender: 'user' | 'agent';
  status?: 'loading' | 'done' | 'error';
  createdAt: string;
}

interface ChatMessageProps {
  messages: Message[];
  listRef: React.RefObject<HTMLDivElement | null>;
}

const formatTime = (isoString: string) => {
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const ChatMessage: React.FC<ChatMessageProps> = ({ messages, listRef }) => {
  return (
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
  );
};

export default ChatMessage;