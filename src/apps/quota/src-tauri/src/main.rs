#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{sync::Mutex, time::Duration};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    Manager,
};

struct Reader(Mutex<reqwest::blocking::Client>);

#[tauri::command]
async fn quota_snapshot(
    refresh: bool,
    reader: tauri::State<'_, Reader>,
) -> Result<serde_json::Value, String> {
    let client = reader.0.lock().map_err(|_| "connection_failed")?.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // Fixed local endpoint. The desktop never stores server/account secrets
        // and cannot turn this command into a general HTTP or remote-action proxy.
        let request = if refresh {
            client.post("http://127.0.0.1:17843/api/refresh")
        } else {
            client.get("http://127.0.0.1:17843/api/snapshot")
        };
        let response = request
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|_| "connection_failed")?;
        response
            .json::<serde_json::Value>()
            .map_err(|_| "invalid_response")
    })
    .await
    .map_err(|_| "connection_failed")?
}

fn main() {
    tauri::Builder::default()
        .manage(Reader(Mutex::new(
            reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(40))
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .expect("local HTTP client"),
        )))
        .invoke_handler(tauri::generate_handler![quota_snapshot])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "显示额度面板", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::new()
                .tooltip("Agent HUD · 额度")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if matches!(event, TrayIconEvent::DoubleClick { .. }) {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("quota desktop failed");
}
