import fs from 'fs';
import path from 'path';

type SkillFrontmatter = {
  name?: string;
  description?: string;
  allowedTools?: string[];
};

export type SkillDoc = {
  fileName: string;
  filePath: string;
  name: string;
  description: string;
  allowedTools: string[];
  title: string;
  content: string;
  frontmatter: SkillFrontmatter;
  valid: boolean;
  errors: string[];
  updatedAt: string;
};

export type CreateSkillDocResult = {
  created: boolean;
  skill: SkillDoc;
};

const SKILLS_DIR = path.resolve(process.cwd(), 'skills');

const REQUIRED_SECTIONS = ['## Intent', '## Checklist', '## Review Process', '## Required output'];

const toSkillSlug = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[\/\\:*?"<>|]/g, '')
    .replace(/[`"'，。！？：:；、]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

const parseFrontmatterValue = (rawValue: string) => {
  const value = rawValue.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }
  return value;
};

const parseFrontmatter = (raw: string): SkillFrontmatter => {
  const lines = raw.split('\n');
  const result: SkillFrontmatter = {};
  let currentArrayKey: keyof SkillFrontmatter | null = null;
  for (const line of lines) {
    if (!line.trim()) continue;
    const arrMatch = line.match(/^\s*-\s*(.+)\s*$/);
    if (arrMatch && currentArrayKey === 'allowedTools') {
      const item = parseFrontmatterValue(arrMatch[1] || '');
      if (!result.allowedTools) result.allowedTools = [];
      result.allowedTools.push(item);
      continue;
    }

    const kvMatch = line.match(/^\s*([a-zA-Z0-9_]+)\s*:\s*(.*)\s*$/);
    if (!kvMatch) continue;
    const key = kvMatch[1] as keyof SkillFrontmatter;
    const valueRaw = kvMatch[2] ?? '';
    if (key === 'allowedTools') {
      currentArrayKey = 'allowedTools';
      if (valueRaw.trim()) {
        const single = parseFrontmatterValue(valueRaw);
        result.allowedTools = [single];
      } else if (!result.allowedTools) {
        result.allowedTools = [];
      }
      continue;
    }
    currentArrayKey = null;
    const parsed = parseFrontmatterValue(valueRaw);
    if (key === 'name' || key === 'description') {
      result[key] = parsed;
    }
  }
  return result;
};

const parseMarkdownSkill = (filePath: string): SkillDoc => {
  const fileName = path.basename(filePath);
  const raw = fs.readFileSync(filePath, 'utf8');
  const stat = fs.statSync(filePath);
  const errors: string[] = [];

  let frontmatter: SkillFrontmatter = {};
  let body = raw;
  if (raw.startsWith('---')) {
    const end = raw.indexOf('\n---', 3);
    if (end > 0) {
      const fmRaw = raw.slice(3, end).trim();
      body = raw.slice(end + 4).trimStart();
      frontmatter = parseFrontmatter(fmRaw);
    } else {
      errors.push('Frontmatter opening found but missing closing ---.');
    }
  } else {
    errors.push('Missing frontmatter block.');
  }

  const name = (frontmatter.name || '').trim();
  const description = (frontmatter.description || '').trim();
  const allowedTools = (frontmatter.allowedTools || []).filter(Boolean);

  if (!name) errors.push('Frontmatter field "name" is required.');
  if (!description) errors.push('Frontmatter field "description" is required.');

  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = (titleMatch?.[1] || '').trim();
  if (!title) errors.push('Missing top-level markdown title: # <title>.');

  for (const section of REQUIRED_SECTIONS) {
    if (!body.includes(section)) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  const requiredOutputStart = body.indexOf('## Required output');
  if (requiredOutputStart >= 0) {
    const requiredOutput = body.slice(requiredOutputStart);
    if (!requiredOutput.includes('Template A')) {
      errors.push('Required output must include "Template A".');
    }
    if (!requiredOutput.includes('Template B')) {
      errors.push('Required output must include "Template B".');
    }
  }

  return {
    fileName,
    filePath,
    name: name || fileName.replace(/\.md$/i, ''),
    description,
    allowedTools,
    title,
    content: raw,
    frontmatter,
    valid: errors.length === 0,
    errors,
    updatedAt: stat.mtime.toISOString(),
  };
};

export function listSkills(): SkillDoc[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const files = fs
    .readdirSync(SKILLS_DIR)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    .map((f) => path.join(SKILLS_DIR, f));
  return files.map(parseMarkdownSkill).sort((a, b) => a.name.localeCompare(b.name));
}

export function getSkillByName(name: string): SkillDoc | null {
  const target = name.trim().toLowerCase();
  if (!target) return null;
  const skills = listSkills();
  return (
    skills.find((s) => s.name.toLowerCase() === target) ||
    skills.find((s) => s.fileName.toLowerCase() === `${target}.md`) ||
    null
  );
}

const buildSkillTemplate = (params: { name: string; description: string; intentSeed?: string }) => {
  const { name, description, intentSeed } = params;
  const title = name
    .split('-')
    .filter(Boolean)
    .map((s) => s.slice(0, 1).toUpperCase() + s.slice(1))
    .join(' ');
  const finalIntent = (intentSeed || '').trim() || 'Describe when this skill should be used and the expected scope.';

  return `---
name: ${name}
description: "${description.replace(/"/g, '\\"')}"
---

# ${title}

## Intent
${finalIntent}

## Checklist
List the rules/checkpoints this skill should follow.

## Review Process
1. Identify relevant files or context.
2. Apply checklist rules.
3. Prepare output in the required format.

## Required output
### Template A (any findings)
\`\`\`text
# Code review
Found <N> urgent issues need to be fixed:

## 1 <brief description of bug>
FilePath: <path> line <line>
<relevant code snippet or pointer>


### Suggested fix
<brief description of suggested fix>
\`\`\`

### Template B (no issues)
\`\`\`text
## Code review
No issues found.
\`\`\`
`;
};

export function createSkillDoc(params: { name: string; description?: string; intentSeed?: string }): CreateSkillDocResult {
  const rawName = params.name.trim();
  if (!rawName) throw new Error('Skill name is required.');
  const normalizedName = toSkillSlug(rawName);
  if (!normalizedName) throw new Error('Invalid skill name.');

  const exists = getSkillByName(normalizedName);
  if (exists) return { created: false, skill: exists };

  if (!fs.existsSync(SKILLS_DIR)) {
    fs.mkdirSync(SKILLS_DIR, { recursive: true });
  }

  const description =
    (params.description || '').trim() ||
    `Auto-generated skill document for ${normalizedName}. Please refine Intent/Checklist/Required output as needed.`;
  const fileName = `${normalizedName}.md`;
  const filePath = path.join(SKILLS_DIR, fileName);
  const content = buildSkillTemplate({ name: normalizedName, description, intentSeed: params.intentSeed });
  fs.writeFileSync(filePath, content, 'utf8');

  return { created: true, skill: parseMarkdownSkill(filePath) };
}

