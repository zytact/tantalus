mod api;
mod auth;
mod usage;

use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State, WindowEvent,
};
use tokio::sync::Mutex;
use usage::{SnapshotStatus, UsageSnapshot};

#[derive(Debug)]
enum RefreshError {
    Auth(auth::AuthError),
    Api(api::ApiError),
}

impl std::fmt::Display for RefreshError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Auth(error) => error.fmt(formatter),
            Self::Api(error) => error.fmt(formatter),
        }
    }
}

struct AppState {
    snapshot: Mutex<UsageSnapshot>,
    refreshing: AtomicBool,
    client: reqwest::Client,
}

#[tauri::command]
async fn refresh_usage(state: State<'_, AppState>, app: AppHandle) -> UsageSnapshot {
    refresh(&state, &app).await
}

#[tauri::command]
async fn cached_usage(state: State<'_, AppState>) -> UsageSnapshot {
    state.snapshot.lock().await.clone()
}

async fn refresh(state: &AppState, app: &AppHandle) -> UsageSnapshot {
    if state.refreshing.swap(true, Ordering::AcqRel) {
        return state.snapshot.lock().await.clone();
    }
    let result: Result<UsageSnapshot, RefreshError> = match auth::read_credentials() {
        Ok(credentials) => api::fetch_snapshot(&state.client, &credentials)
            .await
            .map_err(RefreshError::Api),
        Err(error) => Err(RefreshError::Auth(error)),
    };
    let mut snapshot = state.snapshot.lock().await;
    match result {
        Ok(new_snapshot) => *snapshot = new_snapshot,
        Err(error) => {
            snapshot.error_message = Some(error.to_string());
            snapshot.status = if snapshot.last_successful_update_epoch.is_some() {
                SnapshotStatus::Stale
            } else if matches!(error, RefreshError::Auth(auth::AuthError::MissingFile)) {
                SnapshotStatus::AuthMissing
            } else {
                SnapshotStatus::Error
            };
        }
    }
    state.refreshing.store(false, Ordering::Release);
    update_tray_menu(app, &snapshot);
    let _ = app.emit("usage-snapshot", snapshot.clone());
    snapshot.clone()
}

fn update_tray_menu(app: &AppHandle, snapshot: &UsageSnapshot) {
    let Some(tray) = app.tray_by_id("usage") else {
        return;
    };
    let summary = match snapshot.five_hour.used_percent {
        Some(value) => format!("5h: {:.0}% used", value),
        None => "5h: unavailable".to_owned(),
    };
    let secondary = match snapshot.seven_day.used_percent {
        Some(value) => format!("7d: {:.0}% used", value),
        None => "7d: unavailable".to_owned(),
    };
    let Ok(summary_item) = MenuItem::with_id(app, "summary", summary, false, None::<&str>) else {
        return;
    };
    let Ok(secondary_item) = MenuItem::with_id(app, "secondary", secondary, false, None::<&str>)
    else {
        return;
    };
    let Ok(show) = MenuItem::with_id(app, "show", "Show usage", true, None::<&str>) else {
        return;
    };
    let Ok(refresh) = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>) else {
        return;
    };
    let Ok(quit) = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>) else {
        return;
    };
    if let Ok(menu) = Menu::with_items(
        app,
        &[&summary_item, &secondary_item, &show, &refresh, &quit],
    ) {
        let _ = tray.set_menu(menu);
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}
fn tray_icon() -> tauri::image::Image<'static> {
    let mut rgba = vec![0u8; 32 * 32 * 4];
    for y in 5..27 {
        for x in 5..27 {
            let i = (y * 32 + x) * 4;
            let edge = x == 5 || x == 26 || y == 5 || y == 26;
            rgba[i..i + 4].copy_from_slice(if edge {
                &[18, 102, 163, 255]
            } else {
                &[247, 245, 238, 255]
            });
        }
    }
    tauri::image::Image::new_owned(rgba, 32, 32)
}

pub fn run() {
    let client = api::client().expect("failed to create HTTP client");
    tauri::Builder::default()
        .manage(AppState {
            snapshot: Mutex::new(UsageSnapshot::default()),
            refreshing: AtomicBool::new(false),
            client,
        })
        .invoke_handler(tauri::generate_handler![refresh_usage, cached_usage])
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show usage", true, None::<&str>)?;
            let refresh = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &refresh, &quit])?;
            TrayIconBuilder::with_id("usage")
                .icon(tray_icon())
                .menu(&menu)
                .tooltip("Codex usage")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_window(app),
                    "refresh" => {
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let state = handle.state::<AppState>();
                            refresh(&state, &handle).await;
                        });
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { .. } = event {
                        show_window(tray.app_handle());
                    }
                })
                .build(app)?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                refresh(&state, &handle).await;
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                    refresh(&state, &handle).await;
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while running Codex Usage")
        .run(|_, _| {});
}
