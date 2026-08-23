# T9 · 本地 embedding 可行性实测（Context Compiler 向量兜底）

> 对应 issue：xiaohai-uid/mozhou#11「本地 embedding 可行性实测」｜Gate A 条目 M5（双路召回：关键词快通道 + 向量兜底）
> 调查方式：文献研究（HF 模型卡 / npm registry / GitHub 源码，经本地 crawl4ai 抓取）+ 本机一次性冒烟验证（WSL2 / Node v22.23.2 / 纯 CPU）。
> 调查日期：2026-08-23。隐私红线 P0：正文处理 100% 本地——本文所有候选均为进程内推理、无网络外发。

---

## 0. 结论先行

**可行。** 推荐组合：

> **fastembed-js v2.x（npm 包名 `fastembed`，MIT）+ BAAI/bge-small-zh-v1.5（int8 量化 ≈ 24MB，512 维，MIT）**

本机实测（纯 CPU）：单条查询 18ms；批量索引摊薄后 ≈16ms/段（约 110 字中文段落）；模型热加载 130ms；语义召回冒烟用例 top-1 正确。体积与延迟与天命项目先例一致（其内置 bge-small-zh ONNX 仅 23MB 且实用，见 `docs/research/reference-retrospective-20260823.md` §4.1）。唯一安装坑（onnxruntime-node postinstall 强拉 GPU 二进制）已定位且有单行环境变量解法（见 §5 R1）。

---

## 1. 方案矩阵：Node 进程内三条路

| | ① fastembed-js | ② @huggingface/transformers（transformers.js） | ③ 裸 onnxruntime-node |
|---|---|---|---|
| 维护方 | Anush008（Qdrant 工程师）/ Qdrant 系 | Hugging Face（Xenova 系转正） | Microsoft |
| 版本（调查时点） | 2.1.0（2025-12 发布）[npm](https://www.npmjs.com/package/fastembed) | 4.2.0（2026-04 发布）[npm](https://www.npmjs.com/package/%40huggingface%2Ftransformers) | 1.27.0 [npm](https://www.npmjs.com/package/onnxruntime-node) |
| License | MIT | Apache-2.0 | MIT |
| 运行时依赖 | onnxruntime-node@1.21.0 + [@anush008/tokenizers](https://github.com/Anush008/tokenizers)（HF tokenizers 的多架构原生绑定）+ @huggingface/hub | onnxruntime-node@1.24.3 + onnxruntime-web + @huggingface/tokenizers + **sharp**（图像处理，文本场景属死重） | 仅自身；tokenizer / pooling / 归一化全部自己拼 |
| 内置中文模型 | **bge-small-zh-v1.5**（枚举 `BGESmallZH`，512 维）、multilingual-e5-large（1024 维），源码见 [src/fastembed.ts](https://github.com/Anush008/fastembed-js/blob/main/src/fastembed.ts) | 无内置名单，任意带 tokenizer.json 的 HF ONNX 模型均可加载（如 [Xenova/bge-small-zh-v1.5](https://huggingface.co/Xenova/bge-small-zh-v1.5)、[Xenova/multilingual-e5-small](https://huggingface.co/Xenova/multilingual-e5-small)） | 同左，但 tokenizer 文件、mean-pooling、L2 归一化、query/passage 前缀逻辑全要手写 |
| 自定义本地模型 | 支持：`model: CUSTOM` + `modelAbsoluteDirPath`（本地 ONNX 目录）+ `executionProviders` + `maxLength`（源码 [InitCustomOptions](https://github.com/Anush008/fastembed-js/blob/main/src/fastembed.ts)） | 支持本地路径加载 | 天然支持 |
| Node 集成难度 | **低**。API 即用：init → embed 生成器；passage/query 分离内置 | 中。feature-extraction pipeline 可用，但 mean-pooling 与归一化需自查写法；双运行时（node/web）概念负担 | **高**。等于自己实现半个 fastembed |
| 主要顾虑 | README 模型清单过时（漏列 BGESmallZH，以源码为准）；单主力维护者；锁死 ort 1.21.0 的 postinstall 有安装坑（§5 R1） | 依赖面大（sharp 原生模块）；量化产物质量参差需逐模型验证 | 工程骨架阶段不值得 |

**判定**：① 为首选——它就是"③ 的正确封装"，且比②轻。②作为备选升级路径（需要任意 HF 模型时）。③仅在两者都不满足时才考虑。

---

## 2. 模型矩阵（中文检索向）

C-MTEB 得分取自 BAAI 官方模型卡对照表（2023-08 口径，31 数据集/6 任务；Retrieval 列即中文检索均分）：
来源：<https://huggingface.co/BAAI/bge-small-zh-v1.5>（同表亦含 m3e/text2vec/ada-002 对照行）。

| 模型 | 参数量 | 维度 | 最大序列 | C-MTEB Avg / Retrieval | License | ONNX 体积 fp32 / int8 | Node 可用载体 |
|---|---|---|---|---|---|---|---|
| **bge-small-zh-v1.5** ★ | 24.0M [¹](https://huggingface.co/api/models/BAAI/bge-small-zh-v1.5) | 512 | 512 tokens | **57.82 / 61.77** [²](https://huggingface.co/BAAI/bge-small-zh-v1.5) | **MIT** | 94.9MB / **24.0MB** [³](https://huggingface.co/Xenova/bge-small-zh-v1.5/tree/main/onnx) | fastembed-js 内置 / transformers.js |
| bge-small-zh（非 v1.5） | ~24M | 512 | 512 | 58.27 / 63.07（略高于 v1.5，但相似度分布未修正）[²](https://huggingface.co/BAAI/bge-small-zh-v1.5) | MIT | 同量级 | 需走 CUSTOM/transformers.js |
| multilingual-e5-small | ~118M（0.1B）[⁴](https://huggingface.co/intfloat/multilingual-e5-small) | 384 | 512 | 55.38 / 59.95 [²](https://huggingface.co/BAAI/bge-small-zh-v1.5) | MIT | 470MB / **118MB** [⁵](https://huggingface.co/Xenova/multilingual-e5-small/tree/main/onnx) | transformers.js（Xenova 转 ONNX）/ fastembed CUSTOM |
| jina-embeddings-v2-base-zh | 160.8M [⁶](https://huggingface.co/api/models/jinaai/jina-embeddings-v2-base-zh) | 768 | **8192**（ALiBi）[⁷](https://huggingface.co/jinaai/jina-embeddings-v2-base-zh) | 55.61（官方 model-index）[⁸](https://huggingface.co/jinaai/jina-embeddings-v2-base-zh/raw/main/README.md) | Apache-2.0 | 641MB / 162MB（仓库自带 ONNX）[⁶](https://huggingface.co/api/models/jinaai/jina-embeddings-v2-base-zh) | transformers.js / fastembed CUSTOM |

参照系：同表 OpenAI text-embedding-ada-002 中文检索仅 52.0、Avg 53.02——上述所有小模型在中文检索上均已超过 ada-002。

**模型结论**：bge-small-zh-v1.5 是唯一同时满足「≤25MB / MIT / 内置支持 / 中文检索分够用」四条件的选项。e5-small 是合理的"中英混检"备胎（118MB 可接受，但必须加 `query:` / `passage:` 前缀，漏加会掉分，见模型卡 FAQ：<https://huggingface.co/intfloat/multilingual-e5-small>）。jina v2 的 8192 长上下文对"整章一次编码"有吸引力，但 162MB 起步且 CPU 延迟约为 bge-small 的 6 倍参数比例，现阶段不值得。

**使用注意（bge 系）**：query 端短查询可加指令前缀 `为这个句子生成表示以用于检索相关文章：`，passage 端永不加；v1.5 不加指令仅有轻微衰减（模型卡 FAQ §3）。v1.5 相似度分布集中在 [0.6,1]，做阈值过滤须按自家数据重定（建议起点 0.8–0.85，模型卡 FAQ §2 明示"看相对排序而非绝对值"）。

---

## 3. 本机实测记录（fastembed-js 2.1.0 × bge-small-zh-v1.5）

环境：WSL2（Ubuntu）/ Node v22.23.2 / 无 GPU / 无 CUDA 工具链。复现脚本三件套（装包→测延迟→测召回）：

```bash
# 安装（关键：跳过 GPU 二进制下载，否则必失败，见 §5 R1）
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm i fastembed

# 冒烟核心
import { EmbeddingModel, FlagEmbedding } from "fastembed";
const model = await FlagEmbedding.init({ model: EmbeddingModel.BGESmallZH });
for await (const batch of model.passageEmbed(passages)) { /* Float32[][] */ }
const q = await model.queryEmbed("……");
```

实测数据：

| 项目 | 数值 |
|---|---|
| init（首次，含模型下载） | 7.3s（模型 ≈24MB 自动落盘 cacheDir） |
| init（缓存热启动） | **130ms** |
| 单段 embedding（≈110 字） | **30ms** |
| 批量索引（20/50/100 段） | 19.9 / 16.9 / **15.9 ms/段**（100 段共 1.59s） |
| 单条 query | **17.9ms** |
| 输出校验 | dim=512，L2 范数=1.0000（已归一化，可直接内积/余弦） |

语义召回冒烟（4 选 1）：查询"主角为了给家人治病筹钱做了什么？"，top-1 正确命中"把怀表当掉换三十两银子给妹妹抓药"（sim=0.448），其余段落 0.33–0.39，区分度清晰。

**对照墨舟场景的充分性判断**：Context Compiler 的向量兜底是"每次组装上下文 1 条 query（<20ms）+ 章节提交后增量索引若干 chunk（百段级 <2s）"的负载形态，当前性能余量 ≥10×。

---

## 4. 推荐组合与集成要点

**主选**：fastembed-js + bge-small-zh-v1.5（int8）。
**升级路径**（中英混检或质量不足时）：multilingual-e5-small int8（118MB），经 transformers.js 加载或 fastembed CUSTOM 目录装载。
**兜底逃生舱**：两者 API 都很薄，统一封一层 `EmbeddingProvider` 端口（embed/passage/query 三方法），引擎可整体替换。

集成要点：

1. **模型分发**：P0 要求下不应依赖首跑联网。fastembed 默认首跑从远端下载到 cacheDir——墨舟应改为随应用打包模型文件，用 `CUSTOM + modelAbsoluteDirPath` 指向内置目录（源码接口已具备：<https://github.com/Anush008/fastembed-js/blob/main/src/fastembed.ts>）。
2. **分块约束**：bge-small-zh-v1.5 上限 512 tokens，章节摘要/chunk 切分按 ~400 tokens 留余量。
3. **阈值策略**：相似度过滤阈值在墨舟自有语料上标定（起步 0.8），排序优先于硬阈值。
4. **安装文档**：CI/用户机一律携带 `ONNXRUNTIME_NODE_INSTALL_CUDA=skip`（CPU 推理不需要 CUDA 库）。

---

## 5. 风险清单

| # | 风险 | 证据 | 缓解 |
|---|---|---|---|
| R1 | **onnxruntime-node postinstall 强制下载 GPU 版二进制**（~250MB，GitHub releases），无 CUDA 工具链时解压失败 → npm 整体回滚删除 node_modules。本机两次复现 | 安装日志 `nvcc not found`；脚本行为定义见 [onnxruntime v1.21.0 install.js](https://github.com/microsoft/onnxruntime/blob/v1.21.0/js/node/script/install.js)（L34–41：`--onnxruntime-node-install-cuda=skip` 或环境变量 `ONNXRUNTIME_NODE_INSTALL_CUDA`） | 已验证解法：设该环境变量后 5s 装完。写入安装文档与 CI；长期盯 fastembed 升级 ort 版本的 changelog |
| R2 | 模型首跑联网下载与 P0/离线体验冲突 | [fastembed-js README](https://github.com/Anush008/fastembed-js)（cacheDir 下载机制） | 打包内置模型 + CUSTOM 本地路径装载（§4.1） |
| R3 | 相似度分布偏移：v1.5 输出集中在 [0.6,1]，绝对阈值失真 | [模型卡 FAQ §2](https://huggingface.co/BAAI/bge-small-zh-v1.5) | 相对排序为主；阈值按自有语料标定 |
| R4 | int8 量化精度损失未在本语料验证（本报告只验了可用性与速度，未跑评测集） | 天命 23MB 同款实用先例（`docs/research/reference-retrospective-20260823.md` §4.1）佐证可用性 | 工程骨架期建 50–100 条标注查询对，量化版 vs fp32 对拍 |
| R5 | fastembed-js 单主力维护者 + README 过时（模型清单漏列已支持的 bge-small-zh-v1.5） | README 与 [src/fastembed.ts](https://github.com/Anush008/fastembed-js/blob/main/src/fastembed.ts) 不一致 | 以源码为准；封装层隔离（§4 兜底逃生舱） |
| R6 | 平台二进制：onnxruntime-node 各平台原生库不同（win/linux/mac × x64/arm64），桌面端分发体积与打包复杂度上升 | [onnxruntime-node npm](https://www.npmjs.com/package/onnxruntime-node) 多平台 bin 结构 | Electron/Tauri 打包阶段按平台裁剪；此项留待工程骨架验证 |
| R7 | C-MTEB 数字为 2023 年口径，榜单已演进 | [C-MTEB](https://github.com/FlagOpen/FlagEmbedding/blob/master/C_MTEB) / [MTEB leaderboard](https://huggingface.co/spaces/mteb/leaderboard) | 候选集内部相对排序仍成立；换代模型出现时重开调研即可 |
| R8 | e5 系必须加 `query:`/`passage:` 前缀，误用静默掉分 | [multilingual-e5-small 模型卡](https://huggingface.co/intfloat/multilingual-e5-small) | 若启用 e5，前缀逻辑写进 provider 封装并加测试 |

---

## 6. 参考链接汇总

- fastembed-js 仓库（注意：旧址 qdrant/fastembed-js 已 404，现址 Anush008/fastembed-js）：<https://github.com/Anush008/fastembed-js>
- fastembed npm（版本/license/依赖）：<https://www.npmjs.com/package/fastembed>
- fastembed-js 源码模型注册表：<https://github.com/Anush008/fastembed-js/blob/main/src/fastembed.ts>
- @huggingface/transformers npm：<https://www.npmjs.com/package/@huggingface/transformers>
- onnxruntime-node npm：<https://www.npmjs.com/package/onnxruntime-node>
- onnxruntime-node CUDA 安装开关：<https://github.com/microsoft/onnxruntime/blob/v1.21.0/js/node/script/install.js>
- BAAI/bge-small-zh-v1.5 模型卡（含 C-MTEB 全表）：<https://huggingface.co/BAAI/bge-small-zh-v1.5>
- Xenova/bge-small-zh-v1.5（ONNX 量化产物）：<https://huggingface.co/Xenova/bge-small-zh-v1.5>
- intfloat/multilingual-e5-small：<https://huggingface.co/intfloat/multilingual-e5-small>；Xenova ONNX：<https://huggingface.co/Xenova/multilingual-e5-small>
- jinaai/jina-embeddings-v2-base-zh：<https://huggingface.co/jinaai/jina-embeddings-v2-base-zh>
- C-MTEB 基准：<https://github.com/FlagOpen/FlagEmbedding/blob/master/C_MTEB>；MTEB 榜单：<https://huggingface.co/spaces/mteb/leaderboard>
- 天命先例（bge-small-zh 23MB 实用佐证）：本仓 `docs/research/reference-retrospective-20260823.md` §4.1
