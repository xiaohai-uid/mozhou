# 墨舟 (MoZhou Novel OS) 公网预发布与生产部署指南 (T16)

依照 `reference/03-public-billing.md` T16 规范编写。

## 1. 目标环境要求
- **首选主机**：Oracle Cloud Always Free VM (Ubuntu 22.04 / 24.04 LTS 或 Debian 12，x86_64 或 ARM aarch64)。
- **Node.js**：v22.x LTS 或 v24.x，需安装基础依赖与 sqlite3 支持。
- **反向代理**：Caddy v2（内置自动 HTTPS 与反代缓冲禁用）。
- **运行用户**：独立非 root 用户 `mozhou:mozhou`。

## 2. 部署步骤
1. **创建独立专用用户与目录**：
   ```bash
   sudo useradd -r -s /bin/false -d /opt/mozhou mozhou
   sudo mkdir -p /opt/mozhou /var/mozhou_data /etc/mozhou
   sudo chown -R mozhou:mozhou /opt/mozhou /var/mozhou_data /etc/mozhou
   ```

2. **解压发布运行时资产 (来自 release-artifacts)**：
   ```bash
   tar -xzf mozhou-v0.1.0.tar.gz -C /opt/mozhou
   sudo chown -R mozhou:mozhou /opt/mozhou
   ```

3. **配置受限环境变量文件 `/etc/mozhou/mozhou.env` (权限 0600)**：
   ```ini
   NODE_ENV=production
   PORT=5173
   HOST=127.0.0.1
   MOZHOU_HOSTED=true
   MOZHOU_DATA_ROOT=/var/mozhou_data
   SUPABASE_URL=https://<project-id>.supabase.co
   SUPABASE_ANON_KEY=<anon-key>
   ```

4. **安装 Systemd 服务并启动**：
   ```bash
   sudo cp deploy/mozhou.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now mozhou
   ```

5. **配置与启动 Caddy 反向代理**：
   ```bash
   sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
   sudo systemctl restart caddy
   ```

## 3. 灾备与恢复
- **持久卷备份**：数据目录 `/var/mozhou_data` 按日快照备份至外部独立故障域（如 S3/R2/异地持久卷）。
- **灾难恢复**：恢复文件至 `/var/mozhou_data` 后，由服务实例启动时自动获取排他锁并利用 SQLite WAL 恢复；不承诺零停机 SLA。
