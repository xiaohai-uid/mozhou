/**
 * 测试夹具：占住一个 Windows 命名管道，用于「跨进程排他 · 强杀后可立即重取」用例。
 *
 * 独立成文件而不是内联在测试里，有两个原因：
 * 1. 内联字符串要交给解释器执行，静态分析只能看到「一段动态内容被拿去跑」；
 *    落成可见文件后，这段逻辑本身也是可审阅的代码。
 * 2. 同一段逻辑只维护一处，测试与夹具不会各自漂移。
 *
 * 用法：由测试设置 MOZHOU_TEST_PIPE 后启动；绑定成功即向 stdout 写 LOCKED 并常驻。
 */
import { writeSync } from 'node:fs'
import net from 'node:net'

const pipe = process.env.MOZHOU_TEST_PIPE
if (typeof pipe !== 'string' || pipe === '') {
  writeSync(2, 'MOZHOU_TEST_PIPE is required\n')
  process.exit(2)
}

const server = net.createServer()
server.once('error', (error) => {
  writeSync(2, 'ERR ' + String(error.code) + '\n')
  process.exit(2)
})
server.listen(pipe, () => {
  writeSync(1, 'LOCKED\n')
})
