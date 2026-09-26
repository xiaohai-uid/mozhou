/**
 * 数据根解析（单一事实来源）。
 *
 * 默认 `<cwd>/.mozhou_data` 只适用于源码直跑。容器与 systemd 部署必须显式指向
 * 挂载卷——`docker-compose.yml` 与 `deploy/README.md` 都按 `MOZHOU_DATA_ROOT`
 * 约定配置。此前该变量无人读取：容器内数据落在镜像层，`docker compose down`、
 * 换镜像或重建容器都会连同全部书稿一起销毁，且没有任何报错。
 */
import { resolve } from 'node:path'

export const DEFAULT_DATA_ROOT_DIRNAME = '.mozhou_data'

/**
 * 空串与纯空白视为未设置：部署模板里 `MOZHOU_DATA_ROOT=` 留空是常见写法，
 * 静默解析成 cwd 会把数据写回镜像层，正是本函数要防的失败模式。
 */
export function resolveDefaultDataRoot(): string {
  const override = process.env['MOZHOU_DATA_ROOT']?.trim()
  if (override !== undefined && override !== '') {
    return resolve(override)
  }
  return resolve(process.cwd(), DEFAULT_DATA_ROOT_DIRNAME)
}

/**
 * 数据根来源。健康端点回传它，用于回答「这个部署到底有没有被显式钉到卷上」：
 * 容器里报 `default` 就说明卷没接上，数据正落在可丢的容器层。
 *
 * 单靠「路径可写」判断不出来——启动锁会 mkdir 出该目录，未挂卷时它同样可写。
 */
export function dataRootSource(): 'env' | 'default' {
  const override = process.env['MOZHOU_DATA_ROOT']?.trim()
  return override !== undefined && override !== '' ? 'env' : 'default'
}
