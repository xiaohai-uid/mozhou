/**
 * apps/web/server/agent · 文件类工具（读 / 写 / 管理）。
 *
 * 写盘一律先过 `authorize`：书根与技能根内直写，外部路径要作者确认，系统目录直接拒绝。
 * 删除走宿主回收站软删除，不直接抹掉内容——这样「智能体能删文件」不等于「内容会丢」。
 */
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWriteFileSync } from '@mozhou/data-plane'
import { authorize } from './authorize.js'
import {
  MAX_LIST_ENTRIES,
  MAX_READ_BYTES,
  MAX_WRITE_BYTES,
  NovelTool,
  clip,
  intArg,
  str,
} from './toolHost.js'
import type { ToolHost, ToolJsonSchema, ToolResult } from './toolHost.js'

export class FileReadTool extends NovelTool {
  readonly name = 'file_read'
  readonly description =
    '读取书稿目录内的文件，或列出一个目录。路径在书根/技能根内直读；外部路径需要作者确认。支持 offset/limit 分页。'
  readonly parameters: ToolJsonSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '要读取的文件或要列出的目录路径' },
      listOnly: { type: 'boolean', description: '只列目录，不读文件内容' },
      offset: { type: 'number', description: '从第几行开始（默认 0）' },
      limit: { type: 'number', description: '最多读多少行（默认 400）' },
    },
    required: ['path'],
  }

  execute(args: Readonly<Record<string, unknown>>, host: ToolHost): Promise<ToolResult> {
    const auth = authorize(str(args, 'path'), host)
    if (!auth.ok) return Promise.resolve({ ok: false, content: auth.error })
    if (!existsSync(auth.path)) return Promise.resolve({ ok: false, content: '路径不存在：' + auth.path })

    const stat = statSync(auth.path)
    if (stat.isDirectory() || args['listOnly'] === true) {
      if (!stat.isDirectory()) return Promise.resolve({ ok: false, content: 'listOnly 只能用于目录' })
      const entries = readdirSync(auth.path, { withFileTypes: true }).slice(0, MAX_LIST_ENTRIES)
      const lines = entries.map((e) => {
        const size = e.isFile() ? statSync(join(auth.path, e.name)).size : 0
        return (e.isDirectory() ? '[目录]' : '      ') + ' ' + e.name + (e.isFile() ? ' (' + size + ' 字节)' : '')
      })
      return Promise.resolve({ ok: true, content: clip(lines.join('\n') || '（空目录）'), meta: { entries: entries.length } })
    }

    if (stat.size > MAX_READ_BYTES) {
      return Promise.resolve({ ok: false, content: '文件过大（' + stat.size + ' 字节，上限 ' + MAX_READ_BYTES + '）：请用 offset/limit 分页读取' })
    }
    const lines = readFileSync(auth.path, 'utf8').split('\n')
    const offset = intArg(args, 'offset', 0)
    const limit = intArg(args, 'limit', 400)
    const slice = lines.slice(offset, offset + limit)
    const header = '共 ' + lines.length + ' 行，返回第 ' + (offset + 1) + '–' + (offset + slice.length) + ' 行\n'
    return Promise.resolve({ ok: true, content: clip(header + slice.join('\n')), meta: { totalLines: lines.length } })
  }
}

export class FileWriteTool extends NovelTool {
  readonly name = 'file_write'
  readonly description = '在书稿目录内创建或覆盖一个文本文件。只写文本；写入后回读确认。外部路径需要作者确认。'
  readonly parameters: ToolJsonSchema = {
    type: 'object',
    properties: {
      path: { type: 'string', description: '目标文件路径' },
      content: { type: 'string', description: '要写入的文本内容' },
      mode: { type: 'string', description: 'overwrite（默认）或 append' },
    },
    required: ['path', 'content'],
  }

  execute(args: Readonly<Record<string, unknown>>, host: ToolHost): Promise<ToolResult> {
    const auth = authorize(str(args, 'path'), host)
    if (!auth.ok) return Promise.resolve({ ok: false, content: auth.error })
    const content = str(args, 'content')
    if (Buffer.byteLength(content, 'utf8') > MAX_WRITE_BYTES) {
      return Promise.resolve({ ok: false, content: '内容过大（上限 ' + MAX_WRITE_BYTES + ' 字节）' })
    }
    const append = str(args, 'mode') === 'append'
    try {
      mkdirSync(dirname(auth.path), { recursive: true })
      if (append) {
        appendFileSync(auth.path, content, 'utf8')
      } else {
        atomicWriteFileSync(auth.path, content)
      }
      // 回读确认：不确认就报告失败，避免「说写成功其实没写」。
      if (!append && readFileSync(auth.path, 'utf8') !== content) {
        return Promise.resolve({ ok: false, content: '写入未确认（回读不一致）' })
      }
      const mode = append ? 'append' : 'overwrite'
      return Promise.resolve({ ok: true, content: '已写入 ' + auth.path + '（' + Buffer.byteLength(content, 'utf8') + ' 字节，mode=' + mode + '）' })
    } catch (error) {
      return Promise.resolve({ ok: false, content: '写入失败：' + (error as Error).message })
    }
  }
}

export class FileManageTool extends NovelTool {
  readonly name = 'file_manage'
  readonly description =
    '管理文件：move_to_trash（进回收站，可恢复）、rename、copy、mkdir。删除走回收站软删除，不直接抹掉内容。'
  readonly parameters: ToolJsonSchema = {
    type: 'object',
    properties: {
      action: { type: 'string', description: 'move_to_trash / rename / copy / mkdir' },
      path: { type: 'string', description: '源路径（mkdir 为目标目录）' },
      to: { type: 'string', description: 'rename / copy 的目标路径' },
    },
    required: ['action', 'path'],
  }

  execute(args: Readonly<Record<string, unknown>>, host: ToolHost): Promise<ToolResult> {
    const action = str(args, 'action')
    const auth = authorize(str(args, 'path'), host)
    if (!auth.ok) return Promise.resolve({ ok: false, content: auth.error })

    if (action === 'mkdir') {
      mkdirSync(auth.path, { recursive: true })
      return Promise.resolve({ ok: true, content: '已创建目录 ' + auth.path })
    }
    if (!existsSync(auth.path)) return Promise.resolve({ ok: false, content: '路径不存在：' + auth.path })

    if (action === 'move_to_trash') {
      if (host.trash === undefined) return Promise.resolve({ ok: false, content: '回收站不可用：宿主未注入 trash' })
      const { id } = host.trash(auth.path)
      return Promise.resolve({ ok: true, content: '已移入回收站 ' + auth.path + '（条目 ' + id + '）', meta: { trashId: id } })
    }

    const to = str(args, 'to')
    if (to === '') return Promise.resolve({ ok: false, content: action + ' 需要 to' })
    const authTo = authorize(to, host)
    if (!authTo.ok) return Promise.resolve({ ok: false, content: authTo.error })
    try {
      mkdirSync(dirname(authTo.path), { recursive: true })
      if (action === 'rename') {
        renameSync(auth.path, authTo.path)
        return Promise.resolve({ ok: true, content: '已重命名 ' + auth.path + ' → ' + authTo.path })
      }
      if (action === 'copy') {
        copyFileSync(auth.path, authTo.path)
        return Promise.resolve({ ok: true, content: '已复制 ' + auth.path + ' → ' + authTo.path })
      }
    } catch (error) {
      return Promise.resolve({ ok: false, content: action + ' 失败：' + (error as Error).message })
    }
    return Promise.resolve({ ok: false, content: '未知 action：' + action })
  }
}
