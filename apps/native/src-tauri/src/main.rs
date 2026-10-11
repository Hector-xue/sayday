// 桌面端发布时不弹控制台窗口
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sayday_native_lib::run()
}
