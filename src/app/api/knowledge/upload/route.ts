import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { extractTextFromUpload } from '@/lib/ingest';
import { kbUpsertFromText } from '@/lib/rag';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * 上传文件并写入知识库。
 *
 * 输入：
 * - multipart/form-data
 * - 字段 `file`：文件（PDF/DOCX/MD/TXT）
 * - 可选字段：name、source、collectionId
 *
 * 输出：
 * - { documentId, chunks, name, filename }
 *
 * 之所以单独提供该接口（而不是复用 `/api/knowledge/documents`），是为了让“文件解析能力”
 * 可以独立演进，同时不影响“纯文本入库”的契约。
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('auth-token')?.value;
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const user = getSession(token);
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const form = await req.formData();
    const file = form.get('file');
    const nameRaw = form.get('name');
    const sourceRaw = form.get('source');
    const collectionIdRaw = form.get('collectionId');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required (multipart field: file)' }, { status: 400 });
    }

    const filename = file.name || 'upload';
    const name = typeof nameRaw === 'string' && nameRaw.trim() ? nameRaw.trim() : filename;
    const source = typeof sourceRaw === 'string' && sourceRaw.trim() ? sourceRaw.trim() : null;
    const collectionId = typeof collectionIdRaw === 'string' && collectionIdRaw.trim() ? collectionIdRaw.trim() : null;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const text = await extractTextFromUpload({ filename, bytes });
    if (!text?.trim()) return NextResponse.json({ error: 'No text extracted from file.' }, { status: 400 });

    const result = await kbUpsertFromText({ userId: user.id, collectionId, name, text, source: source ?? filename });
    return NextResponse.json({ ...result, name, filename });
  } catch (e) {
    return NextResponse.json({ error: getErrorMessage(e) }, { status: 500 });
  }
}

