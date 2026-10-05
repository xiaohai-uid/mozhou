/**
 * 原子落盘单一出口：同目录临时文件 → fsync → rename。
 *
 * rename 是唯一可见点，因此掉电最多丢掉本次写入，绝不会在盘上留下被截断的
 * 半份文件。fsync 不可省略：只做 writeFileSync + rename 时，rename 可能先于
 * 数据刷到介质，掉电后目标文件变成零长度——对稿件与 canon 而言是内容丢失。
 *
 * 不创建父目录：调用方负责目录存在性（与既有 atomicReplace 契约一致）。
 * 不做目录 fsync：本产品以 Windows 为主目标，对目录取 fd 不可移植；缺失该项
 * 的后果仅是崩溃时整个 rename 丢失（旧内容仍在），不产生半份文件。
 */
import { randomBytes } from 'node:crypto'
import { closeSync, fsyncSync, openSync, readdirSync, renameSync, rmSync, unlinkSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/**
 * 临时文件后缀是跨模块约定，不只是实现细节：
 * `book-backup.shouldIncludeInBackup` 按子串 `.mozhou-tmp` 把临时文件排除出备份，
 * `chapter` 的恢复清扫据此定位残留临时文件。
 * 改动此值必须同步这两处，否则备份会收入垃圾、恢复会漏扫。
 *
 * 唯一 token 追加在**后缀之后**（`<target>.mozhou-tmp-<token>`）：`.mozhou-tmp`
 * 子串约定对备份过滤仍然成立；恢复侧不再依赖精确文件名，改按
 * 「该目标路径 + `.mozhou-tmp`」前缀匹配清扫（见 removeAtomicTmpFilesFor）。
 * 固定名 + 非独占创建曾让并发写者互相截断临时文件，且失败时残留垃圾。
 */
export const ATOMIC_TMP_SUFFIX = '.mozhou-tmp'

/** 进程内单调计数：同进程连续两次写入也不会撞名（跨进程由 pid + 随机 token 隔离）。 */
let tmpSequence = 0

function newTmpPath(absolutePath: string): string {
  tmpSequence = (tmpSequence + 1) % Number.MAX_SAFE_INTEGER
  const token = `${process.pid.toString(36)}-${tmpSequence.toString(36)}-${randomBytes(6).toString('hex')}`
  return `${absolutePath}${ATOMIC_TMP_SUFFIX}-${token}`
}

/**
 * 写入 = 独占创建同目录唯一临时文件 → 写全循环 → fsync → close → rename。
 * 失败路径只清理**本次调用拥有**的临时文件（自己的唯一名），绝不触碰他人文件。
 */
export function atomicWriteFileSync(absolutePath: string, content: string): void {
  const tmp = newTmpPath(absolutePath)
  let fd: number | undefined
  try {
    // 'wx' = 独占创建：同名临时文件已存在即失败，绝不截断别人正在写的临时文件
    fd = openSync(tmp, 'wx')
    writeFullSync(fd, content)
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    renameSync(tmp, absolutePath)
  } catch (error) {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // 关闭失败不掩盖原始错误
      }
    }
    try {
      unlinkSync(tmp)
    } catch {
      // 本次未创建成功或已 rename 走：无需清理
    }
    throw error
  }
}

/**
 * 写全循环（规划《墨舟架构规划与分阶段执行方案》§6.2 W1）：
 * writeSync 允许短写（磁盘紧张/信号中断只写入部分字节），单次调用不保证写完；
 * 必须按返回字节数推进偏移补写，直到全部字节落盘。
 * 单次调用零进展（返回 ≤0）即失败——继续重试只会空转，宁可显式报错走清理路径，
 * 也不留下被截断的半份临时内容。
 */
function writeFullSync(fd: number, content: string): void {
  const bytes = Buffer.from(content, 'utf8')
  let written = 0
  while (written < bytes.length) {
    const n = writeSync(fd, bytes, written, bytes.length - written)
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`atomic write: writeSync 停滞（已写 ${written}/${bytes.length} 字节），拒绝留下半份内容`)
    }
    written += n
  }
}

/**
 * 清扫某个目标的原子写临时文件（崩溃恢复侧使用）。
 * 唯一命名下无法再按精确文件名清理，改为「该目标路径 + `.mozhou-tmp`」前缀匹配：
 * 只触碰该目标自己的临时文件，同目录其他目标/他人的临时文件不受影响。
 * 旧版固定名 `<target>.mozhou-tmp` 天然是该前缀的最短匹配，历史残留同样被扫到。
 */
export function removeAtomicTmpFilesFor(absolutePath: string): void {
  const dir = dirname(absolutePath)
  const prefix = `${basename(absolutePath)}${ATOMIC_TMP_SUFFIX}`
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.startsWith(prefix)) {
      rmSync(join(dir, entry), { force: true })
    }
  }
}
