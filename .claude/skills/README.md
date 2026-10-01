# 技能目录说明（不是技能）

本目录下的 6 个 `gitnexus-*` 技能与 `../../.agents/skills/gitnexus-*/` **逐字节相同**（SHA-256 已核验，6/6 一致）。

**两份都保留，是有意的**，不是遗漏：

- `.agents/skills/` 是共享源。Codex / OpenCode / Pi 都扫描 `~/.agents/skills` 与项目级 `.agents/skills`。
- `.claude/skills/` 是 Claude Code 读**项目级**技能的位置。是否回落到 `.agents/skills/` **在本环境未能验证**——
  删错会静默丢失这 6 个技能，而这种丢失不会有任何报错。

## 因此

1. **不要手工编辑任何一份。** 改一处必然造成分叉，而分叉正是本仓 2026-10-01 那轮治理要消灭的东西。
2. 需要改动时，两份同步改，并用本目录下的命令核验一致性：
   ```
   Get-ChildItem .claude/skills/*/SKILL.md | ForEach-Object {
     $a = (Get-FileHash $_.FullName).Hash
     $b = (Get-FileHash (".agents/skills/" + $_.Directory.Name + "/SKILL.md")).Hash
     "{0} {1}" -f $(if ($a -eq $b) { "IDENTICAL" } else { "DIVERGED " }), $_.Directory.Name
   }
   ```
3. 要彻底去重，先在**能验证 Claude Code 技能发现路径**的环境里实测回落到 `.agents/skills/`，再删除本目录。
   未验证前不要删。

> 决策背景见 [`docs/adr/0031-single-workflow-authority.md`](../../docs/adr/0031-single-workflow-authority.md) 与
> [`docs/adr/INDEX.md`](../../docs/adr/INDEX.md) 挂账表第 2 项。
