/**
 * `.mozhou/manifest.json` hash 基线（工单 #6 Q5 冻结落点）：
 * SQLite 投影可弃 ⇒ 基线必须在文件侧；记录「应用自己最后一次写入」的
 * 每一个 canon 文件指纹，用于区分外部修改与自身写入（Hash Baseline 词条）。
 *
 * 格式刻意无时间戳：同 canon 状态 ⇒ 逐字节相同的 manifest，
 * 让「重建前后基线幂等」成为可机械断言的性质。
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isCanonRelPath, MANIFEST_PATH } from './layout.js'
import { sha256FileHex } from './sha256.js'

export const MANIFEST_VERSION = 1

export interface ManifestFileEntry {
  readonly sha256: string
  readonly bytes: number
}

export interface HashManifest {
  readonly manifestVersion: typeof MANIFEST_VERSION
  readonly bookId: string
  /** key = 书根相对 POSIX 路径；仅 canon 文件（.mozhou/ 永不入册）。 */
  readonly files: Readonly<Record<string, ManifestFileEntry>>
}

export class MissingManifestError extends Error {
  override readonly name = 'MissingManifestError'

  constructor(readonly manifestPath: string) {
    super(`missing hash baseline manifest: ${manifestPath}`)
  }
}

/** 全树文件扫描（含 .mozhou/），返回排序后的书根相对 POSIX 路径。 */
export function listAllFiles(root: string, rel = ''): string[] {
  const files: string[] = []
  for (const name of readdirSync(join(root, rel))) {
    const childRel = rel ? `${rel}/${name}` : name
    if (statSync(join(root, childRel)).isDirectory()) {
      files.push(...listAllFiles(root, childRel))
    } else {
      files.push(childRel)
    }
  }
  return files.sort()
}

/** canon 文件清单 = 全树减运行时区。 */
export function scanCanonFiles(root: string): string[] {
  return listAllFiles(root).filter(isCanonRelPath)
}

export function buildManifest(root: string, bookId: string): HashManifest {
  const files: Record<string, ManifestFileEntry> = {}
  for (const rel of scanCanonFiles(root)) {
    files[rel] = { sha256: sha256FileHex(join(root, rel)), bytes: statSync(join(root, rel)).size }
  }
  return { manifestVersion: MANIFEST_VERSION, bookId, files }
}

export function readManifest(root: string): HashManifest {
  const path = join(root, MANIFEST_PATH)
  if (!statSyncSafe(path)) {
    throw new MissingManifestError(path)
  }
  return JSON.parse(readFileSync(path, 'utf8')) as HashManifest
}

function statSyncSafe(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function writeManifest(root: string, manifest: HashManifest): void {
  writeFileSync(join(root, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`)
}

/**
 * 定向刷新：对给定 canon 路径按盘上现状重算指纹并并入基线（S4——基线只记
 * 应用自己的写入；全量 buildManifest 会把无关的外部漂移一并吸进基线，故
 * 增量写路径一律走此处）。返回新 manifest，不落盘。
 */
export function refreshManifestEntries(
  manifest: HashManifest,
  root: string,
  relPaths: readonly string[],
): HashManifest {
  const files: Record<string, ManifestFileEntry> = { ...manifest.files }
  for (const rel of relPaths) {
    if (!isCanonRelPath(rel)) {
      continue
    }
    const absolute = join(root, rel)
    let stat: ReturnType<typeof statSync>
    try {
      stat = statSync(absolute)
    } catch {
      // 盘上已消失 ⇒ 键移除（T5 删除对账：基线吸收「文件没了」这一现状）
      delete files[rel]
      continue
    }
    files[rel] = { sha256: sha256FileHex(absolute), bytes: stat.size }
  }
  // 键序与 buildManifest（全树排序扫描）对齐：增量补丁后的基线与全量重建逐字节一致
  const sorted: Record<string, ManifestFileEntry> = {}
  for (const key of Object.keys(files).sort()) {
    sorted[key] = files[key] as ManifestFileEntry
  }
  return { ...manifest, files: sorted }
}
