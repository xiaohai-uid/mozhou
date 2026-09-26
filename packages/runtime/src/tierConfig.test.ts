/**
 * T14 验收测试（规格 §6 · 票面五行）：正常加载 / 缺档报错 / 非法结构报错 /
 * mtime 变更热生效 / 明文密钥被拒。
 * 零时钟零外部服务：mtime 与时钟全部注入假值，文件落在临时目录，无真实 sleep。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTierConfig, loadTierConfigFile, TierConfigError } from './tierConfig.js';

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

/**
 * `providers:` 注册表（规格 §6.1 落地）：providerId → { baseURL, apiKeyEnv, models? }。
 * 覆盖的失败路径：只有注册表没有路由 / 缺 baseURL / 缺 apiKeyEnv / 未知字段 / 明文密钥 /
 * 空注册表 / models 非法——每个出口都指向具体键路径，且 loadTierConfig 后向兼容。
 */
const REGISTRY_YAML = [
  'providers:',
  '  deepseek:',
  '    apiKeyEnv: MOZHOU_DEEPSEEK_KEY',
  '    baseURL: https://api.deepseek.com',
  '    models:',
  '      - { id: deepseek-chat, contextWindow: 131072, maxTokens: 8192 }',
  '  glm:',
  '    apiKeyEnv: MOZHOU_GLM_KEY',
  '    baseURL: https://open.bigmodel.cn/api/paas/v4',
  'CHAPTER_DRAFTING:',
  '  quality:',
  '    providerId: glm',
  '    model: glm-4-plus',
  '',
].join('\n');

describe('loadTierConfigFile（规格 §6.1 providers 注册表）', () => {
  it('注册表与路由共存：providers 是保留键，绝不被当作 task_type', async () => {
    const file = await writeConfig('registry.yaml', REGISTRY_YAML);
    const config = await loadTierConfigFile(file, injected());

    expect(Object.keys(config.routes)).toEqual(['CHAPTER_DRAFTING']);
    expect(config.providers['deepseek']).toEqual({
      baseURL: 'https://api.deepseek.com',
      apiKeyEnv: 'MOZHOU_DEEPSEEK_KEY',
      models: [{ id: 'deepseek-chat', contextWindow: 131072, maxTokens: 8192 }],
    });
    // 未声明 models ⇒ 不落该键（exactOptionalPropertyTypes）
    expect(config.providers['glm']).toEqual({
      baseURL: 'https://open.bigmodel.cn/api/paas/v4',
      apiKeyEnv: 'MOZHOU_GLM_KEY',
    });
    expect(config.routes['CHAPTER_DRAFTING']?.quality?.providerId).toBe('glm');
  });

  it('loadTierConfig 后向兼容：仍只返回路由表（不含 providers 键），且与 loadTierConfigFile 共享快照', async () => {
    const file = await writeConfig('compat.yaml', REGISTRY_YAML);
    const fileConfig = await loadTierConfigFile(file, injected());
    const routes = await loadTierConfig(file, injected());
    expect(routes).toBe(fileConfig.routes);
    expect(Object.keys(routes)).not.toContain('providers');
    expect(routes['CHAPTER_DRAFTING']?.quality?.model).toBe('glm-4-plus');
  });

  it('只有 providers 段没有路由 ⇒ TIER_CONFIG_EMPTY（不返回「解析成功但选不到叶子」的假成功）', async () => {
    const file = await writeConfig(
      'providers-only.yaml',
      ['providers:', '  deepseek:', '    apiKeyEnv: MOZHOU_DEEPSEEK_KEY', '    baseURL: https://api.deepseek.com', ''].join('\n'),
    );
    const err = await loadTierConfigFile(file, injected()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TierConfigError);
    expect((err as TierConfigError).code).toBe('TIER_CONFIG_EMPTY');
  });

  it('缺 baseURL / 缺 apiKeyEnv ⇒ 报错指向 providers.<id>.<field>', async () => {
    const noBase = await writeConfig(
      'no-base.yaml',
      ['providers:', '  deepseek:', '    apiKeyEnv: MOZHOU_DEEPSEEK_KEY', 'STYLE_REWRITE:', '  fast:', '    providerId: deepseek', '    model: deepseek-chat', ''].join('\n'),
    );
    const baseErr = await loadTierConfigFile(noBase, injected()).catch((e: unknown) => e);
    expect((baseErr as TierConfigError).keyPath).toBe('providers.deepseek.baseURL');

    const noEnv = await writeConfig(
      'no-env.yaml',
      ['providers:', '  deepseek:', '    baseURL: https://api.deepseek.com', 'STYLE_REWRITE:', '  fast:', '    providerId: deepseek', '    model: deepseek-chat', ''].join('\n'),
    );
    const envErr = await loadTierConfigFile(noEnv, injected()).catch((e: unknown) => e);
    expect((envErr as TierConfigError).keyPath).toBe('providers.deepseek.apiKeyEnv');
  });

  it('注册表未知字段 / 空注册表 / models 非法 ⇒ 结构错误且指向键路径', async () => {
    const unknown = await writeConfig(
      'unknown.yaml',
      ['providers:', '  deepseek:', '    baseURL: https://api.deepseek.com', '    apiKeyEnv: MOZHOU_DEEPSEEK_KEY', '    timeoutMs: 30', 'STYLE_REWRITE:', '  fast:', '    providerId: deepseek', '    model: deepseek-chat', ''].join('\n'),
    );
    const unknownErr = await loadTierConfigFile(unknown, injected()).catch((e: unknown) => e);
    expect((unknownErr as TierConfigError).code).toBe('TIER_CONFIG_STRUCTURE_INVALID');
    expect((unknownErr as TierConfigError).keyPath).toBe('providers.deepseek.timeoutMs');

    const empty = await writeConfig(
      'empty-registry.yaml',
      ['providers: {}', 'STYLE_REWRITE:', '  fast:', '    providerId: deepseek', '    model: deepseek-chat', ''].join('\n'),
    );
    const emptyErr = await loadTierConfigFile(empty, injected()).catch((e: unknown) => e);
    expect((emptyErr as TierConfigError).keyPath).toBe('providers');

    const badModels = await writeConfig(
      'bad-models.yaml',
      ['providers:', '  deepseek:', '    baseURL: https://api.deepseek.com', '    apiKeyEnv: MOZHOU_DEEPSEEK_KEY', '    models:', '      - { id: "" }', 'STYLE_REWRITE:', '  fast:', '    providerId: deepseek', '    model: deepseek-chat', ''].join('\n'),
    );
    const modelsErr = await loadTierConfigFile(badModels, injected()).catch((e: unknown) => e);
    expect((modelsErr as TierConfigError).keyPath).toBe('providers.deepseek.models[0].id');
  });

  it('注册表里的明文 apiKey 同样被拒（密钥本体永不入配置文件），报错不回显密钥', async () => {
    const secret = 'sk-registry-leak';
    const file = await writeConfig(
      'registry-leak.yaml',
      ['providers:', '  deepseek:', '    baseURL: https://api.deepseek.com', '    apiKeyEnv: MOZHOU_DEEPSEEK_KEY', `    apiKey: ${secret}`, 'STYLE_REWRITE:', '  fast:', '    providerId: deepseek', '    model: deepseek-chat', ''].join('\n'),
    );
    const err = await loadTierConfigFile(file, injected()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TierConfigError);
    expect((err as TierConfigError).code).toBe('TIER_CONFIG_PLAINTEXT_KEY');
    expect((err as TierConfigError).keyPath).toBe('providers.deepseek.apiKey');
    expect((err as TierConfigError).message).not.toContain(secret);
  });
});
