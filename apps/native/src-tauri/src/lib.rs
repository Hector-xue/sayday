#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sayday_infer::init())
        .run(tauri::generate_context!())
        .expect("启动失败");
}
