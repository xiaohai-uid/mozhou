/**
 * T14 验收测试（规格 §6 · 票面五行）：正常加载 / 缺档报错 / 非法结构报错 /
 * mtime 变更热生效 / 明文密钥被拒。
 * 零时钟零外部服务：mtime 与时钟全部注入假值，文件落在临时目录，无真实 sleep。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTierConfig, TierConfigError } from './tierConfig.js';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'mozhou-t14-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 假 mtime/共用时钟：测试内手动拨动数值即可触发热加载路径。 */
const fakeClock = { mtimeMs: 1_000 };
const injected = () => ({
  statMtimeMs: () => fakeClock.mtimeMs,
  now: () => fakeClock.mtimeMs,
});

const VALID_YAML = [
  'LONGFORM_PLANNING:',
  '  quality:',
  '    providerId: deepseek',
  '    model: deepseek-reasoner',
  '    api_key_ref: MOZHOU_DEEPSEEK_KEY',
  'STYLE_REWRITE:',
  '  fast:',
  '    providerId: deepseek',
  '    model: deepseek-chat',
  '',
].join('\n');

async function writeConfig(name: string, text: string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  await writeFile(file, text);
  return file;
}

describe('loadTierConfig（T14 规格 §6）', () => {
  it('正常加载：task_type→tier→(providerId, model)，api_key_ref 槽位透传', async () => {
    const file = await writeConfig('settings.yaml', VALID_YAML);
    const config = await loadTierConfig(file, injected());
    expect(config['LONGFORM_PLANNING']?.quality).toEqual({
      providerId: 'deepseek',
      model: 'deepseek-reasoner',
      api_key_ref: 'MOZHOU_DEEPSEEK_KEY',
    });
    expect(config['STYLE_REWRITE']?.fast?.model).toBe('deepseek-chat');
  });

  it('缺档报错：文件不存在与空文档分别给出 FILE_NOT_FOUND / EMPTY 确定性错误码', async () => {
    const missing = join(dir, 'absent.yaml');
    const notFound = await loadTierConfig(missing).catch((err: unknown) => err);
    expect(notFound).toBeInstanceOf(TierConfigError);
    expect((notFound as TierConfigError).code).toBe('TIER_CONFIG_FILE_NOT_FOUND');
    expect((notFound as TierConfigError).filePath).toBe(missing);

    const emptyFile = await writeConfig('empty.yaml', '');
    const empty = await loadTierConfig(emptyFile, injected()).catch((err: unknown) => err);
    expect(empty).toBeInstanceOf(TierConfigError);
    expect((empty as TierConfigError).code).toBe('TIER_CONFIG_EMPTY');
  });

  it('非法结构报错：路由缺 model 时错误指向具体键路径 STYLE_REWRITE.fast.model', async () => {
    const file = await writeConfig(
      'bad.yaml',
      ['STYLE_REWRITE:', '  fast:', '    providerId: deepseek', ''].join('\n'),
    );
    const err = await loadTierConfig(file, injected()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TierConfigError);
    expect((err as TierConfigError).code).toBe('TIER_CONFIG_STRUCTURE_INVALID');
    expect((err as TierConfigError).keyPath).toBe('STYLE_REWRITE.fast.model');
  });

  it('mtime 变更热生效：同一假 mtime 命中缓存返回同一快照，拨动后重新解析出新配置', async () => {
    const file = await writeConfig('hot.yaml', VALID_YAML);
    const first = await loadTierConfig(file, injected());
    // mtime 未变 ⇒ 复用内存快照（同一对象引用），不重读文件
    expect(await loadTierConfig(file, injected())).toBe(first);

    await writeFile(file, VALID_YAML.replace('deepseek-reasoner', 'deepseek-v3'));
    fakeClock.mtimeMs = 2_000;
    const reloaded = await loadTierConfig(file, injected());
    expect(reloaded['LONGFORM_PLANNING']?.quality?.model).toBe('deepseek-v3');
    expect(reloaded).not.toBe(first);
  });

  it('明文密钥被拒：任意层级的 apiKey 字段校验失败且报错不回显密钥值', async () => {
    const secret = 'sk-secret-value';
    const file = await writeConfig(
      'leak.yaml',
      ['STYLE_REWRITE:', '  fast:', '    providerId: deepseek', '    model: deepseek-chat', `    apiKey: ${secret}`, ''].join('\n'),
    );
    const err = await loadTierConfig(file, injected()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TierConfigError);
    expect((err as TierConfigError).code).toBe('TIER_CONFIG_PLAINTEXT_KEY');
    expect((err as TierConfigError).keyPath).toBe('STYLE_REWRITE.fast.apiKey');
    expect((err as TierConfigError).message).not.toContain(secret);
  });
});
