"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, List, Space, Tag, Typography } from 'antd';
import { SyncOutlined } from '@ant-design/icons';
import styles from './page.module.css';

const { Text, Title, Paragraph } = Typography;

type SkillListItem = {
  name: string;
  description: string;
  title: string;
  fileName: string;
  updatedAt: string;
  valid: boolean;
  errors: string[];
  allowedTools: string[];
};

type SkillDetail = SkillListItem & {
  content: string;
};

const SkillsView = () => {
  const [skills, setSkills] = useState<SkillListItem[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [activeDetail, setActiveDetail] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSkill = useMemo(() => skills.find((s) => s.name === activeName) ?? null, [skills, activeName]);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/skills');
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error((data as { error?: string })?.error || '加载 Skills 失败');
      const rows = data as SkillListItem[];
      setSkills(rows);
      setActiveName((prev) => (prev && rows.some((r) => r.name === prev) ? prev : rows[0]?.name ?? null));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (name: string | null) => {
    if (!name) {
      setActiveDetail(null);
      return;
    }
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error((data as { error?: string })?.error || '加载 Skill 详情失败');
      setActiveDetail(data as SkillDetail);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setActiveDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  useEffect(() => {
    loadDetail(activeName);
  }, [activeName, loadDetail]);

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
            Skill 管理
          </Title>
          <Text type="secondary">Skill 仅支持查看和使用，不能在页面中编辑；请通过 Agent 修改 skills 目录下的 md 文件。</Text>
        </div>
        <Button icon={<SyncOutlined />} onClick={loadSkills} loading={loading}>
          刷新
        </Button>
      </div>

      <div className={styles.kbBody}>
        <div className={styles.kbCollections}>
          <div className={styles.kbCollectionsHeader}>
            <Text strong>Skills</Text>
          </div>
          {skills.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无 Skill 文档" />
          ) : (
            <List
              dataSource={skills}
              loading={loading}
              renderItem={(item) => (
                <List.Item
                  className={item.name === activeName ? styles.kbCollectionActive : styles.kbCollection}
                  onClick={() => setActiveName(item.name)}
                >
                  <List.Item.Meta
                    title={
                      <Space>
                        <Text strong>{item.name}</Text>
                        <Tag color={item.valid ? 'green' : 'red'}>{item.valid ? 'valid' : 'invalid'}</Tag>
                      </Space>
                    }
                    description={item.description}
                  />
                </List.Item>
              )}
            />
          )}
        </div>

        <div className={styles.kbRightPane}>
          {!activeSkill ? (
            <div className={styles.loadingCenter}>
              <Empty description="请选择左侧一个 Skill" />
            </div>
          ) : (
            <>
              <Card loading={detailLoading} title={activeSkill.name} className={styles.kbConfigCard}>
                <Space direction="vertical" size={6}>
                  <Text>文件：{activeSkill.fileName}</Text>
                  <Text>更新时间：{new Date(activeSkill.updatedAt).toLocaleString()}</Text>
                  <Text>描述：{activeSkill.description || '-'}</Text>
                  <Text>allowedTools：{activeSkill.allowedTools.length ? activeSkill.allowedTools.join(', ') : '(不限制)'}</Text>
                  {!activeSkill.valid && (
                    <Alert
                      type="warning"
                      showIcon
                      message="此 Skill 文档格式无效，自动/手动使用时会被拒绝。"
                      description={(activeSkill.errors || []).join(' | ')}
                    />
                  )}
                </Space>
              </Card>
              <Card title="Skill 文档预览" className={styles.kbDocsCard}>
                {activeDetail ? (
                  <Paragraph className={styles.skillPreviewText}>{activeDetail.content}</Paragraph>
                ) : (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无详情" />
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default SkillsView;

