# CHG-20261012-03 — 正史派生断言的显示名解析

- 日期：2026-10-12；执行：ZCode（AI 辅助）。
- 需求来源：只读调查《墨舟现有测试工具使用情况》提出的核验点——`char:wang-lin` 生成的正则可能匹配不到中文正文里的「王林」。复核成立，遂修。
- 基线：feature/windows-local-release，HEAD 8907eac01c267e96a60025f2bf0e35a98580ef9c，工作区有未提交改动。未提交、未合并、未推送。
- 范围：仅 `packages/benchmark`；未新增依赖，未接线 Promptfoo，未改任何门。

## 缺陷

`exportPromptfooTestCaseFromCanon`（`packages/benchmark/src/continuity-assertions.ts:170`）对死亡角色用 `dead.replace('char:', '')` 剥出 slug，再拼成 `wang-lin(?:推门|冷笑|说道|拔剑|站起身|抱拳)`。中文正文里角色以「王林」出现，该正则**永不触发**——是一条空转守卫。同一角色的手写黄金案例（`packages/benchmark/promptfoo/golden-scenarios.json:35`）用的正是中文名，两处口径不一致。

- 根因：正文用显示名，而显示名在实体卡里（`packages/data-plane/src/canon-read.ts:62` 的 `EntityCardScan.name` 与 `aliases`）；生成函数只拿到 `EntityRef`，够不到，也没有任何名字映射。
- 放大因素：`continuity-assertions.test.ts:178` 以 `value.includes('wang-lin')` 断言了这条错误行为，把缺陷锁进测试。
- 影响面：该函数当前无真实调用方（全仓仅单测与 `src/index.ts` 再导出引用），属潜在缺陷；一旦接线，就是静默不设防。

## 修改

- `exportPromptfooTestCaseFromCanon` 增加可选第三参 `deadCharacterNames`（EntityRef → 正文中出现的字面名数组；调用方取实体卡 `name` 与 `kind: 'exact'` 的 aliases）。
- 只在拿到名字时生成断言，并对名字做正则转义（`escapeRegex`），防止 `A.B` 这类名字被当作模式。
- 拿不到名字的角色**不生成断言**，改记入返回值的 `unresolvedDeadCharacters`，让缺口可见，而不是留一条永不触发的规则。
- 测试按 UVSD §20(c)（测试断言了无效行为，理由如上）更新：改为断言生成「王林」正则；新增两条用例覆盖「缺名字 → 不生成空转断言且记录未解析角色」与「含元字符名字按字面量匹配」。

## 验证（本轮实际执行）

- `pnpm --filter @mozhou/benchmark test`：7 文件 / 45 用例通过（该文件 5→7）。
- `pnpm test:packages`：122 文件 / 1091 用例通过（较上轮 +2，即本次新增用例）；bench 另 1 文件 / 3 用例。
- `npx tsc -b` 退出 0；`pnpm lint` 退出 0（其间修掉一处参数上的 `| undefined`，规则 `no-duplicate-type-constituents`）。
- 四道门：`doc-gates` / `graph-check`（clean, 0 环）/ `import-cycles`（605 模块 / 0 环）/ `duplication` 全部退出 0；`docs/architecture.md` 因 benchmark 行数变化重生成。
- 构建产物行为演示：不给名字 → 断言里无 `wang-lin`、`unresolvedDeadCharacters: ["char:wang-lin"]`；给名字 → 断言为 `王林(?:推门|冷笑|说道|拔剑|站起身|抱拳)`，且无未解析项。
- 图谱 `impact exportPromptfooTestCaseFromCanon` 报 CRITICAL / 91 直接调用方，与源码不符（实际仅单测与 index 再导出两处）。按既往结论，图谱对该符号过近似，影响判断以源码为准；未宣称图谱影响门通过。

## 未做（需用户决定）

- 未把实体卡的名字接进生成链路（benchmark 不依赖 data-plane，接线需先定依赖方向或由调用方注入名字映射）。
- 未接线 Promptfoo、未新增依赖、未跑真实模型评估。
