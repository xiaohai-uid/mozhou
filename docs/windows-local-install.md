# Windows 本地安装器

## GPT-6 適配變更說明

2026-09-27：补充普通 Windows 用户的可安装交付路径。安装器把生产 Web、服务端依赖和匹配的 Node.js 运行时放进一个 per-user Inno Setup 包；用户不需要安装 Node.js、pnpm 或配置开发环境。

## 安装与数据

运行 `release-artifacts/MoZhou-0.3.0-windows-x64-setup.exe` 即可安装。默认安装目录是 `%LOCALAPPDATA%\Programs\MoZhou`，默认书稿与运行数据目录是 `%LOCALAPPDATA%\MoZhou`。卸载程序不会删除书稿数据。

安装完成后，从开始菜单或桌面快捷方式启动“墨舟”。启动器只监听本机回环地址，启动自己的服务并打开浏览器；它不依赖用户的 Node.js 或 pnpm。每个数据目录使用稳定的本地端口，浏览器工作区的最近作品状态可以跨重启恢复。

## 从源码重建

构建机需为 Windows x64，已安装项目依赖、Node.js 24.18.0（与随仓 Node 许可证和本次验证的原生依赖匹配）、pnpm 9.15.0、.NET Framework 4 编译器和 Inno Setup 6。Inno Setup 默认从 `%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe` 查找，也可通过 `ISCC_PATH` 指定。更换 Node 版本时，须同时补充对应版本许可证并重新验证原生依赖。

```powershell
pnpm package:windows
```

构建会先完成根项目和 Web 生产构建，再收集生产依赖、编译 Windows 启动器、调用本机 Inno Setup，并写出：

- `release-artifacts/MoZhou-0.3.0-windows-x64-setup.exe`
- `release-artifacts/windows-build-result.json`
- `release-artifacts/MoZhou-0.3.0-windows-x64-setup.exe.sha256`

安装器目前未签名；对外发布前仍需代码签名、下载渠道、升级和独立 Windows 机器复验。

## 已完成的本机验收

- 安装器静默安装退出码为 `0`；
- 安装后的 `MoZhou.exe` 使用包内 `runtime\node.exe` 启动服务；
- 首次建书向导完成后，书稿目录、SQLite WAL、安装密钥和运行日志写入数据目录；
- 通过启动器停止服务，再次启动后健康检查返回 `200`，原作品仍可打开；
- 固定本地端口下刷新浏览器，最近作品恢复且不重复弹出首次建书向导；
- `pnpm test`：856 项通过；Web 测试：623 项通过、1 项跳过；Web 类型检查通过；GitNexus 循环依赖检查通过。
