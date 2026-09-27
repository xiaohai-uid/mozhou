/**
 * LocalDataPlane 句柄生命周期 adapter。
 *
 * 为什么需要它：LocalDataPlane 持有一个 SQLite 句柄（OS 级资源）。裸用
 * `LocalDataPlane.open(root)` 的人只要在 return 之前忘了 close，句柄就泄漏——
 * 而忘记 close **不报错、不崩、测试照样全绿**，只是进程句柄单调增长。
 * 这正是本模块要拦下的那一类缺陷：
 *
 *   - `/api/works`（移动端每次开章节目录都打）开一次漏一次；
 *   - `LocalDataPlane.open(root).getChangeMatrix()` 开完把对象丢给 GC，
 *     GC 不会关 SQLite——最隐蔽的一种。
 *
 * 接口刻意做成「把句柄借出去」而不是「返回一个句柄」：借出的句柄没有名字，
 * 调用点就没法忘记还。
 */
import { LocalDataPlane } from './local-data-plane.js'

function usingPlane<T>(opener: () => LocalDataPlane, fn: (plane: LocalDataPlane) => T): T {
  const plane = opener()
  try {
    return fn(plane)
  } finally {
    plane.close()
  }
}

/** 严格打开：投影必须就位，缺投影/版本漂移照原样抛（调用方决定是否重建）。 */
export function withPlane<T>(root: string, fn: (plane: LocalDataPlane) => T): T {
  return usingPlane(() => LocalDataPlane.open(root), fn)
}

/** 恢复打开：投影缺失/损坏时先全量从 canon 重建（ADR-0006 可丢弃投影语义）。 */
export function withRebuildPlane<T>(root: string, fn: (plane: LocalDataPlane) => T): T {
  return usingPlane(() => LocalDataPlane.openOrRebuild(root), fn)
}
