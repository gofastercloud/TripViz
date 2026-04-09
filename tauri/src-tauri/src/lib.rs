mod sidecar;

use std::sync::Arc;
use std::time::Duration;

use tauri::{Manager, RunEvent, WindowEvent};

use sidecar::{
    find_free_port, http_health_check, resolve_data_dir, resolve_sidecar_binary, wait_for_health,
    SidecarHandle, DEFAULT_HOST, DEFAULT_PORT, HEALTH_TIMEOUT, MAX_PORT,
};

struct BackendState {
    handle: Arc<SidecarHandle>,
}

#[tauri::command]
fn get_backend_url(state: tauri::State<'_, BackendState>) -> String {
    format!("http://{}:{}", DEFAULT_HOST, state.handle.port)
}

#[tauri::command]
fn get_backend_port(state: tauri::State<'_, BackendState>) -> u16 {
    state.handle.port
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![get_backend_url, get_backend_port])
        .setup(|app| {
            let data_dir = resolve_data_dir();
            std::fs::create_dir_all(&data_dir).ok();
            let log_file = data_dir.join("tauri-sidecar.log");

            // In dev the CARGO_MANIFEST_DIR points at src-tauri; in a bundled
            // build it won't exist but resolve_sidecar_binary will fall through
            // to current_exe() lookup.
            let src_tauri_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));

            let binary = resolve_sidecar_binary(&src_tauri_dir, "tripviz-backend")
                .ok_or("tripviz-backend binary not found (dev stub expected at src-tauri/binaries/tripviz-backend)")?;
            log::info!("resolved backend binary: {:?}", binary);

            let port = find_free_port(DEFAULT_PORT, MAX_PORT)
                .ok_or("no free port in 8000-8010 range")?;
            log::info!("selected backend port: {}", port);

            let handle =
                SidecarHandle::spawn(&binary, &data_dir, DEFAULT_HOST, port, &log_file)
                    .map_err(|e| format!("spawn failed: {}", e))?;

            log::info!("waiting for backend health on :{}", port);
            let ok = wait_for_health(
                || http_health_check(DEFAULT_HOST, port),
                HEALTH_TIMEOUT,
            );
            if let Err(e) = ok {
                log::error!("backend health check failed: {}", e);
                handle.shutdown();
                return Err(format!("backend failed to become ready: {}", e).into());
            }
            log::info!("backend is healthy");

            let handle = Arc::new(handle);
            app.manage(BackendState {
                handle: handle.clone(),
            });

            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        match event {
            RunEvent::WindowEvent {
                event: WindowEvent::CloseRequested { .. },
                ..
            } => {
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    log::info!("window close requested — shutting down sidecar");
                    state.handle.shutdown();
                }
            }
            RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    log::info!("exit — shutting down sidecar");
                    state.handle.shutdown();
                }
                // Give child a brief moment to flush logs.
                std::thread::sleep(Duration::from_millis(100));
            }
            _ => {}
        }
    });
}
