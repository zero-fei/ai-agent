"use client";
import React, { useState } from 'react';
import { Form, Input, Button, Card, message, Typography } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

const { Title } = Typography;

type LoginFormValues = {
  username: string;
  password: string;
};

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

const LoginPage = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onFinish = async (values: LoginFormValues) => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '登录失败');
      }

      message.success('登录成功');
      router.push('/agent');
      router.refresh();
    } catch (error: unknown) {
      message.error(getErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <Card className={styles.card}>
        <div className={styles.header}>
          <Title level={2} className={styles.title}>登录灵析</Title>
          <Typography.Text type="secondary">欢迎回来，请登录您的账户</Typography.Text>
        </div>
        <Form
          name="login"
          onFinish={onFinish}
          autoComplete="off"
          size="large"
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input 
              prefix={<UserOutlined />} 
              placeholder="用户名"
              autoComplete="username"
            />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="密码"
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>

          <div className={styles.footer}>
            <Typography.Text type="secondary">
              还没有账户？{' '}
              <Link href="/auth/register">立即注册</Link>
            </Typography.Text>
          </div>
        </Form>
      </Card>
    </div>
  );
};

export default LoginPage;
