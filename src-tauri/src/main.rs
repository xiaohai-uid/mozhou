// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod server_manager;

use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Manager, RunEvent};

/// 应用全局状态（托管本地服务生命周期句柄）
pub struct AppState {
    pub server: Arc<Mutex<Option<server_manager::ServerHandle>>>,
}

fn main() {
    let server_holder: Arc<Mutex<Option<server_manager::ServerHandle>>> = Arc::new(Mutex::new(None));
    let server_holder_for_events = Arc::clone(&server_holder);
    let server_holder_for_setup = Arc::clone(&server_holder);

    tauri::Builder::default()
        .manage(AppState {
            server: Arc::clone(&server_holder),
        })
        .setup(move |app| {
            println!("MoZhou Novel OS 2.0 Desktop Engine Initialized.");

            // 1. 自动选择可用端口
            let port = match server_manager::find_available_port() {
                Ok(p) => p,
                Err(err) => {
                    eprintln!("端口分配失败: {}", err);
                    5173
                }
            };

            // 获取主窗口引用
            let window = app.get_webview_window("main");

            // 2. 启动本地 Node 核心服务
            match server_manager::start_server(port) {
                Ok(handle) => {
                    let server_url = handle.server_url.clone();
                    let data_root = handle.data_root.clone();

                    // 3. 执行健康检查轮询 (最多等待 15 秒)
                    match server_manager::wait_for_health_check(&handle, Duration::from_secs(15)) {
                        Ok(()) => {
                            println!("墨舟本地服务健康检查通过: {}", server_url);
                            if let Some(w) = window {
                                // 4. 成功时加载本地 Web 服务
                                if let Ok(parsed_url) = tauri::Url::parse(&server_url) {
                                    let _ = w.navigate(parsed_url);
                                }
                            }
                        }
                        Err(health_err) => {
                            eprintln!("健康检查失败: {}", health_err);
                            // 5. 异常时展示本地诊断（绝不白屏）
                            let logs = handle.get_logs();
                            let diag_html = server_manager::render_diagnostics_html(
                                port,
                                &health_err,
                                &logs,
                                &data_root,
                            );
                            if let Some(w) = window {
                                let js = format!(
                                    "document.open(); document.write({}); document.close();",
                                    serde_json::to_string(&diag_html).unwrap_or_default()
                                );
                                let _ = w.eval(&js);
                            }
                        }
                    }

                    // 保存句柄供退出时销毁
                    let mut guard = server_holder_for_setup.lock().unwrap();
                    *guard = Some(handle);
                }
                Err(start_err) => {
                    eprintln!("服务启动失败: {}", start_err);
                    let (data_root, _) = server_manager::prepare_data_root()
                        .unwrap_or_else(|_| (std::path::PathBuf::from("data"), String::new()));
                    let diag_html = server_manager::render_diagnostics_html(
                        port,
                        &format!("启动本地 Node 服务失败: {}", start_err),
                        &[],
                        &data_root,
                    );
                    if let Some(w) = window {
                        let js = format!(
                            "document.open(); document.write({}); document.close();",
                            serde_json::to_string(&diag_html).unwrap_or_default()
                        );
                        let _ = w.eval(&js);
                    }
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building MoZhou desktop application")
        .run(move |_app_handle, event| {
            // 6. 应用退出或关闭时，终止并销毁本地子进程生命周期
            match event {
                RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                    let mut guard = server_holder_for_events.lock().unwrap();
                    if let Some(server) = guard.take() {
                        println!("正在停止墨舟本地服务...");
                        server.shutdown();
                    }
                }
                _ => {}
            }
        });
}
