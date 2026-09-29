/**
 * LocalDataPlane 句柄生命周期 seam。
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
 * 调用点就没法忘记还。裸 `LocalDataPlane.open/openOrRebuild` 由
 * `eslint.config.js` 的 `no-restricted-syntax` 变成 error——守卫从 245 行正则
 * 源码扫描退化成一条常规门禁规则。
 *
 * ## 为什么两个入口而不是一个
 *
 * 工单 08 的目标形态是 `withBook(root, fn)`。但 `open` 与 `openOrRebuild` 的
 * 失败语义**不同**（前者要求投影就位、缺投影照抛，由调用方决定是否重建），
 * 把二者合成一个名字只会逼调用点写「开两次去 catch」这种怪形态。故保留：
 *
 *   - `withBook`      —— 恢复打开：缺投影先全量从 canon 重建（ADR-0006 可丢弃投影）；
 *   - `withStrictBook` —— 严格打开：缺投影/版本漂移照原样抛。
 *
 * seam 的实质是「借出的句柄没有名字」，不是「函数只有一个」。
 *
 * ## 异步边界：句柄在 settle 前不关
 *
 * `try { return fn(plane) } finally { plane.close() }` 对**同步** fn 正确，对
 * **异步** fn 是错的：Promise 在 fn 返回时已挂起，finally 会在第一个 await 之前
 * 就关掉句柄，把「忘记 close 的泄漏」换成「await 期间句柄已被关掉」的更难查故障。
 *
 * 故：fn 返回 thenable 时等 settle 再关（`withPlane` / `withRebuildPlane` 的旧
 * `finally` 形态对 draftContext 这类 async 调用点一直是错的——见
 * `with-plane.test.ts` 的「异步 fn」用例）。**代价**：跨 await 借用句柄的调用点
 * 拿到的仍是 Promise，其结果在 settle 后才可读；解构句柄在 await 之后会读到
 * 已关闭的句柄，`plane.db.open === false` 一读即知，不静默。
 */
import { LocalDataPlane } from './local-data-plane.js'

/** 借出的句柄是否已归还：`better-sqlite3` 的 `open` 标志，close 后为 false。 */
export function isPlaneOpen(plane: LocalDataPlane): boolean {
  return plane.db.open === true
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object'
    && value !== null
    && typeof (value as { then?: unknown }).then === 'function'
  )
}

function usingPlane<T>(opener: () => LocalDataPlane, fn: (plane: LocalDataPlane) => T): T {
  const plane = opener()
  let result: T
  try {
    result = fn(plane)
  } catch (error) {
    // fn 同步抛错：句柄必须已归还，异常原样上抛。
    plane.close()
    throw error
  }
  if (isPromiseLike(result)) {
    // fn 返回 Promise：句柄活到 settle 为止。close 失败不参与成败——
    // 承诺「句柄被关闭」尽力而为，但绝不让关闭异常吞掉 fn 的成败。
    return result.then(
      (value: unknown) => {
        plane.close()
        return value as T
      },
      (error: unknown) => {
        plane.close()
        throw error
      },
    ) as T
  }
  plane.close()
  return result
}

/** 严格打开：投影必须就位，缺投影/版本漂移照原样抛（调用方决定是否重建）。 */
export function withStrictBook<T>(root: string, fn: (plane: LocalDataPlane) => T): T {
  return usingPlane(() => LocalDataPlane.open(root), fn)
}

/** 恢复打开：投影缺失/损坏时先全量从 canon 重建（ADR-0006 可丢弃投影语义）。 */
export function withBook<T>(root: string, fn: (plane: LocalDataPlane) => T): T {
  return usingPlane(() => LocalDataPlane.openOrRebuild(root), fn)
}

/**
 * 显式**转移所有权**：借出一个长活句柄，调用方负责用 {@link releaseBook} 归还。
 *
 * 为什么需要这个出口：seam 能消灭「忘记 close」，但消灭不了「本就该长活」的持有者
 * ——进程级常驻对账宿主（`ensureReconciliationRuntime`）的句柄必须活过请求边界，
 * 由 `stopReconciliationRuntime` 显式停机时归还。这类持有者是真实的，但它必须
 * **写在代码里**而不是靠默认行为蒙混：
 *
 *   - 句柄只在 with-plane.ts 内被 open（eslint 常规门禁把裸 open 变成 error）；
 *   - 长活持有者必须成对出现 retain/release，且 release 面可枚举。
 *
 * 相比裸 open 的净收益是：以前「这个句柄谁关」只存在于注释里，现在由
 * releaseBook 的调用点决定，且漏掉时 lint 与 code review 都看得见。
 */
export function retainBook(root: string): LocalDataPlane {
  return LocalDataPlane.openOrRebuild(root)
}

/**
 * {@link retainBook} 的严格打开变体：投影必须就位，缺投影/版本漂移照原样抛。
 * 存在的理由是 retain 的两个真实调用方语义相反——常驻对账宿主要恢复打开，
 * 生命周期台架要严格打开（它自己控制删库/重建的时序，openOrRebuild 会在
 * 它毫不知情时把投影重建掉，毁掉它要测的指纹）。
 */
export function retainStrictBook(root: string): LocalDataPlane {
  return LocalDataPlane.open(root)
}

/** 归还 {@link retainBook} 借出的句柄。与 withBook 共用 close 语义（含 watcher 停止）。 */
export function releaseBook(plane: LocalDataPlane): void {
  plane.close()
}
