# 长程证据作废记录（2026-10-17）

## 结论

两份历史长程摘要曾被读成通过，但缺少卷压缩验证。它们已作废，不得作为
「31 章连续生产已验证」的证据。

| 运行目录 | 原 status | compactionVerified | 处置 |
|---|---|---|---|
| `evidence/longform-journey/2026-10-06T13-41-19-856Z/` | `PASS` | `false` | `summary.invalidated.json` |
| `evidence/longform-journey/2026-10-06T13-46-12-725Z/` | `PASS` | `false` | `summary.invalidated.json` |

同一目录下 `2026-10-06T13-48-19-681Z/` 的 `compactionVerified=true`，保留为通过证据；
`2026-10-12T08-34-06-692Z/` 为 `BLOCKED (REAL_MODEL_UNREACHABLE)`，未验证。

## 原因

审查脚本早期把 `restartOk`、`compactionVerified`、`genrePresetVerified` 只记成布尔字段，
没有全部进入通过条件，于是 `status` 可以写死为 `PASS`。当前脚本已改为派生判定；
`scripts/check-evidence-hygiene.mjs` 也会扫描 `summary.json`，对
`status=PASS` 且任一必需结果为 false 的摘要直接失败。

## 新门

`.github/workflows/longform-nightly.yml` 每日或手动运行 31 章长程验收，
上传证据并执行证据卫生检查。该门需要 `MOZHOU_API_KEY`、`MOZHOU_API_BASE`、
`MOZHOU_MODEL` 三个仓库 secret；缺任一项即显式失败，不以跳过冒充通过。

## 边界

- 本记录只说明证据作废与门的位置，不证明当前代码已通过 31 章长程验收。
- 真实长程复跑需要凭据与上游费用，本轮未执行。
