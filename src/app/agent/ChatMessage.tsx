"use client";
import React from 'react';
import { Avatar, Typography, Spin } from 'antd';
import { UserOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import styles from './ChatMessage.module.css';

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

const MessageItem = React.memo(({ item }: { item: Message }) => {
  return (
    <div className={`${styles.row} ${item.sender === 'user' ? styles.rowUser : styles.rowAgent}`}>
      <div className={`${styles.messageWrap} ${item.sender === 'user' ? styles.messageWrapUser : styles.messageWrapAgent}`}>
        <Avatar src={item.sender === 'agent' ? '/logo.png' : undefined} icon={item.sender === 'user' ? <UserOutlined /> : undefined} />
        <div className={`${styles.metaAndBubble} ${item.sender === 'user' ? styles.metaAndBubbleUser : styles.metaAndBubbleAgent}`}>
          <div className={styles.meta}>
            <Typography.Text type="secondary" className={styles.metaText}>
              {item.sender === 'user' ? 'You' : '灵析'}
            </Typography.Text>
            <Typography.Text type="secondary" className={styles.metaText}>
              {formatTime(item.createdAt)}
            </Typography.Text>
          </div>
          <div className={`${styles.bubble} ${item.sender === 'user' ? styles.bubbleUser : styles.bubbleAgent}`}>
            {item.status === 'loading' && item.text === '' ? <Spin size="small" /> : <ReactMarkdown>{item.text}</ReactMarkdown>}
          </div>
        </div>
      </div>
    </div>
  );
});
MessageItem.displayName = 'MessageItem';

const ChatMessage: React.FC<ChatMessageProps> = ({ messages, listRef }) => {
  return (
    <div ref={listRef} className={styles.list}>
      <div className={styles.stack}>
        {messages.map((item) => (
          <MessageItem key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
};

export default ChatMessage;
