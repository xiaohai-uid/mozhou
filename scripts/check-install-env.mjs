#!/usr/bin/env node
/**
 * 安装环境守卫（实现票 #18 / T8b-1；T9 风险 R1）：
 * onnxruntime-node 的 postinstall 默认强拉 GPU 版二进制（约 250MB），无 CUDA
 * 工具链的机器在解压时失败并整体回滚安装。唯一受支持取值是
 * ONNXRUNTIME_NODE_INSTALL_CUDA=skip——墨舟为纯本地 CPU 推理（P0），不需要
 * CUDA 二进制。本守卫挂在根 preinstall，先于依赖 postinstall 执行，把晦涩的
 * nvcc 解压报错变成一行可执行的修复指令。运行期兜底见
 * packages/context-compiler/src/embedding.ts 的 ensureCudaSkipEnv()。
 */
const value = process.env.ONNXRUNTIME_NODE_INSTALL_CUDA

if (value === 'skip') {
  process.exit(0)
}

console.error(
  [
    '',
    '✗ 缺少环境变量：ONNXRUNTIME_NODE_INSTALL_CUDA=skip',
    '',
    '  onnxruntime-node 的安装脚本默认下载 CUDA 二进制；墨舟是纯本地 CPU 推理，',
    '  不需要该下载（且无 CUDA 工具链时安装必然失败回滚）。请执行：',
    '',
    '    export ONNXRUNTIME_NODE_INSTALL_CUDA=skip',
    '',
    '  然后重新运行 pnpm install。背景与细节见 docs/install.md。',
    '',
  ].join('\n'),
)
process.exit(1)
