export interface KbCollectionConfig {
  chunkSize: number;
  chunkOverlap: number;
  mergeEmptyLines: boolean;
  trimSpaces: boolean;
  stripHtml: boolean;
  stripMarkdown: boolean;
  removeNoiseLines: boolean;
}

export const DEFAULT_KB_CONFIG: KbCollectionConfig = {
  chunkSize: 800,
  chunkOverlap: 120,
  mergeEmptyLines: true,
  trimSpaces: true,
  stripHtml: false,
  stripMarkdown: false,
  removeNoiseLines: true,
};

export function normalizeText(raw: string, config: KbCollectionConfig): string {
  let text = raw.replace(/\r\n/g, '\n');

  if (config.trimSpaces) {
    text = text
      .split('\n')
      .map((line) => line.trim())
      .join('\n');
  }

  if (config.mergeEmptyLines) {
    text = text.replace(/\n{2,}/g, '\n\n');
  }

  if (config.stripHtml) {
    text = text
      .replace(/<\/p>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '');
  }

  if (config.stripMarkdown) {
    text = text
      .replace(/^#{1,6}\s*/gm, '')
      .replace(/(\*|_){1,3}([^*_]+)\1/g, '$2')
      .replace(/!\[[^\]]*]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)]\([^)]*\)/g, '$1');
  }

  if (config.removeNoiseLines) {
    text = text
      .split('\n')
      .filter((line) => !/^[\s\-\_=~\*]{3,}$/.test(line))
      .join('\n');
  }

  return text.trim();
}

export function splitText(
  text: string,
  chunkSize: number = DEFAULT_KB_CONFIG.chunkSize,
  chunkOverlap: number = DEFAULT_KB_CONFIG.chunkOverlap
): string[] {
  const cleaned = text.replace(/\r\n/g, '\n').trim();
  if (!cleaned) return [];

  const chunks: string[] = [];
  let i = 0;

  while (i < cleaned.length) {
    const end = Math.min(cleaned.length, i + chunkSize);
    let slice = cleaned.slice(i, end);

    if (end < cleaned.length) {
      const lastNewline = slice.lastIndexOf('\n');
      if (lastNewline > Math.floor(chunkSize * 0.5)) {
        slice = slice.slice(0, lastNewline);
      }
    }

    const chunk = slice.trim();
    if (chunk) chunks.push(chunk);

    if (end >= cleaned.length) break;
    i = Math.max(0, i + slice.length - chunkOverlap);
  }

  return chunks;
}

