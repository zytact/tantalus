mod api;
mod auth;
mod usage;

use auth::Provider;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, State,
};
use tokio::sync::Mutex;
use usage::{ProviderUsage, SnapshotStatus, UsageSnapshot};

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
async fn refresh_usage(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<UsageSnapshot, String> {
    Ok(refresh(&state, &app).await)
}

#[tauri::command]
async fn cached_usage(state: State<'_, AppState>) -> Result<UsageSnapshot, String> {
    Ok(state.snapshot.lock().await.clone())
}

async fn refresh(state: &AppState, app: &AppHandle) -> UsageSnapshot {
    if state.refreshing.swap(true, Ordering::AcqRel) {
        return state.snapshot.lock().await.clone();
    }
    let (codex, claude) = tokio::join!(
        read_provider(state, Provider::Codex),
        read_provider(state, Provider::Claude)
    );
    let mut snapshot = state.snapshot.lock().await;
    apply(&mut snapshot.codex, codex);
    apply(&mut snapshot.claude, claude);
    state.refreshing.store(false, Ordering::Release);
    update_tray_menu(app, &snapshot);
    let _ = app.emit("usage-snapshot", snapshot.clone());
    snapshot.clone()
}

async fn read_provider(
    state: &AppState,
    provider: Provider,
) -> Result<ProviderUsage, RefreshError> {
    // Reading credentials hits the filesystem, and on Windows that can mean a WSL share that
    // takes seconds to answer, so it stays off the async worker threads.
    let credentials =
        tauri::async_runtime::spawn_blocking(move || auth::read_credentials(provider))
            .await
            .expect("credential read panicked")
            .map_err(RefreshError::Auth)?;
    match provider {
        Provider::Codex => api::fetch_codex(&state.client, &credentials).await,
        Provider::Claude => api::fetch_claude(&state.client, &credentials).await,
    }
    .map_err(RefreshError::Api)
}

/// A failed provider keeps whatever it last read, so a signed-out Claude never blanks out Codex.
fn apply(provider: &mut ProviderUsage, result: Result<ProviderUsage, RefreshError>) {
    match result {
        Ok(fresh) => *provider = fresh,
        Err(error) => {
            provider.status = if provider.last_successful_update_epoch.is_some() {
                SnapshotStatus::Stale
            } else if matches!(error, RefreshError::Auth(auth::AuthError::MissingFile)) {
                SnapshotStatus::AuthMissing
            } else {
                SnapshotStatus::Error
            };
            provider.error_message = Some(error.to_string());
        }
    }
}

fn update_tray_menu(app: &AppHandle, snapshot: &UsageSnapshot) {
    let Some(tray) = app.tray_by_id("usage") else {
        return;
    };
    let Ok(codex_item) = MenuItem::with_id(
        app,
        "codex",
        tray_line("Codex", &snapshot.codex),
        false,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(claude_item) = MenuItem::with_id(
        app,
        "claude",
        tray_line("Claude", &snapshot.claude),
        false,
        None::<&str>,
    ) else {
        return;
    };
    let Ok(show) = MenuItem::with_id(app, "show", "Show usage", true, None::<&str>) else {
        return;
    };
    let Ok(refresh_item) = MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)
    else {
        return;
    };
    let Ok(quit) = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>) else {
        return;
    };
    if let Ok(menu) = Menu::with_items(
        app,
        &[&codex_item, &claude_item, &show, &refresh_item, &quit],
    ) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn tray_line(name: &str, provider: &ProviderUsage) -> String {
    format!(
        "{name}  5h {}  7d {}",
        percent(provider.five_hour.used_percent),
        percent(provider.seven_day.used_percent)
    )
}

fn percent(value: Option<f64>) -> String {
    match value {
        Some(value) => format!("{value:.0}%"),
        None => "--".to_owned(),
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// The app mark without its base arc, which stays legible at tray sizes. macOS renders it from
/// the alpha channel alone as a template image.
fn tray_icon() -> tauri::image::Image<'static> {
    tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))
        .expect("tray icon is a valid PNG")
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
            let refresh_item =
                MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &refresh_item, &quit])?;
            let tray = TrayIconBuilder::with_id("usage")
                .icon(tray_icon())
                .menu(&menu)
                .tooltip("Tantalus")
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
                    // Windows and Linux report every button here; only a completed left click
                    // should open the window, since the right button belongs to the menu.
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_window(tray.app_handle());
                    }
                });
            #[cfg(target_os = "macos")]
            let tray = tray.icon_as_template(true);
            tray.build(app)?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                refresh(&state, &handle).await;
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(300)).await;
                    refresh(&state, &handle).await;
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Tantalus")
        .run(|_app, _event| {
            // Clicking the dock icon on macOS reopens the app window.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_window(_app);
            }
        });
}
