/**
 * 文件入库解析工具。
 *
 * 职责：
 * - 将上传文件（PDF/DOCX/MD/TXT）解析成纯文本
 * - 解析逻辑与 RAG 存储逻辑（`rag.ts`）解耦，便于后续替换解析方案
 *
 * 说明：
 * - 运行在服务端（Node.js runtime）。
 * - PDF 的抽取质量取决于 PDF 是否包含可复制的文本层；
 *   扫描版 PDF（只有图片）需要 OCR，这里刻意不做（避免引入复杂依赖与成本）。
 */
function extnameLower(name: string) {
  const idx = name.lastIndexOf('.');
  if (idx < 0) return '';
  return name.slice(idx + 1).toLowerCase();
}

/**
 * 从上传文件中抽取纯文本。
 *
 * @throws 当文件类型不支持时抛出错误
 */
export async function extractTextFromUpload(params: { filename: string; bytes: Uint8Array }) {
  const { filename, bytes } = params;
  const ext = extnameLower(filename);

  if (ext === 'md' || ext === 'markdown' || ext === 'txt') {
    // 简化处理：默认按 UTF-8 解码；如需支持 GBK 等编码，可在这里扩展参数/自动探测。
    return new TextDecoder('utf-8').decode(bytes);
  }

  // 目前为保证运行时稳定，仅支持纯文本/Markdown；
  // 如需扩展 PDF/DOCX，可在确保依赖兼容后再打开对应分支。

  throw new Error(`Unsupported file type: .${ext || '(no extension)'}`);
}

