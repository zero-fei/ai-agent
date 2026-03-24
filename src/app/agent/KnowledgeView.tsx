"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Spin,
  Switch,
  Typography,
  message,
  Space,
} from "antd";
import type { UploadProps } from "antd";
import { UploadOutlined } from "@ant-design/icons";
import { Upload } from "antd";
import styles from "./page.module.css";
import {
  DEFAULT_KB_CONFIG,
  KbCollectionConfig,
  normalizeText,
  splitText,
} from "@/lib/textProcess";

const { Title, Text } = Typography;
const { TextArea } = Input;

interface KbCollection {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  config?: string | null;
  createdAt: string;
}

interface KbDocument {
  id: string;
  userId: string;
  collectionId: string | null;
  name: string;
  source: string | null;
  createdAt: string;
}

const parseConfig = (raw: string | null | undefined): KbCollectionConfig => {
  if (!raw) return DEFAULT_KB_CONFIG;
  try {
    const parsed = JSON.parse(raw) as Partial<KbCollectionConfig>;
    return { ...DEFAULT_KB_CONFIG, ...parsed };
  } catch {
    return DEFAULT_KB_CONFIG;
  }
};

const KnowledgeView: React.FC = () => {
  const [collections, setCollections] = useState<KbCollection[]>([]);
  const [activeCollectionId, setActiveCollectionId] = useState<string | null>(
    null
  );
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [loadingCollections, setLoadingCollections] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createColVisible, setCreateColVisible] = useState(false);
  const [newColName, setNewColName] = useState("");
  const [newColDesc, setNewColDesc] = useState("");

  const [createDocVisible, setCreateDocVisible] = useState(false);
  const [uploadDocVisible, setUploadDocVisible] = useState(false);
  const [newDocName, setNewDocName] = useState("");
  const [newDocText, setNewDocText] = useState("");
  const [uploadingFile, setUploadingFile] = useState(false);

  const [savingConfig, setSavingConfig] = useState(false);
  const [updatingDocs, setUpdatingDocs] = useState(false);

  const [previewCleanText, setPreviewCleanText] = useState("");
  const [previewChunks, setPreviewChunks] = useState<string[]>([]);

  const currentCollection = useMemo(
    () => collections.find((c) => c.id === activeCollectionId) ?? null,
    [collections, activeCollectionId]
  );

  const [configForm, setConfigForm] = useState<KbCollectionConfig>(
    DEFAULT_KB_CONFIG
  );

  /** 加载集合列表 */
  const fetchCollections = async () => {
    setLoadingCollections(true);
    setError(null);
    try {
      const res = await fetch("/api/kb/collections");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "加载知识库失败");
      }
      const data = (await res.json()) as KbCollection[];
      setCollections(data);

      if (!activeCollectionId && data.length > 0) {
        setActiveCollectionId(data[0].id);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      message.error(msg);
    } finally {
      setLoadingCollections(false);
    }
  };

  /** 加载指定集合下文档 */
  const fetchDocuments = async (collectionId: string | null) => {
    if (!collectionId) {
      setDocuments([]);
      return;
    }
    setLoadingDocs(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        collectionId: collectionId ?? "null",
      });
      const res = await fetch(`/api/kb/documents?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "加载文档失败");
      }
      const data = (await res.json()) as KbDocument[];
      setDocuments(data);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      message.error(msg);
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    fetchCollections();
  }, []);

  useEffect(() => {
    if (currentCollection) {
      setConfigForm(parseConfig(currentCollection.config ?? null));
      fetchDocuments(currentCollection.id);
    } else {
      setDocuments([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCollection?.id]);

  /** 新建集合 */
  const handleCreateCollection = async () => {
    if (!newColName.trim()) {
      message.warning("请输入知识库名称");
      return;
    }
    try {
      const res = await fetch("/api/kb/collections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newColName.trim(),
          description: newColDesc || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "创建知识库失败");
      }
      setCreateColVisible(false);
      setNewColName("");
      setNewColDesc("");
      await fetchCollections();
      message.success("知识库已创建");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(msg);
    }
  };

  /** 删除集合 */
  const handleDeleteCollection = async (id: string) => {
    Modal.confirm({
      title: "删除知识库",
      content: "删除后将移除该知识库下所有文档与片段，操作不可恢复，确定继续？",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        try {
          const res = await fetch(`/api/kb/collections/${id}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "删除知识库失败");
          }
          if (activeCollectionId === id) {
            setActiveCollectionId(null);
          }
          await fetchCollections();
          message.success("知识库已删除");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          message.error(msg);
        }
      },
    });
  };

  /** 新建文档 */
  const handleCreateDocument = async () => {
    if (!activeCollectionId) {
      message.warning("请先选择一个知识库");
      return;
    }
    if (!newDocName.trim() || !newDocText.trim()) {
      message.warning("请输入文档标题和内容");
      return;
    }
    setUpdatingDocs(true);
    try {
      const res = await fetch("/api/kb/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          collectionId: activeCollectionId,
          name: newDocName.trim(),
          text: newDocText,
          source: "manual",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "创建文档失败");
      }
      setCreateDocVisible(false);
      setNewDocName("");
      setNewDocText("");
      await fetchDocuments(activeCollectionId);
      message.success("文档已创建并切分入库");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(msg);
    } finally {
      setUpdatingDocs(false);
    }
  };

  /** 删除文档 */
  const handleDeleteDocument = async (id: string) => {
    Modal.confirm({
      title: "删除文档",
      content: "删除后将移除该文档及其所有知识库片段，确定继续？",
      okText: "删除",
      okButtonProps: { danger: true },
      cancelText: "取消",
      onOk: async () => {
        if (!activeCollectionId) return;
        setUpdatingDocs(true);
        try {
          const res = await fetch(`/api/kb/documents/${id}`, {
            method: "DELETE",
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || "删除文档失败");
          }
          // 本地立即移除，提升交互反馈；后端也会同步删除对应 chunks。
          setDocuments((prev) => prev.filter((doc) => doc.id !== id));
          // 再次从服务端拉取，确保状态与数据库一致。
          await fetchDocuments(activeCollectionId);
          message.success("文档已删除");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          message.error(msg);
        } finally {
          setUpdatingDocs(false);
        }
      },
    });
  };

  /** 保存当前集合的文本清洗/分段配置 */
  const handleSaveConfig = async () => {
    if (!currentCollection) return;
    setSavingConfig(true);
    try {
      const res = await fetch(`/api/kb/collections/${currentCollection.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: configForm }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "保存配置失败");
      }
      message.success("清洗与分段配置已保存");
      await fetchCollections();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(msg);
    } finally {
      setSavingConfig(false);
    }
  };

  /** 文本预览：根据当前配置与输入实时预览清洗 & 分段结果 */
  useEffect(() => {
    if (!newDocText.trim()) {
      setPreviewCleanText("");
      setPreviewChunks([]);
      return;
    }
    const handle = setTimeout(() => {
      try {
        const cfg = configForm ?? DEFAULT_KB_CONFIG;
        const cleaned = normalizeText(newDocText, cfg);
        const chunks = splitText(cleaned, cfg.chunkSize, cfg.chunkOverlap);
        setPreviewCleanText(cleaned);
        setPreviewChunks(chunks);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("Preview text process error:", msg);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [newDocText, configForm]);

  /** 通过文件上传直接入库（不走文本框） */
  const handleUpload: UploadProps["beforeUpload"] = async (file) => {
    if (!activeCollectionId) {
      message.warning("请先选择一个知识库");
      return false;
    }
    setUploadingFile(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("collectionId", activeCollectionId);
      formData.append("name", file.name);
      const res = await fetch("/api/kb/upload", {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "文件上传并入库失败");
      }
      await fetchDocuments(activeCollectionId);
      message.success(`已上传并入库：${file.name}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      message.error(msg);
    } finally {
      setUploadingFile(false);
    }
    return false; // 阻止 antd 自动上传
  };

  return (
    <div className={styles.kbRoot}>
      {error && (
        <Alert
          type="error"
          message="知识库接口错误"
          description={error}
          showIcon
          className={styles.kbAlert}
        />
      )}

      <div className={styles.kbHeader}>
        <div>
          <Title level={3} className={styles.kbTitle}>
            知识库管理
          </Title>
          <Text type="secondary">维护知识库集合、文档，以及文本清洗/分段策略。</Text>
        </div>
        <Space>
          <Button onClick={() => setCreateColVisible(true)}>新建知识库</Button>
          <Button
            disabled={!activeCollectionId}
            onClick={() => setUploadDocVisible(true)}
          >
            上传文档入库
          </Button>
          <Button
            type="primary"
            disabled={!activeCollectionId}
            onClick={() => setCreateDocVisible(true)}
          >
            新建文档
          </Button>
        </Space>
      </div>

      <div className={styles.kbBody}>
        {/* 左侧集合列表 */}
        <div className={styles.kbCollections}>
          <div className={styles.kbCollectionsHeader}>
            <Text strong>知识库列表</Text>
          </div>
          {loadingCollections ? (
            <div className={styles.loadingCenter}>
              <Spin />
            </div>
          ) : collections.length === 0 ? (
            <Empty description="还没有任何知识库，先创建一个吧" />
          ) : (
            <List
              size="small"
              dataSource={collections}
              renderItem={(item) => (
                <List.Item
                  className={
                    item.id === activeCollectionId
                      ? styles.kbCollectionActive
                      : styles.kbCollection
                  }
                  onClick={() => setActiveCollectionId(item.id)}
                  actions={[
                    <Button
                      key="delete"
                      type="link"
                      danger
                      size="small"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteCollection(item.id);
                      }}
                    >
                      删除
                    </Button>,
                  ]}
                >
                  <div>
                    <Text strong>{item.name}</Text>
                    {item.description && (
                      <div>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {item.description}
                        </Text>
                      </div>
                    )}
                  </div>
                </List.Item>
              )}
            />
          )}
        </div>

        {/* 右侧：当前集合详情 + 配置 + 文档列表 */}
        <div className={styles.kbRightPane}>
          {currentCollection ? (
            <>
              <div className={styles.kbDocumentsHeader}>
                <div>
                  <Title level={4} className={styles.kbCollectionTitle}>
                    {currentCollection.name}
                  </Title>
                  {currentCollection.description && (
                    <Text type="secondary">
                      {currentCollection.description}
                    </Text>
                  )}
                </div>
              </div>

              {/* 清洗与分段配置 */}
              <Card
                size="small"
                title="清洗与分段设置（当前知识库）"
                className={styles.kbConfigCard}
              >
                <div className={styles.kbConfigGrid}>
                  <div className={styles.kbConfigRow}>
                    <Text>分段长度（字符）</Text>
                    <InputNumber
                      min={200}
                      max={4000}
                      step={100}
                      value={configForm.chunkSize}
                      onChange={(v) =>
                        setConfigForm((prev) => ({
                          ...prev,
                          chunkSize: Number(v) || DEFAULT_KB_CONFIG.chunkSize,
                        }))
                      }
                    />
                  </div>
                  <div className={styles.kbConfigRow}>
                    <Text>分段重叠（字符）</Text>
                    <InputNumber
                      min={0}
                      max={1000}
                      step={20}
                      value={configForm.chunkOverlap}
                      onChange={(v) =>
                        setConfigForm((prev) => ({
                          ...prev,
                          chunkOverlap:
                            Number(v) ?? DEFAULT_KB_CONFIG.chunkOverlap,
                        }))
                      }
                    />
                  </div>
                  <div className={styles.kbConfigRow}>
                    <Text>合并连续空行</Text>
                    <Switch
                      checked={configForm.mergeEmptyLines}
                      onChange={(checked) =>
                        setConfigForm((prev) => ({
                          ...prev,
                          mergeEmptyLines: checked,
                        }))
                      }
                    />
                  </div>
                  <div className={styles.kbConfigRow}>
                    <Text>去掉每行首尾空格</Text>
                    <Switch
                      checked={configForm.trimSpaces}
                      onChange={(checked) =>
                        setConfigForm((prev) => ({
                          ...prev,
                          trimSpaces: checked,
                        }))
                      }
                    />
                  </div>
                  <div className={styles.kbConfigRow}>
                    <Text>去除 HTML 标签</Text>
                    <Switch
                      checked={configForm.stripHtml}
                      onChange={(checked) =>
                        setConfigForm((prev) => ({
                          ...prev,
                          stripHtml: checked,
                        }))
                      }
                    />
                  </div>
                  <div className={styles.kbConfigRow}>
                    <Text>去除 Markdown 标记</Text>
                    <Switch
                      checked={configForm.stripMarkdown}
                      onChange={(checked) =>
                        setConfigForm((prev) => ({
                          ...prev,
                          stripMarkdown: checked,
                        }))
                      }
                    />
                  </div>
                  <div className={styles.kbConfigRow}>
                    <Text>过滤纯符号/分割线行</Text>
                    <Switch
                      checked={configForm.removeNoiseLines}
                      onChange={(checked) =>
                        setConfigForm((prev) => ({
                          ...prev,
                          removeNoiseLines: checked,
                        }))
                      }
                    />
                  </div>
                </div>
                <div className={styles.kbConfigActions}>
                  <Button onClick={() => setConfigForm(DEFAULT_KB_CONFIG)}>
                    重置为默认
                  </Button>
                  <Button
                    type="primary"
                    loading={savingConfig}
                    onClick={handleSaveConfig}
                  >
                    保存设置
                  </Button>
                </div>
              </Card>

              {/* 文档列表 */}
              <Card
                size="small"
                title="文档列表"
                className={styles.kbDocsCard}
                extra={
                  <Button
                    type="link"
                    onClick={() => activeCollectionId && fetchDocuments(activeCollectionId)}
                  >
                    刷新
                  </Button>
                }
              >
                {loadingDocs || updatingDocs ? (
                  <div className={styles.loadingCenter}>
                    <Spin />
                  </div>
                ) : documents.length === 0 ? (
                  <Empty description="该知识库还没有文档" />
                ) : (
                  <List
                    size="small"
                    dataSource={documents}
                    renderItem={(doc) => (
                      <List.Item
                        actions={[
                          <Button
                            key="delete"
                            type="link"
                            danger
                            size="small"
                            onClick={() => handleDeleteDocument(doc.id)}
                          >
                            删除
                          </Button>,
                        ]}
                      >
                        <List.Item.Meta
                          title={doc.name}
                          description={
                            <Text type="secondary">
                              {(doc.source || "手动添加") +
                                " · " +
                                new Date(doc.createdAt).toLocaleString()}
                            </Text>
                          }
                        />
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </>
          ) : (
            <div className={styles.loadingCenter}>
              <Empty description="请选择左侧一个知识库，或先新建一个" />
            </div>
          )}
        </div>
      </div>

      {/* 新建知识库 Modal */}
      <Modal
        title="新建知识库"
        open={createColVisible}
        onOk={handleCreateCollection}
        onCancel={() => setCreateColVisible(false)}
        okText="创建"
        cancelText="取消"
        destroyOnHidden
      >
        <Input
          placeholder="知识库名称"
          value={newColName}
          onChange={(e) => setNewColName(e.target.value)}
          style={{ marginBottom: 12 }}
        />
        <TextArea
          placeholder="可选：知识库描述"
          value={newColDesc}
          onChange={(e) => setNewColDesc(e.target.value)}
          rows={3}
        />
      </Modal>

      {/* 新建文档 Modal（手动文本 + 预览） */}
      <Modal
        title="新建文档"
        open={createDocVisible}
        onOk={handleCreateDocument}
        onCancel={() => setCreateDocVisible(false)}
        okText="创建并入库"
        cancelText="取消"
        width={900}
        destroyOnHidden
        className={styles.kbNewDocModal}
      >
        <div className={styles.kbNewDocBody}>
          <Space direction="vertical" style={{ width: "100%" }} size="large">
            <Alert
              type="info"
              showIcon
              title="手动粘贴文本后创建入库"
              description="填写标题和原始内容，系统会按当前知识库的清洗与分段设置切分并入库。"
            />
            <Input
              placeholder="文档标题"
              value={newDocName}
              onChange={(e) => setNewDocName(e.target.value)}
            />
            <TextArea
              placeholder="原始文档内容，将根据当前知识库的清洗与分段设置进行切分入库"
              value={newDocText}
              onChange={(e) => setNewDocText(e.target.value)}
              rows={6}
            />
            <div className={styles.kbPreviewRow}>
              <Card
                size="small"
                title="清洗后文本（前 500 字，仅预览）"
                className={styles.kbPreviewCard}
              >
                <pre className={styles.kbPreviewText}>
                  {previewCleanText.length > 500
                    ? `${previewCleanText.slice(0, 500)}…`
                    : previewCleanText}
                </pre>
              </Card>
              <Card
                size="small"
                title={`分段结果（共 ${previewChunks.length} 段，仅预览）`}
                className={styles.kbPreviewCard}
              >
                {previewChunks.length === 0 ? (
                  <Text type="secondary">暂无有效分段</Text>
                ) : (
                  <List
                    size="small"
                    dataSource={previewChunks}
                    renderItem={(chunk, index) => (
                      <List.Item>
                        <div>
                          <Text strong>Chunk {index + 1}</Text>
                          <Text type="secondary" style={{ marginLeft: 8 }}>
                            长度: {chunk.length}
                          </Text>
                          <div className={styles.kbPreviewChunk}>
                            {chunk.length > 200
                              ? `${chunk.slice(0, 200)}…`
                              : chunk}
                          </div>
                        </div>
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            </div>
          </Space>
        </div>
      </Modal>

      {/* 上传文档入库 Modal（直接入库，不回填表单） */}
      <Modal
        title="上传文档并入库"
        open={uploadDocVisible}
        onCancel={() => setUploadDocVisible(false)}
        footer={null}
        width={600}
        destroyOnHidden
        className={styles.kbNewDocModal}
      >
        <div className={styles.kbNewDocBody}>
          <Space direction="vertical" style={{ width: "100%" }} size="large">
            <Alert
              type="info"
              showIcon
              title="上传 TXT / Markdown 文件并入库"
              description="选择文件后，系统会直接切分并写入当前选中的知识库，不会在下方展示原文内容。"
            />
            <Upload
              beforeUpload={handleUpload}
              showUploadList={false}
              accept=".txt,.md,.markdown"
            >
              <Button icon={<UploadOutlined />} loading={uploadingFile}>
                上传文件并入库
              </Button>
            </Upload>
          </Space>
        </div>
      </Modal>
    </div>
  );
};

export default KnowledgeView;

