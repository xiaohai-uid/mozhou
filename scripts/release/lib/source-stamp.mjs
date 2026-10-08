import { execFileSync } from 'node:child_process'

/**
 * 由 git 的两个输出算出产物戳（纯函数，便于直接核验干净/脏两个分支）。
 *
 * 为什么需要它：脏工作区里 `rev-parse HEAD` 会谎报——安装器内容来自未提交改动，
 * 戳却指向一个干净提交。发布审计两次栽在这（旧产物戳 90b45a1、本地重建戳 06a5069），
 * 都是「产物内容与戳的提交不对应」。规则：工作区有未提交改动时，戳加 `-dirty` 后缀，
 * 并记录脏文件数，使产物无法冒充干净提交的证明。
 */
export function computeSourceStamp(headSha, porcelainOutput) {
  const dirtyFiles = porcelainOutput.split('\n').filter((line) => line.trim() !== '').length
  const dirty = dirtyFiles > 0
  return {
    sourceCommit: dirty ? `${headSha}-dirty` : headSha,
    sourceCommitSha: headSha,
    dirty,
    dirtyFiles,
  }
}

/** 读仓库当前状态并算戳。 */
export function readSourceStamp(root) {
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  return computeSourceStamp(git(['rev-parse', 'HEAD']), git(['status', '--porcelain']))
}
