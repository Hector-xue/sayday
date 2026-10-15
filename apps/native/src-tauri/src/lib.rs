mod lan;

// 面对面同步（src/lan.rs）：网络收发会等，放到后台线程，别卡住界面
/// 返回 [端口, 本机地址们]
#[tauri::command]
async fn lan_host(payload: String, tag: String) -> Result<(u16, Vec<String>), String> {
    let port = tauri::async_runtime::spawn_blocking(move || lan::host(payload, tag)).await.map_err(|e| e.to_string())??;
    Ok((port, lan::local_addrs()))
}

#[tauri::command]
fn lan_poll() -> Result<Option<String>, String> {
    lan::poll()
}

#[tauri::command]
fn lan_stop() {
    lan::stop()
}

#[tauri::command]
async fn lan_send(addrs: Vec<String>, port: Option<u16>, tag: String, payload: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || lan::send(addrs, port.unwrap_or(lan::PORT), tag, payload)).await.map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![lan_host, lan_poll, lan_stop, lan_send])
        .plugin(tauri_plugin_sayday_infer::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|_app| {
            // 桌面版 Linux：打开网页的媒体流（跟读录音），麦克风权限请求直接允许（录音只在本机处理）
            #[cfg(target_os = "linux")]
            {
                use tauri::Manager;
                if let Some(w) = _app.get_webview_window("main") {
                    let _ = w.with_webview(|wv| {
                        use webkit2gtk::{PermissionRequestExt, SettingsExt, WebViewExt};
                        let v = wv.inner();
                        if let Some(s) = WebViewExt::settings(&v) {
                            s.set_enable_media_stream(true);
                            s.set_enable_webaudio(true);
                        }
                        v.connect_permission_request(|_, req| {
                            req.allow();
                            true
                        });
                    });
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动失败");
}
