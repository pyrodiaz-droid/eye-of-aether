use std::fs;

// File path passed on the command line (e.g. by the file manager on double-click).
// Read here in Rust, not via the fs plugin: argv paths are not in the plugin's
// scope (only dialog/drag-drop paths are), and the fs scope exists to gate the
// webview, not the user's own launcher actions.
struct InitialFile(Option<String>);

#[derive(serde::Serialize)]
struct InitialOpen {
    path: String,
    contents: String,
}

#[tauri::command]
fn open_initial_file(initial: tauri::State<InitialFile>) -> Result<Option<InitialOpen>, String> {
    match &initial.0 {
        None => Ok(None),
        Some(path) => fs::read_to_string(path)
            .map(|contents| Some(InitialOpen { path: path.clone(), contents }))
            .map_err(|err| format!("Could not read {path}: {err}")),
    }
}

// Least-privilege save path for argv-opened files: only the exact path that was
// given on the command line, never an arbitrary write
#[tauri::command]
fn write_back(initial: tauri::State<InitialFile>, path: String, contents: String) -> Result<(), String> {
    match &initial.0 {
        Some(argv_path) if *argv_path == path => {
            fs::write(path, contents).map_err(|err| format!("Could not write {argv_path}: {err}"))
        }
        _ => Err("path was not opened from the command line".into()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let file = std::env::args().nth(1).filter(|arg| !arg.starts_with('-'));
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(InitialFile(file))
        .invoke_handler(tauri::generate_handler![open_initial_file, write_back])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
