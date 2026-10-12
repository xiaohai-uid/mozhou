/**
 * 旧浏览器控制台导出片段（P1-export 交付物之一）。
 *
 * 合同要求「在旧浏览器页面控制台直接粘贴运行、自成一体、不依赖构建」。做法：
 * `mozhouExportLocalStorage` 是**纯 JS、无 import 的函数**，其源码即粘贴内容；
 * `BROWSER_EXPORT_SNIPPET` 由 `Function.prototype.toString()` 生成可粘贴文本
 * （`(function(){…})()`）。这样片段既能被测试**直接调用**（无需 eval），
 * 又能被面板「复制片段」按钮交给用户在旧页面控制台运行。
 *
 * 内联了自己的 SHA-256（不依赖 `crypto.subtle`，任意 origin 可用）与白名单枚举/身份归属，
 * 与 `exportLocalStorage` 的一致性由 `migrationFlow.test.ts` 用同一份 localStorage 输入逐字比对。
 */

/**
 * 自包含导出函数。**不要在本函数体内引用模块作用域的任何变量**——
 * 它的 `toString()` 会被当作独立脚本粘贴运行。
 */
export function mozhouExportLocalStorage(
  options?: { readonly download?: boolean; readonly assignGlobal?: boolean },
): unknown {
  const opts: { download?: boolean; assignGlobal?: boolean } = options ?? {}
  const shouldDownload = opts.download !== false
  const shouldAssign = opts.assignGlobal !== false

  const FORMAT_VERSION = 1
  const WORKBENCH_KEY = 'mozhou.workbench.v1'
  const DRAFT_PREFIX = 'mozhou.draft.cache.'
  const BASELINE_PREFIX = 'mozhou.draft.baseline.'
  const CANDIDATE_PREFIX = 'mozhou.candidate.cache.'
  const PROJECTION_PREFIX = 'mozhou.editor.projection.'
  const PREFERENCE_KEYS = ['mozhou.wizard.done', 'mozhou.scene.v1', 'mozhou.skills.active']
  const CANDIDATE_MODES = ['replace', 'continue', 'insert', 'replace-selection']
  const CANDIDATE_PHASES = ['draft_done', 'drafting', 'answered']

  // --- 纯 JS SHA-256（与 apps/web/src/workbench/lib/sha256.ts 同算法）---
  function sha256Hex(text: string): string {
    const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
      0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
      0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
      0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
      0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
      0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
      0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
      0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]
    let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a
    let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19
    const bytes = new TextEncoder().encode(text)
    const l = bytes.length
    const bitLen = l * 8
    const padLen = (l % 64 < 56) ? (56 - (l % 64)) : (120 - (l % 64))
    const padded = new Uint8Array(l + padLen + 8)
    padded.set(bytes)
    padded[l] = 0x80
    const view = new DataView(padded.buffer)
    view.setBigUint64(padded.length - 8, BigInt(bitLen), false)
    const w = new Uint32Array(64)
    for (let i = 0; i < padded.length; i += 64) {
      for (let t = 0; t < 16; t++) w[t] = view.getUint32(i + t * 4, false)
      for (let t = 16; t < 64; t++) {
        const w15 = w[t - 15] ?? 0, w2 = w[t - 2] ?? 0, w16 = w[t - 16] ?? 0, w7 = w[t - 7] ?? 0
        const s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3)
        const s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10)
        w[t] = (w16 + s0 + w7 + s1) | 0
      }
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7
      for (let t = 0; t < 64; t++) {
        const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
        const ch = (e & f) ^ ((~e) & g)
        const temp1 = (h + S1 + ch + (K[t] ?? 0) + (w[t] ?? 0)) | 0
        const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
        const maj = (a & b) ^ (a & c) ^ (b & c)
        const temp2 = (S0 + maj) | 0
        h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0
      }
      h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0
      h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0
    }
    return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => (v >>> 0).toString(16).padStart(8, '0')).join('')
  }

  function canonical(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      const enc = JSON.stringify(value)
      return enc === undefined ? 'null' : enc
    }
    if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(record[k])).join(',') + '}'
  }

  function parseSuffix(suffix: string, marker: string): { identitySuffix: string; chapterIndex: number } | null {
    const prefix = marker + '_'
    if (suffix.indexOf(prefix) !== 0) return null
    const rest = suffix.slice(prefix.length)
    const cut = rest.lastIndexOf('_')
    if (cut <= 0) return null
    const identitySuffix = rest.slice(0, cut)
    const chapterRaw = rest.slice(cut + 1)
    if (identitySuffix.length === 0) return null
    if (!/^[0-9]+$/.test(chapterRaw)) return null
    const chapterIndex = Number(chapterRaw)
    if (!isFinite(chapterIndex) || chapterIndex < 1) return null
    return { identitySuffix, chapterIndex }
  }

  function classify(key: string): { prefix: string; kind: string; marker: string } | null {
    if (key.indexOf(DRAFT_PREFIX) === 0) return { prefix: DRAFT_PREFIX, kind: 'draft', marker: 'ch' }
    if (key.indexOf(BASELINE_PREFIX) === 0) return { prefix: BASELINE_PREFIX, kind: 'baseline', marker: 'ch' }
    if (key.indexOf(CANDIDATE_PREFIX) === 0) return { prefix: CANDIDATE_PREFIX, kind: 'candidate', marker: 'cand' }
    if (key.indexOf(PROJECTION_PREFIX) === 0) return { prefix: PROJECTION_PREFIX, kind: 'projection', marker: 'ch' }
    return null
  }

  function readWorkbench(): { bookId: string; root: string; title: string } | null {
    const raw = localStorage.getItem(WORKBENCH_KEY)
    if (raw === null) return null
    try {
      const parsed = JSON.parse(raw) as { book?: { root?: unknown; bookId?: unknown; title?: unknown } } | null
      if (parsed === null || typeof parsed !== 'object' || parsed.book === undefined || parsed.book === null) return null
      const book = parsed.book
      if (typeof book.root !== 'string' || typeof book.bookId !== 'string' || typeof book.title !== 'string') return null
      if (book.bookId.length === 0 && book.root.length === 0) return null
      return { bookId: book.bookId, root: book.root, title: book.title }
    } catch {
      return null
    }
  }

  function parseCandidate(raw: string): Record<string, unknown> | null {
    try {
      const p = JSON.parse(raw) as Record<string, unknown> | null
      if (p === null || typeof p !== 'object') return null
      if (typeof p['candidateId'] !== 'string') return null
      const base = p['base'] as { revision?: unknown; sha256?: unknown } | undefined
      if (base === undefined || typeof base !== 'object' || base === null) return null
      if (typeof base.revision !== 'number' || !Number.isInteger(base.revision) || base.revision < 0) return null
      if (typeof base.sha256 !== 'string') return null
      if (typeof p['mode'] !== 'string' || CANDIDATE_MODES.indexOf(p['mode']) === -1) return null
      if (typeof p['draftText'] !== 'string' || typeof p['phase'] !== 'string') return null
      if (CANDIDATE_PHASES.indexOf(p['phase']) === -1) return null
      return {
        candidateId: p['candidateId'],
        base: { revision: base.revision, sha256: base.sha256 },
        mode: p['mode'],
        draftText: p['draftText'],
        phase: p['phase'],
        partial: p['partial'] === true,
      }
    } catch {
      return null
    }
  }

  function parseProjection(raw: string): { savedAt: string; blocks: unknown[] } | null {
    try {
      const p = JSON.parse(raw) as { savedAt?: unknown; blocks?: unknown } | null
      if (p === null || typeof p !== 'object' || typeof p.savedAt !== 'string' || !Array.isArray(p.blocks)) return null
      return { savedAt: p.savedAt, blocks: p.blocks }
    } catch {
      return null
    }
  }

  const identity = readWorkbench()
  const currentSuffix = identity === null ? null : (identity.bookId || identity.root)

  const preferences: Record<string, string> = {}
  for (const pk of PREFERENCE_KEYS) {
    const pv = localStorage.getItem(pk)
    if (pv !== null) preferences[pk] = pv
  }

  const unclaimed: Array<Record<string, unknown>> = []
  const claimed: Record<number, {
    chapterIndex: number
    chapterKey: string
    draftText: string | null
    baselineSha256: string | null
    candidate: Record<string, unknown> | null
    editorProjection: { savedAt: string; blocks: unknown[] } | null
  }> = {}

  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (typeof key !== 'string') continue
    if (key === WORKBENCH_KEY) {
      if (identity === null) {
        unclaimed.push({ key, identitySuffix: null, chapterIndex: null, kind: 'workbench', reason: 'unparseable-workbench-identity', raw: localStorage.getItem(key) ?? '' })
      }
      continue
    }
    if (PREFERENCE_KEYS.indexOf(key) !== -1) continue
    const cls = classify(key)
    if (cls === null) continue
    const parsed = parseSuffix(key.slice(cls.prefix.length), cls.marker)
    if (parsed === null) continue // 旧版无归属键 ch_<N>：不进包
    const raw = localStorage.getItem(key) ?? ''
    if (currentSuffix === null || parsed.identitySuffix !== currentSuffix) {
      unclaimed.push({ key, identitySuffix: parsed.identitySuffix, chapterIndex: parsed.chapterIndex, kind: cls.kind, reason: currentSuffix === null ? 'no-workbench-book' : 'identity-not-current-book', raw })
      continue
    }
    const idx = parsed.chapterIndex
    if (claimed[idx] === undefined) {
      claimed[idx] = { chapterIndex: idx, chapterKey: 'ch_' + parsed.identitySuffix + '_' + idx, draftText: null, baselineSha256: null, candidate: null, editorProjection: null }
    }
    const ch = claimed[idx]
    if (cls.kind === 'draft') {
      ch.draftText = raw
    } else if (cls.kind === 'baseline') {
      ch.baselineSha256 = raw
    } else if (cls.kind === 'candidate') {
      const cand = parseCandidate(raw)
      if (cand === null) unclaimed.push({ key, identitySuffix: parsed.identitySuffix, chapterIndex: idx, kind: 'candidate', reason: 'unparseable-candidate', raw })
      else ch.candidate = cand
    } else {
      const proj = parseProjection(raw)
      if (proj === null) unclaimed.push({ key, identitySuffix: parsed.identitySuffix, chapterIndex: idx, kind: 'projection', reason: 'unparseable-projection', raw })
      else ch.editorProjection = proj
    }
  }

  const chapters = Object.keys(claimed)
    .map((k) => claimed[Number(k)]!)
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .map((c) => {
      const hasDraft = c.draftText !== null
      const hasBaseline = c.baselineSha256 !== null
      const draft = (hasDraft || hasBaseline) ? { text: c.draftText ?? '', baselineSha256: c.baselineSha256 } : null
      return { chapterIndex: c.chapterIndex, chapterKey: c.chapterKey, draft, candidate: c.candidate, editorProjection: c.editorProjection }
    })

  const books = identity === null ? [] : [{ identity, chapters }]

  const payload = {
    formatVersion: FORMAT_VERSION,
    origin: { origin: location.origin, userAgent: navigator.userAgent, exportedAt: new Date().toISOString() },
    books,
    unclaimed,
    preferences,
  }
  const pkg = { ...payload, digest: sha256Hex(canonical(payload)) }

  if (shouldAssign) (globalThis as Record<string, unknown>)['__MOZHOU_MIGRATION_PACKAGE__'] = pkg
  try { console.log('[墨舟迁移] 迁移包已生成：', pkg) } catch { /* 控制台不可用：忽略 */ }
  if (shouldDownload) {
    try {
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'mozhou-migration-' + Date.now() + '.json'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch { /* 下载不可用：包已在 console/globalThis，忽略 */ }
  }
  return pkg
}

/**
 * 可在旧浏览器页面控制台直接粘贴运行的片段。
 * 由函数源码生成，故与 `mozhouExportLocalStorage` 行为**逐字一致**（无第二份实现）。
 */
export const BROWSER_EXPORT_SNIPPET: string = '(' + mozhouExportLocalStorage.toString() + ')()'
