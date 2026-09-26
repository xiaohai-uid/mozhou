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
import { closeSync, fsyncSync, openSync, renameSync, writeSync } from 'node:fs'

/**
 * 临时文件后缀是跨模块约定，不只是实现细节：
 * `book-backup.shouldIncludeInBackup` 据此把临时文件排除出备份，
 * `chapter.recoverRollback` 据此清扫翻转前残留的正文临时文件。
 * 改动此值必须同步这两处，否则备份会收入垃圾、恢复会漏扫。
 */
export const ATOMIC_TMP_SUFFIX = '.mozhou-tmp'

export function atomicWriteFileSync(absolutePath: string, content: string): void {
  const tmp = `${absolutePath}${ATOMIC_TMP_SUFFIX}`
  const fd = openSync(tmp, 'w')
  try {
    writeSync(fd, content)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  renameSync(tmp, absolutePath)
}
