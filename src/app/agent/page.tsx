"use client";
import React, { useState } from 'react';

interface Message {
  id: number;
  text: string;
  sender: 'user' | 'agent';
}

const AgentPage = () => {
  const [messages, setMessages] = useState<Message[]>([
    { id: 1, text: 'Hello! How can I help you today?', sender: 'agent' },
    { id: 2, text: 'I need help with my account.', sender: 'user' },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleSendMessage = async () => {
    if (inputValue.trim() === '') return;

    const userMessage: Message = {
      id: messages.length + 1,
      text: inputValue,
      sender: 'user',
    };

    setMessages((prevMessages) => [...prevMessages, userMessage]);
    setInputValue('');
    setError(null); // Clear previous errors

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ messages: [...messages, userMessage].map(m => ({ role: m.sender === 'user' ? 'user' : 'assistant', content: m.text })) }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Network response was not ok');
      }

      const agentMessage: Message = {
        id: messages.length + 2,
        text: data.reply,
        sender: 'agent',
      };

      setMessages((prevMessages) => [...prevMessages, agentMessage]);
    } catch (error: any) {
      console.error('Failed to send message:', error);
      setError(error.message);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-100">
      <div className="flex-grow p-4 sm:p-6 overflow-auto">
        <div className="flex flex-col gap-4">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${
                message.sender === 'user' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`px-4 py-2 rounded-lg max-w-xs sm:max-w-md ${
                  message.sender === 'user'
                    ? 'bg-blue-500 text-white'
                    : 'bg-white'
                }`}
              >
                {message.text}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="p-4 bg-white border-t border-gray-200">
        <input
          type="text"
          placeholder="Type your message..."
          className="w-full px-4 py-2 border rounded-full focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={inputValue}
          onChange={handleInputChange}
          onKeyPress={handleKeyPress}
        />
        {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
      </div>
    </div>
  );
};

export default AgentPage;