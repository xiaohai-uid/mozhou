// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .setup(|_app| {
            println!("MoZhou Novel OS 2.0 Desktop Engine Initialized.");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running MoZhou desktop application");
}
