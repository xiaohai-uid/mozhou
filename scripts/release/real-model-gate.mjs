#!/usr/bin/env node
/**
 * scripts/release/real-model-gate.mjs
 *
 * 发布路径的真实模型自动化门。它把「AI 能否真的写出可用正文」这条主张
 * 纳入发布前作业：有凭据就真跑一次端到端旅程；没凭据就明确 BLOCKED 并让发布失败，
 * 绝不静默跳过。
 *
 * 为什么要有这层包装，而不是让 release.yml 直接调 verify-real-model-journey.mjs：
 *   verify-real-model-journey.mjs 的默认语义是「没密钥就写 BLOCKED 证据、以 0 退出」，
 *   这是有意的（见 docs/gates.md）。发布路径需要的恰恰相反——**缺凭据必须让作业失败**，
 *   否则「没跑」会被下游读成「跑过且通过」。本门因此：
 *     1. 自己先判定凭据是否在场；缺任一必需凭据 ⇒ status=BLOCKED、退出码非 0；
 *     2. 有凭据时以 --strict 调起既有旅程脚本（本门不改动那个文件），
 *        让它的 BLOCKED 也变成非 0，从而不放过任何「假绿」；
 *     3. 把结果落成符合 docs/gates.md 字段约定的结构化证据。
 *
 * 凭据纪律：只从环境变量读取，键名与 apps/web/server/llm/providerSettings.ts 一致；
 * 本文件与证据里都不出现任何取值，只记录「哪些变量名在场」。
 *
 * 退出码：0 VERIFIED · 1 FAILED · 2 BLOCKED。
 *
 * 用法：
 *   node scripts/release/real-model-gate.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSourceStamp } from './lib/source-stamp.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 真实模型 API 凭据的环境变量名，顺序与 providerSettings.ts 的回落链一致。 */
const API_KEY_VARS = ['MOZHOU_API_KEY', 'DEEPSEEK_API_KEY', 'OPENAI_API_KEY']
/** 端点地址与模型名的可选变量（键名，供证据记录；缺省由 provider 决定）。 */
const API_BASE_VARS = ['MOZHOU_API_BASE', 'DEEPSEEK_API_BASE', 'OPENAI_API_BASE']
const MODEL_VARS = ['MOZHOU_MODEL', 'DEEPSEEK_MODEL']

const JOURNEY_REL = 'scripts/verify-real-model-journey.mjs'
const INVOKED_COMMAND = 'node scripts/release/real-model-gate.mjs'
const SCOPE =
  '发布路径真实模型自动化门：有凭据则跑真实模型端到端旅程（建书 → 建章 → 真实流式生成 → 采纳候选 → 定稿提交）；缺凭据则 BLOCKED 并使发布失败'

const EVIDENCE_ROOT = join(repoRoot, 'evidence', 'real-model-journey')

const logLines = []
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  logLines.push(line)
}

function presentVars(names) {
  return names.filter((name) => (process.env[name] ?? '').trim().length > 0)
}

/**
 * 来源戳：脏工作区里短 HEAD 会谎报（旅程跑的是未提交源码，戳却指向干净提交）。
 * 复用 scripts/release/lib/source-stamp.mjs：脏则加 `-dirty` 后缀并记脏文件数。
 */
function sourceStampFields() {
  try {
    const stamp = readSourceStamp(repoRoot)
    return {
      sourceCommit: stamp.sourceCommit,
      sourceCommitSha: stamp.sourceCommitSha,
      dirty: stamp.dirty,
      dirtyFiles: stamp.dirtyFiles,
    }
  } catch {
    return { sourceCommit: 'unknown', sourceCommitSha: 'unknown', dirty: null, dirtyFiles: null }
  }
}

/** 生成不与既有目录相撞的 RUN_ID，避免覆盖既有证据。 */
function allocateRunId() {
  const base = new Date().toISOString().replace(/[:.]/g, '-')
  let runId = base
  let n = 1
  while (existsSync(join(EVIDENCE_ROOT, runId))) runId = `${base}-${n++}`
  return runId
}

const RUN_ID = allocateRunId()
const evidenceDir = join(EVIDENCE_ROOT, RUN_ID)

function writeEvidence(payload) {
  mkdirSync(evidenceDir, { recursive: true })
  writeFileSync(join(evidenceDir, 'result.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  writeFileSync(join(evidenceDir, 'run.log'), `${logLines.join('\n')}\n`, 'utf8')
  log(`evidence written: ${evidenceDir}`)
}

/** 列出当前已有证据目录（带 result.json 的）。 */
function existingEvidenceDirs() {
  if (!existsSync(EVIDENCE_ROOT)) return new Set()
  return new Set(
    readdirSync(EVIDENCE_ROOT).filter((d) => existsSync(join(EVIDENCE_ROOT, d, 'result.json'))),
  )
}

/** 找出本次运行新产生、且不属于本门的证据目录（即旅程脚本自己写的那个）。 */
function newestNewJourneyDir(before) {
  if (!existsSync(EVIDENCE_ROOT)) return null
  const fresh = readdirSync(EVIDENCE_ROOT).filter(
    (d) => d !== RUN_ID && !before.has(d) && existsSync(join(EVIDENCE_ROOT, d, 'result.json')),
  )
  if (fresh.length === 0) return null
  fresh.sort(
    (a, b) => statSync(join(EVIDENCE_ROOT, b)).mtimeMs - statSync(join(EVIDENCE_ROOT, a)).mtimeMs,
  )
  return join(EVIDENCE_ROOT, fresh[0])
}

log('================================================================')
log('MoZhou · 发布路径真实模型自动化门')
log('================================================================')

const detectedKeys = presentVars(API_KEY_VARS)
const detectedBase = presentVars(API_BASE_VARS)
const detectedModel = presentVars(MODEL_VARS)

// ---- 缺凭据：明确 BLOCKED，并以非 0 退出，使发布作业失败。 ----
if (detectedKeys.length === 0) {
  log(`BLOCKED: 未检测到任何真实模型凭据（环境变量名：${API_KEY_VARS.join(' / ')}）。`)
  log('本门不静默跳过：缺凭据即让发布作业失败，避免「没跑」被下游读成「跑过且通过」。')
  log('请为发布作业提供至少一个真实模型 API Key 的环境变量后重跑。')
  const exitCode = 2
  writeEvidence({
    kind: 'release-gate',
    status: 'BLOCKED',
    reason: 'NO_REAL_MODEL_CREDENTIAL',
    ...sourceStampFields(),
    command: INVOKED_COMMAND,
    exitCode,
    scope: SCOPE,
    provider: {
      requiredApiKeyVars: API_KEY_VARS,
      detectedApiKeyVars: [],
      detectedApiBaseVars: detectedBase,
      detectedModelVars: detectedModel,
    },
    result: { journeyExecuted: false },
    limitations: [
      '未检测到真实模型凭据，端到端旅程未执行：本次运行不构成任何真实生成能力的证据。',
      '发布作业需要至少一个真实模型 API Key 的环境变量，否则本门 BLOCKED 并阻断发布。',
    ],
  })
  process.exit(exitCode)
}

// ---- 有凭据：以 --strict 调起既有旅程脚本，把它自己的 BLOCKED 也变成非 0。 ----
log(`检测到真实模型凭据（变量名：${detectedKeys.join(' / ')}；本门不回显任何取值）。`)
log(`启动真实模型端到端旅程：node ${JOURNEY_REL} --strict`)

const before = existingEvidenceDirs()
const run = spawnSync('node', [JOURNEY_REL, '--strict'], {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
})

const journeyDir = newestNewJourneyDir(before)
let journeyEvidence = null
if (journeyDir) {
  try {
    journeyEvidence = JSON.parse(readFileSync(join(journeyDir, 'result.json'), 'utf8'))
  } catch {
    journeyEvidence = null
  }
}

let status
let exitCode
if (run.error) {
  status = 'FAILED'
  exitCode = 1
  log(`FAILED: 无法启动旅程脚本：${run.error.message}`)
} else if (run.status === 0) {
  status = 'VERIFIED'
  exitCode = 0
  log('RESULT: VERIFIED')
} else if (run.status === 2) {
  // 理论上不会走到：本门已确认凭据在场。若旅程仍报 BLOCKED，如实转述，不掩盖。
  status = 'BLOCKED'
  exitCode = 2
  log('RESULT: BLOCKED（旅程脚本判定未跑成，本门如实转述）')
} else {
  status = 'FAILED'
  exitCode = 1
  log(`RESULT: FAILED（旅程脚本退出码 ${run.status ?? 'null'}）`)
}

const provider =
  journeyEvidence && journeyEvidence.provider
    ? { ...journeyEvidence.provider, detectedApiKeyVars: detectedKeys }
    : { detectedApiKeyVars: detectedKeys, detectedApiBaseVars: detectedBase, detectedModelVars: detectedModel }

writeEvidence({
  kind: 'release-gate',
  status,
  ...sourceStampFields(),
  command: INVOKED_COMMAND,
  exitCode,
  scope: SCOPE,
  provider,
  result: {
    journeyExecuted: true,
    journeyExitCode: run.status ?? null,
    journeyEvidenceDir: journeyDir ? journeyDir.slice(repoRoot.length + 1) : null,
    journeyStatus: journeyEvidence ? journeyEvidence.status : null,
    journeyResult: journeyEvidence ? (journeyEvidence.result ?? null) : null,
  },
  limitations:
    journeyEvidence && Array.isArray(journeyEvidence.limitations) ? journeyEvidence.limitations : [],
})

process.exit(exitCode)
