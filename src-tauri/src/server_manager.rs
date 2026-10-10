use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(windows)]
use windows_sys::Win32::Foundation::HANDLE;
#[cfg(windows)]
use windows_sys::Win32::System::JobObjects::{
    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
    SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
};

/// 安全白名单相对路径，杜绝路径穿越
const ALLOWED_SERVER_CANDIDATES: &[&str] = &[
    "desktop-server.mjs",
    "app/dist-server/productionServer.js",
    "dist-server/productionServer.js",
    "apps/web/dist-server/productionServer.js",
    "resources/app/dist-server/productionServer.js",
    "resources/desktop-server.mjs",
    "scripts/release/windows/desktop-server.mjs",
];

/// 本地 Node 服务进程与生命周期托管句柄
pub struct ServerHandle {
    pub port: u16,
    pub data_root: PathBuf,
    pub server_url: String,
    child: Arc<Mutex<Option<Child>>>,
    logs: Arc<Mutex<Vec<String>>>,
    #[cfg(windows)]
    _job_handle: Option<usize>,
}

impl ServerHandle {
    /// 优雅终止本地 Node 服务（先向 stdin 写入 shutdown 命令，若未退出则发送 kill）
    pub fn shutdown(&self) {
        let mut guard = self.child.lock().unwrap();
        if let Some(mut child) = guard.take() {
            if let Some(mut stdin) = child.stdin.take() {
                let _ = stdin.write_all(b"shutdown\n");
                let _ = stdin.flush();
            }

            let wait_start = Instant::now();
            let mut exited = false;
            while wait_start.elapsed() < Duration::from_millis(500) {
                if let Ok(Some(_)) = child.try_wait() {
                    exited = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(50));
            }

            if !exited {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    /// 获取收集到的全部子进程日志
    pub fn get_logs(&self) -> Vec<String> {
        self.logs.lock().unwrap().clone()
    }
}

impl Drop for ServerHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// 自动探测并分配空闲本地端口
pub fn find_available_port() -> Result<u16, String> {
    if is_port_available(5173) {
        return Ok(5173);
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|e| format!("无法绑定本地临时端口: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("无法获取本地端口地址: {}", e))?
        .port();
    drop(listener);
    Ok(port)
}

/// 检查指定端口是否处于可用未监听状态
pub fn is_port_available(port: u16) -> bool {
    match TcpListener::bind(("127.0.0.1", port)) {
        Ok(listener) => {
            drop(listener);
            true
        }
        Err(_) => false,
    }
}

/// 在白名单候选集合中安全定位服务入口文件
pub fn locate_server_entry() -> Result<PathBuf, String> {
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            for &candidate in ALLOWED_SERVER_CANDIDATES {
                let target = exe_dir.join(candidate);
                if target.is_file() {
                    if let Ok(canon) = target.canonicalize() {
                        return Ok(canon);
                    }
                }
            }
        }
    }

    for &candidate in ALLOWED_SERVER_CANDIDATES {
        let p = Path::new(candidate);
        if p.is_file() {
            if let Ok(canon) = p.canonicalize() {
                return Ok(canon);
            }
        }
    }

    Err(format!(
        "未能定位到墨舟 Node 服务入口文件。已检查白名单候选相对路径: {:?}",
        ALLOWED_SERVER_CANDIDATES
    ))
}

/// 准备本地数据根目录与安装密钥
pub fn prepare_data_root() -> Result<(PathBuf, String), String> {
    let base_dir = std::env::current_dir()
        .map_err(|e| format!("获取当前工作目录失败: {}", e))?;
    // 目录名必须与 apps/web/server/dataRoot.ts 的 DEFAULT_DATA_ROOT_DIRNAME 一致
    // （".mozhou_data"，下划线）。此前这里是 ".mozhou-data"（连字符）：桌面端与 CLI
    // 启动器会落到两个数据根、各自铸造一把 installation.key，同一份
    // provider-settings.enc 跨入口读不出凭据。
    // 已知限制：本入口不读 MOZHOU_DATA_ROOT——安全扫描禁止「从环境变量取路径再做文件
    // 操作」，两种写法均被其预写钩子拒绝（见 docs/changes/CHG-20261010-04-round3-ssrf-unification.md
    // 与 CHG-20261010-03-round2-findings-and-residuals.md）。因此数据根取自 cwd：一旦工作
    // 目录变化（不同启动方式、快捷方式起始目录、调试 cwd），本入口就会造出第二个数据根与
    // 第二把 installation.key，同一份 provider-settings.enc 跨入口读不出凭据。自定义数据根请用
    // scripts/launcher.mjs 或安装器的 MoZhou.exe，二者都会把 MOZHOU_DATA_ROOT 传给服务进程。
    // 注：本 Tauri 入口不在当前 Windows 发行产物内（发行包只含 apps/web 的 dist/dist-server
    // 与 desktop-server.mjs），故该限制不影响已发布产品，仅为开发/调试期风险。
    let data_root = base_dir.join(".mozhou_data");

    fs::create_dir_all(&data_root)
        .map_err(|e| format!("创建数据目录 '{}' 失败: {}", data_root.display(), e))?;

    let key_file = data_root.join("installation.key");
    let secret_key = if key_file.is_file() {
        let content = fs::read_to_string(&key_file)
            .map_err(|e| format!("读取安装密钥文件 '{}' 失败: {}", key_file.display(), e))?;
        content.trim().to_string()
    } else {
        let key = generate_hex_key_96();
        fs::write(&key_file, &key)
            .map_err(|e| format!("保存安装密钥至 '{}' 失败: {}", key_file.display(), e))?;
        key
    };

    if secret_key.len() != 96 || !secret_key.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(format!(
            "installation.key 格式异常 (长度为 {}，期望 96 位十六进制)。请从备份恢复，勿手动修改。",
            secret_key.len()
        ));
    }

    Ok((data_root, secret_key))
}

/// 生成 48 字节 (96 个字符) 十六进制密钥（CSPRNG）
fn generate_hex_key_96() -> String {
    let mut bytes = [0u8; 48];
    // 不用墙钟种子/LCG 自造随机：那让密钥空间小到可被离线枚举（对照
    // scripts/release/windows/desktop-server.mjs 用 randomBytes(48)）。
    getrandom::fill(&mut bytes).expect("系统随机源不可用：拒绝以弱随机生成安装密钥");
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// 启动并托管本地 Node 核心服务
pub fn start_server(port: u16) -> Result<ServerHandle, String> {
    let server_entry = locate_server_entry()?;
    let (data_root, secret_key) = prepare_data_root()?;

    let working_dir = server_entry
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .unwrap_or_else(|| Path::new("."));

    // 显式使用常量静态程序名，杜绝外部输入动态路径造成命令注入
    #[cfg(windows)]
    let mut cmd = Command::new("node.exe");
    #[cfg(not(windows))]
    let mut cmd = Command::new("node");

    cmd.arg(&server_entry)
        .current_dir(working_dir)
        .env("PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("MOZHOU_HOSTED", "false")
        .env("MOZHOU_DATA_ROOT", &data_root)
        .env("MOZHOU_SECRET_KEY", &secret_key)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("启动 Node 服务进程失败: {}", e))?;

    #[cfg(windows)]
    let job_handle = attach_to_job_object(&child);

    let logs = Arc::new(Mutex::new(Vec::new()));

    if let Some(stdout) = child.stdout.take() {
        let logs_clone = Arc::clone(&logs);
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                let mut guard = logs_clone.lock().unwrap();
                if guard.len() > 300 {
                    guard.remove(0);
                }
                guard.push(format!("[stdout] {}", line));
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let logs_clone = Arc::clone(&logs);
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                let mut guard = logs_clone.lock().unwrap();
                if guard.len() > 300 {
                    guard.remove(0);
                }
                guard.push(format!("[stderr] {}", line));
            }
        });
    }

    let child_arc = Arc::new(Mutex::new(Some(child)));

    Ok(ServerHandle {
        port,
        data_root,
        server_url: format!("http://127.0.0.1:{}", port),
        child: child_arc,
        logs,
        #[cfg(windows)]
        _job_handle: job_handle,
    })
}

#[cfg(windows)]
fn attach_to_job_object(child: &Child) -> Option<usize> {
    unsafe {
        let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
        if job.is_null() {
            return None;
        }

        let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

        let ret = SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            &info as *const _ as *const std::ffi::c_void,
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );

        if ret == 0 {
            windows_sys::Win32::Foundation::CloseHandle(job);
            return None;
        }

        let child_handle = child.as_raw_handle() as HANDLE;
        if AssignProcessToJobObject(job, child_handle) != 0 {
            Some(job as usize)
        } else {
            windows_sys::Win32::Foundation::CloseHandle(job);
            None
        }
    }
}

/// 执行健康检查探测，直到服务返回 200 OK 或超时/崩溃
pub fn wait_for_health_check(
    handle: &ServerHandle,
    timeout_duration: Duration,
) -> Result<(), String> {
    let start = Instant::now();
    let poll_interval = Duration::from_millis(150);

    while start.elapsed() < timeout_duration {
        {
            let mut guard = handle.child.lock().unwrap();
            if let Some(child) = guard.as_mut() {
                if let Ok(Some(status)) = child.try_wait() {
                    let logs = handle.get_logs();
                    let err_log = logs.iter().rev().take(5).cloned().collect::<Vec<_>>().join("\n");
                    return Err(format!(
                        "本地 Node 服务在启动过程中异常退出 (退出代码: {:?})。\n日志摘要:\n{}",
                        status.code(),
                        err_log
                    ));
                }
            }
        }

        if probe_http_health(handle.port) {
            return Ok(());
        }

        std::thread::sleep(poll_interval);
    }

    let logs = handle.get_logs();
    let log_summary = logs.iter().rev().take(10).cloned().collect::<Vec<_>>().join("\n");
    Err(format!(
        "健康检查超时（已探测 {} 秒）：未能接收到 http://127.0.0.1:{}/api/health 成功响应。\n末尾日志:\n{}",
        timeout_duration.as_secs(),
        handle.port,
        log_summary
    ))
}

/// 单次 HTTP GET 探测
fn probe_http_health(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    if let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(400)) {
        let _ = stream.set_read_timeout(Some(Duration::from_millis(400)));
        let _ = stream.set_write_timeout(Some(Duration::from_millis(400)));

        let req = format!(
            "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
            port
        );
        if stream.write_all(req.as_bytes()).is_ok() {
            let mut buf = [0u8; 1024];
            if let Ok(n) = stream.read(&mut buf) {
                let resp = String::from_utf8_lossy(&buf[..n]);
                if resp.contains("200 OK") && resp.contains("\"ok\":true") {
                    return true;
                }
            }
        }
    }
    false
}

/// 渲染本地诊断 HTML（绝不白屏，深色墨韵风格）
pub fn render_diagnostics_html(
    port: u16,
    error_message: &str,
    logs: &[String],
    data_root: &Path,
) -> String {
    let log_content = if logs.is_empty() {
        "(暂无子进程标准输出或错误日志)".to_string()
    } else {
        logs.join("\n")
    };

    let esc_err = escape_html(error_message);
    let esc_logs = escape_html(&log_content);
    let esc_root = escape_html(&data_root.to_string_lossy());

    format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>墨舟 · 本地创作引擎诊断</title>
  <style>
    :root {{
      --bg: #0b0f19;
      --card-bg: #151d30;
      --border: #24304f;
      --text: #f1f5f9;
      --muted: #94a3b8;
      --accent: #38bdf8;
      --danger: #f43f5e;
      --danger-bg: rgba(244, 63, 94, 0.12);
      --font-mono: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace;
    }}
    body {{
      margin: 0;
      padding: 40px 20px;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      min-height: 100vh;
      box-sizing: border-box;
    }}
    .panel {{
      max-width: 820px;
      width: 100%;
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 32px;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.6);
    }}
    .header {{
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }}
    .badge {{
      background: var(--danger-bg);
      color: var(--danger);
      border: 1px solid var(--danger);
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: bold;
      letter-spacing: 0.5px;
    }}
    h1 {{
      font-size: 20px;
      margin: 0;
      font-weight: 600;
    }}
    .error-box {{
      background: rgba(11, 15, 25, 0.8);
      border-left: 4px solid var(--danger);
      padding: 16px;
      border-radius: 0 8px 8px 0;
      margin-bottom: 24px;
      font-size: 14px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 14px;
      margin-bottom: 24px;
    }}
    .card {{
      background: rgba(11, 15, 25, 0.5);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
    }}
    .card-title {{
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 6px;
    }}
    .card-val {{
      font-size: 14px;
      font-family: var(--font-mono);
      color: var(--accent);
      word-break: break-all;
    }}
    .label {{
      font-size: 14px;
      font-weight: 600;
      margin: 20px 0 10px;
    }}
    .console {{
      background: #060911;
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      font-family: var(--font-mono);
      font-size: 12px;
      line-height: 1.5;
      color: #e2e8f0;
      max-height: 240px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }}
    .tips {{
      margin: 16px 0 24px;
      padding-left: 20px;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.8;
    }}
    .actions {{
      display: flex;
      gap: 12px;
      margin-top: 24px;
    }}
    button {{
      background: var(--accent);
      color: #0b0f19;
      border: none;
      padding: 10px 22px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: bold;
      cursor: pointer;
      transition: opacity 0.2s;
    }}
    button:hover {{
      opacity: 0.9;
    }}
    button.secondary {{
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
    }}
    button.secondary:hover {{
      background: rgba(255, 255, 255, 0.05);
    }}
  </style>
</head>
<body>
  <div class="panel">
    <div class="header">
      <div class="badge">引擎启动异常</div>
      <h1>墨舟 · 本地创作引擎诊断</h1>
    </div>

    <div class="error-box"><strong>错误摘要:</strong><br>{esc_err}</div>

    <div class="grid">
      <div class="card">
        <div class="card-title">分配端口 (PORT)</div>
        <div class="card-val">{port}</div>
      </div>
      <div class="card">
        <div class="card-title">数据目录 (DATA_ROOT)</div>
        <div class="card-val">{esc_root}</div>
      </div>
    </div>

    <div class="label">控制台日志流 (stdout / stderr)</div>
    <div class="console" id="logStream">{esc_logs}</div>

    <div class="label">排查指引</div>
    <ol class="tips">
      <li>检查本地构建产物是否完整（运行 <code>pnpm --filter @mozhou/web build</code>）。</li>
      <li>检查本地安全软件是否阻断了本地回环地址（127.0.0.1:{port}）的监听与网络通信。</li>
      <li>验证数据根目录是否拥有可写权限，或检查是否有其他墨舟实例独占了同一目录。</li>
    </ol>

    <div class="actions">
      <button onclick="window.location.reload()">重新启动服务</button>
      <button class="secondary" onclick="navigator.clipboard.writeText(document.getElementById('logStream').innerText); alert('日志已复制到剪贴板')">复制完整日志</button>
    </div>
  </div>
</body>
</html>"#
    )
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_find_available_port() {
        let port = find_available_port().expect("应当成功获得可用端口");
        assert!(port > 0, "端口应当大于0");
        let listener = TcpListener::bind(("127.0.0.1", port));
        assert!(listener.is_ok(), "所获端口应可绑定");
    }

    #[test]
    fn test_is_port_available() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(!is_port_available(port), "已绑定的端口应判定为不可用");
        drop(listener);
        assert!(is_port_available(port), "释放后的端口应判定为可用");
    }

    #[test]
    fn test_generate_hex_key_format() {
        let key = generate_hex_key_96();
        assert_eq!(key.len(), 96, "安装密钥长度必须为 96 字符");
        assert!(key.chars().all(|c| c.is_ascii_hexdigit()), "安装密钥必须全为十六进制字符");
    }

    #[test]
    fn test_html_escaping() {
        let raw = "<script>alert('xss') & \"evil\"</script>";
        let escaped = escape_html(raw);
        assert!(!escaped.contains('<'));
        assert!(!escaped.contains('>'));
        assert!(escaped.contains("&lt;script&gt;"));
        assert!(escaped.contains("&amp;"));
        assert!(escaped.contains("&quot;"));
    }

    #[test]
    fn test_diagnostics_html_rendering() {
        let logs = vec![
            "[stdout] Server initializing...".to_string(),
            "[stderr] Error: database locked".to_string(),
        ];
        let html = render_diagnostics_html(
            5173,
            "健康检查探测超时",
            &logs,
            Path::new("C:/Data/MoZhou"),
        );

        assert!(html.contains("墨舟 · 本地创作引擎诊断"));
        assert!(html.contains("5173"));
        assert!(html.contains("健康检查探测超时"));
        assert!(html.contains("Error: database locked"));
        assert!(html.contains("MoZhou"));
        assert!(html.contains("<!DOCTYPE html>"));
    }

    #[test]
    fn test_probe_health_mock() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 512];
                let _ = stream.read(&mut buf);
                let response = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{\"ok\":true,\"status\":\"ok\"}";
                let _ = stream.write_all(response.as_bytes());
            }
        });

        assert!(probe_http_health(port), "模拟健康检查应成功返回 true");
    }

    #[test]
    fn test_probe_health_mock_failure() {
        // 未开放端口或返回 500 时应返回 false
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();

        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 512];
                let _ = stream.read(&mut buf);
                let response = "HTTP/1.1 503 Service Unavailable\r\nContent-Type: application/json\r\n\r\n{\"ok\":false}";
                let _ = stream.write_all(response.as_bytes());
            }
        });

        assert!(!probe_http_health(port), "返回非200时应判定健康检查未通过");
    }
}
