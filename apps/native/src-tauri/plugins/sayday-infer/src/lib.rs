//! 日日说原生推理插件：前端 → Rust 命令 → Kotlin（onnxruntime-android / AudioRecord）。
//!
//! Rust 这层只做转发；参数和返回值原样透传 JSON，便于前端直接用。
//! 非安卓平台一律返回 Unsupported，前端回退到 WASM。

use serde::Serialize;
use serde_json::Value;
use tauri::{
    plugin::{Builder, TauriPlugin},
    Manager, Runtime,
};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "com.ivyea.sayday.infer";

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("原生推理只在安卓上可用")]
    Unsupported,
    #[cfg(target_os = "android")]
    #[error(transparent)]
    PluginInvoke(#[from] tauri::plugin::mobile::PluginInvokeError),
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(target_os = "android")]
pub struct Infer<R: Runtime>(PluginHandle<R>);

// fn() -> R 形式的 PhantomData 无条件 Send + Sync，app.manage 才能通过
#[cfg(not(target_os = "android"))]
pub struct Infer<R: Runtime>(std::marker::PhantomData<fn() -> R>);

impl<R: Runtime> Infer<R> {
    #[cfg(target_os = "android")]
    fn call(&self, cmd: &str, args: Value) -> Result<Value> {
        Ok(self.0.run_mobile_plugin(cmd, args)?)
    }

    #[cfg(not(target_os = "android"))]
    fn call(&self, _cmd: &str, _args: Value) -> Result<Value> {
        Err(Error::Unsupported)
    }
}

#[tauri::command]
fn load_model<R: Runtime>(app: tauri::AppHandle<R>, threads: Option<u32>) -> Result<Value> {
    app.state::<Infer<R>>()
        .inner()
        .call("loadModel", serde_json::json!({ "threads": threads.unwrap_or(4) }))
}

#[tauri::command]
fn run<R: Runtime>(app: tauri::AppHandle<R>, audio: String) -> Result<Value> {
    app.state::<Infer<R>>().inner().call("infer", serde_json::json!({ "audio": audio }))
}

#[tauri::command]
fn record_start<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value> {
    app.state::<Infer<R>>().inner().call("recordStart", serde_json::json!({}))
}

/// 录音中的当前音量（0~1），界面轮询它让话筒外圈跟着声音跳
#[tauri::command]
fn record_level<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value> {
    app.state::<Infer<R>>().inner().call("recordLevel", serde_json::json!({}))
}

#[tauri::command]
fn record_stop<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value> {
    app.state::<Infer<R>>().inner().call("recordStop", serde_json::json!({}))
}

/// 系统 TTS 朗读任意英文（AI 回复、日记）；读完才返回
#[tauri::command]
async fn speak<R: Runtime>(app: tauri::AppHandle<R>, text: String, lang: Option<String>, rate: Option<f32>) -> Result<Value> {
    app.state::<Infer<R>>().inner().call(
        "speak",
        serde_json::json!({ "text": text, "lang": lang.unwrap_or_else(|| "en-GB".into()), "rate": rate.unwrap_or(0.95) }),
    )
}

#[tauri::command]
fn speak_stop<R: Runtime>(app: tauri::AppHandle<R>) -> Result<Value> {
    app.state::<Infer<R>>().inner().call("speakStop", serde_json::json!({}))
}

/// 导出备份写进系统“下载”目录（WebView 不处理网页触发的下载）
#[tauri::command]
fn save_to_downloads<R: Runtime>(app: tauri::AppHandle<R>, name: String, mime: Option<String>, data: String) -> Result<Value> {
    app.state::<Infer<R>>().inner().call(
        "saveToDownloads",
        serde_json::json!({ "name": name, "mime": mime.unwrap_or_else(|| "application/json".into()), "data": data }),
    )
}

/// 桌面小组件的内容（网页算好：连续天数、今天练没练、一个在学的词），原样交给 Kotlin
#[tauri::command]
fn update_widget<R: Runtime>(app: tauri::AppHandle<R>, widget: Value) -> Result<Value> {
    app.state::<Infer<R>>().inner().call("updateWidget", widget)
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("sayday-infer")
        .invoke_handler(tauri::generate_handler![load_model, run, record_start, record_level, record_stop, speak, speak_stop, save_to_downloads, update_widget])
        .setup(|app, _api| {
            #[cfg(target_os = "android")]
            let infer = Infer(_api.register_android_plugin(PLUGIN_IDENTIFIER, "InferPlugin")?);
            #[cfg(not(target_os = "android"))]
            let infer = Infer::<R>(std::marker::PhantomData);
            app.manage(infer);
            Ok(())
        })
        .build()
}
