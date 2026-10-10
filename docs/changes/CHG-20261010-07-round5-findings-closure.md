# CHG-20261010-07 第五轮复核发现收口（zip 炸弹 / 备份完整性门与归属隔离 / 发布链校验与来源戳）

> 触发：第五轮独立对抗复核（verdict `release`，无数据丢失级或安全绕过级阻断）报出的 2 项中等 + 3 项低问题。基线 HEAD `f29ad48` → `f4a061e`。

## 1. 本批修完的项（4 个提交）

| 提交 | 内容 |
|---|---|
| `7b5a7c4` | **zip 解压炸弹**封堵；备份**下载/恢复补完整性门**；hosted 备份**按归属隔离** |
| `b6f0c28` | `release.yml` 补「校验发布来源与版本」；`build-release.mjs` 补来源戳 |
| `0a47c74` | 文风画像整份重写改原子写（该函数当前无生产调用） |
| `f4a061e` | 刷新 `docs/architecture.md`（data-plane 59→60 文件） |

## 2. 逐项：问题 → 修法

### 2.1 （中）zip 解压炸弹 —— `packages/data-plane/src/zip-util.ts`
**问题**：`inflateRawSync(rawData)` 无输出上限，而中央目录里的 `uncompSize` 是**攻击者可控的声明值**；经 `/api/backups/restore` 的 `archiveBase64`（1 MiB 请求体上限）可撑出远超其体积的内存。

**修法**：
- `inflateRawSync(rawData, { maxOutputLength: limits.maxSingleFileBytes })` —— 上限由 zlib **在解压过程中**强制，与声明值是否诚实无关；超限（`ERR_BUFFER_TOO_LARGE`）转既有 `C5_LIMIT_EXCEEDED`。
- 新增 `actualTotalBytes`，按**真实解压字节**再核 `maxTotalBytes`（声明值撒谎不再能绕过）。
- 抽出 `findEocdOffset`，新增 `assertZipStructureIntact`（只读头部、不解压）：EOCD 缺失、中央目录或条目数据越界、局部头签名不符即拒。

**残余（如实）**：`maxTotalBytes = 1 GiB` 与 `maxSingleFileBytes = 100 MiB` 都是既有 `C5_ZIP_LIMITS` 配置值。因此 1 MiB 请求体仍可把峰值推到约 1 GiB（10 条 × 100 MiB）。本次封顶的是「单条无限膨胀」，**未改总量设计值**——是否收紧属产品决定。

### 2.2 （中）下载/恢复分支只有 `existsSync` —— `apps/web/server/routes/backupRoutes.ts`
**问题**：上一批只防「新写坏」；历史上已存在的半份/截断 zip 仍会以 200 原样发出。

**修法**：下载（:96-104）与恢复（:134-145）都先过 `assertZipStructureIntact`，损坏返回 409 `BACKUP_CORRUPT`。

**残余**：结构门只识别**字节不完整**，不查**内容被篡改**——下载路径没有落盘哈希可比（POST 返回的 sha256 只回客户端、未持久化）；恢复路径仍由 `unpackZip` + manifest 哈希兜住。

### 2.3 （低）备份跨主体可读/可恢复 —— `backupRoutes.ts:23-34`
**问题**：`backupsDir` 是全局目录，download/restore 只要求 account 身份、不绑 userId，96 bit 随机 ID 成了跨主体能力凭据。

**修法**：hosted 模式落 `users/<userId>/backups`（沿用仓内既有 `users/<id>/<子目录>` 约定，与 `bookAccess.ts` 的 `users/<id>/books` 一致）；local 单机模式维持全局 `dataRoot/backups`，行为不变。

**残余（兼容代价）**：改动前写在全局目录的 hosted 存量归档不再对该主体可见（fail-closed，避免跨主体读取）。

### 2.4 （中）发布链的两条声称无校验 —— `.github/workflows/release.yml`
**问题**：输入说明声称 `sourceCommit` 必须在 main/release、`releaseVersion` 必须匹配 `package.json`，但全文只有使用、**没有校验步骤**——可以从任意提交、用任意版本号发正式 Release。

**修法**：新增步骤「校验发布来源与版本」（放在构建之前，失败即停）：显式 fetch `origin/main` 与 `origin/release` 的分支引用（release 惰性创建，缺失即少一个基准、不报错）；`git cat-file -e` 确认提交存在；对两个基准各做 `git merge-base --is-ancestor`，是其一祖先即通过；版本规则为「去掉一个可选前导 `v` 后与 `package.json` 的 `version` 逐字相等」。

### 2.5 （中）交付物无来源戳 —— `scripts/build-release.mjs`
**修法**：复用既有 `scripts/release/lib/source-stamp.mjs`（`readSourceStamp`），把 `BUILD-STAMP.json` 写进 bundle 目录，字段与 `scripts/release/windows/build.mjs` 一致（`sourceCommit` / `sourceCommitSha` / `dirty` / `dirtyFiles`），随 local-runtime 与 docker 两个归档分发；脏工作区另打印告警。

**归因更正**：那条「`build-release.mjs` 无来源戳」的已知缺口登记，**只存在于并行会话未提交的 `verify-gates-contract.mjs` 里**（HEAD 版没有该检查）。本批只提交 `release.yml` 与 `build-release.mjs` 两个干净文件；`docs/gates.md` 与 `verify-gates-contract.mjs` 里的相应文字改动留在工作区，归对方一并提交。

## 3. 主会话的证伪（本批最有价值的一步）

子代理为 zip 炸弹写了 5 例测试，其中「谎报 `uncompSize` 为 0」那条看起来很到位。**我把 `maxOutputLength` 临时撤掉后，5 例全部仍然通过** —— 说明这组测试当时**没有咬住真正的修复点**：那条用例给的 `maxTotalBytes` 只有 1024，按真实字节的总量检查替它兜住了，而「分配本身有界」这一层无人把守。

处置：把该用例的上限改成「总量 1 GiB、单文件 64 KiB」，使它只可能被单文件输出上限兜住。复验：
- 撤 `maxOutputLength` → **该例变红、其余 4 例仍绿**（证明「分配本身有界」与「按真实字节核总量」各由独立用例把守）；
- 还原后 5 例全绿。

该过程与结论已写入 `7b5a7c4` 的提交信息。

## 4. 实跑证据（主会话）

| 检查 | 结果 |
|---|---|
| `pnpm test` | exit 0：包层并行段 119 文件 / **1064 例** + 独占台架段 1 文件 / 3 例 + web 段 156 文件 / **1277 例** |
| `pnpm build` / `pnpm --filter @mozhou/web typecheck` / `pnpm lint` | 全部 exit 0 |
| `pnpm --filter @mozhou/data-plane build` | exit 0（web 测试走 dist，需先构建才含新导出） |
| `node scripts/check-import-cycles.mjs` | `PASS 595 模块 / 1696 边 / 0 依赖环` |
| `pnpm graph:check` | `cycleCount: 0` |
| `pnpm duplication`（阈值 17%） | 总重复 15.83%，exit 0 |
| 干净 HEAD（`f4a061e`）副本上的五个文档门 | architecture / term-map **FRESH**，glossary / gates / readmes **0** |
| 直测 `maxOutputLength` 语义（Node 24） | 8 MiB 全 'a' 压缩到 8158 字节；上限 1 MiB 时抛 `ERR_BUFFER_TOO_LARGE: Cannot create a Buffer larger than 1048576 bytes`；上限足够时解压 8388608 字节 |
| `node scripts/build-release.mjs` | exit 0，戳 `{"version":"0.3.0","sourceCommit":"…-dirty","sourceCommitSha":"…","dirty":true,"dirtyFiles":131}`；`tar -tzf` 确认戳进了 local-runtime 与 docker 两个归档 |

## 5. 仍未修 / 未验证（如实）

- zip 总量上限 1 GiB 为既有设计值（见 §2.1 残余）。
- 备份结构门不查内容篡改（见 §2.2 残余）。
- hosted 存量全局备份不可见（见 §2.3 残余）。
- `receipt-file.ts` / `report-store.ts` 的 `existsSync` 预检仍是 TOCTOU（提交内已自认）。
- **发布链校验未在 GitHub Actions 上实跑**：依赖 runner 上对真实 `origin` 的 fetch。
- 未做真实并发 OOM 压测；未构造真实 kill 崩溃。
- 沿用：`#99` 真模型路径（本机无任何 API key）、未推送（未跑 act 本地 CI 门）、安装器未签名、Mimosa 完整扫描（`scanner_enobufs`，按 ADR-0036 保持 advisory）、4 个 moderate 依赖漏洞未修。

## 6. 并发说明（精确暂存）

`packages/data-plane/src/zip-util.ts` 混有并行会话的 1 行术语改动（`严格安全守卫`→`严格安全检查`）：暂存时把该行措辞还原成 HEAD 写法后入索引，`git diff --cached` 中他人术语行数 **0**。`backupRoutes.ts` 及其测试、`zip-util.test.ts` 原本干净。`release.yml` 与 `build-release.mjs` 原本干净。生成物刷新用 `git archive HEAD` 的干净副本作为测量环境。

## 7. 回滚

按提交逐个 `git revert`。回滚 `7b5a7c4` 后 hosted 备份目录回到全局 `dataRoot/backups`（存量归档重新可见）；回滚 `b6f0c28` 后发布链恢复为「声称无校验」状态。
