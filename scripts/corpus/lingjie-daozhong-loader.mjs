/**
 * scripts/corpus/lingjie-daozhong-loader.mjs
 * 
 * 本地长篇小说《零界道种》全套正文、大纲、细纲、角色与世界观设定加载器。
 * 直接从本地真实路径 C:/zcode/novels/零界道种 及历史定稿归档读取。
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE_DIR = 'C:/zcode/novels/零界道种';
const ARCHIVE_PROSE_DIR = 'C:/zcode/novels/99_Archive/零界道种_旧版_陆沉舟_2026-08-12/定稿/正文';

function parseFrontmatterAndBody(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: markdown.trim() };
  }
  const rawYaml = match[1];
  const body = match[2].trim();
  const frontmatter = {};
  for (const line of rawYaml.split(/\r?\n/)) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const val = line.slice(colonIdx + 1).trim();
      frontmatter[key] = val;
    }
  }
  return { frontmatter, body };
}

export function loadLingjieDaozhongData() {
  const result = {
    bookTitle: '零界道种',
    author: '本地作者',
    genre: '东方玄幻 / 城市修仙',
    overviewOutline: '',
    volumeOneOutline: '',
    chapterOutlines: [],
    characters: [],
    factions: [],
    worldviewSettings: [],
    chapters: [],
  };

  // 1. 读取总大纲与第一卷卷纲
  const outlinePath = join(BASE_DIR, '大纲', '大纲.md');
  if (existsSync(outlinePath)) {
    result.overviewOutline = readFileSync(outlinePath, 'utf8');
  }
  const volumePath = join(BASE_DIR, '大纲', '卷纲_第一卷.md');
  if (existsSync(volumePath)) {
    result.volumeOneOutline = readFileSync(volumePath, 'utf8');
  }

  // 2. 读取 1-10 章细纲
  for (let i = 1; i <= 10; i++) {
    const chNum = String(i).padStart(3, '0');
    const outlineFile = join(BASE_DIR, '大纲', `细纲_第${chNum}章.md`);
    if (existsSync(outlineFile)) {
      result.chapterOutlines.push({
        chapterIndex: i,
        title: `第${chNum}章细纲`,
        content: readFileSync(outlineFile, 'utf8')
      });
    }
  }

  // 3. 读取角色设定卡
  const charDir = join(BASE_DIR, '设定', '角色');
  if (existsSync(charDir)) {
    for (const f of readdirSync(charDir).filter(name => name.endsWith('.md'))) {
      const name = f.replace(/\.md$/, '');
      const content = readFileSync(join(charDir, f), 'utf8');
      result.characters.push({
        name,
        ref: `char:${name}`,
        file: f,
        content
      });
    }
  }

  // 4. 读取势力设定卡
  const factionDir = join(BASE_DIR, '设定', '势力');
  if (existsSync(factionDir)) {
    for (const f of readdirSync(factionDir).filter(name => name.endsWith('.md'))) {
      const name = f.replace(/\.md$/, '');
      const content = readFileSync(join(factionDir, f), 'utf8');
      result.factions.push({
        name,
        ref: `faction:${name}`,
        file: f,
        content
      });
    }
  }

  // 5. 读取世界观
  const worldDir = join(BASE_DIR, '设定', '世界观');
  if (existsSync(worldDir)) {
    for (const f of readdirSync(worldDir).filter(name => name.endsWith('.md'))) {
      const name = f.replace(/\.md$/, '');
      const content = readFileSync(join(worldDir, f), 'utf8');
      result.worldviewSettings.push({
        name,
        file: f,
        content
      });
    }
  }

  // 6. 读取 5 大章真实正文
  const chapterSources = [
    { index: 1, title: '不存在的工单', path: join(BASE_DIR, '正文', '第001章_不存在的工单.md') },
    { index: 2, title: '烫手', path: join(BASE_DIR, '正文', '第002章_烫手.md') },
    { index: 3, title: '管廊', path: join(BASE_DIR, '正文', '第003章_管廊.md') },
    { index: 4, title: '灰里开田', path: join(ARCHIVE_PROSE_DIR, '004-灰里开田.md') },
    { index: 5, title: '守灯人', path: join(ARCHIVE_PROSE_DIR, '005-守灯人.md') },
  ];

  for (const src of chapterSources) {
    if (existsSync(src.path)) {
      const raw = readFileSync(src.path, 'utf8');
      const { frontmatter, body } = parseFrontmatterAndBody(raw);
      result.chapters.push({
        chapterIndex: src.index,
        title: `第${src.index}章 ${frontmatter.title || src.title}`,
        frontmatter,
        raw,
        body
      });
    }
  }

  return result;
}
