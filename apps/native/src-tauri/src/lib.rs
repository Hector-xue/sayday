#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
