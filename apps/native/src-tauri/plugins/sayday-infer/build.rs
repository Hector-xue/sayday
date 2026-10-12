// 命令名要与 src/lib.rs 里的 #[tauri::command] 一一对应，少一个就是运行时“命令未注册”
const COMMANDS: &[&str] = &["load_model", "run", "record_start", "record_level", "record_stop", "insets", "set_bars", "speak", "speak_stop", "save_to_downloads", "update_widget"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).android_path("android").build();
}
