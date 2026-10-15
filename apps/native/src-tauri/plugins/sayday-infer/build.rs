// 命令名要与 src/lib.rs 里的 #[tauri::command] 一一对应，少一个就是运行时“命令未注册”
const COMMANDS: &[&str] = &["load_model", "run", "record_start", "record_level", "record_stop", "insets", "set_bars", "speak", "speak_stop", "save_to_downloads", "update_widget", "update_start", "update_status", "update_install", "save_image", "open_url", "system_status", "pin_widget", "open_notify_settings", "quiz_set", "quiz_drain", "quiz_test", "take_action", "lan_addrs"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
