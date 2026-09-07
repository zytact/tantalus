mod api;
mod auth;
mod settings;
mod usage;

use auth::Provider;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU8, Ordering},
};
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem},
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
    refreshing: AtomicU8,
    codex_request: Mutex<()>,
    claude_request: Mutex<()>,
    client: reqwest::Client,
    settings_path: PathBuf,
}

#[tauri::command]
async fn refresh_usage(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<UsageSnapshot, String> {
    Ok(refresh(&state, &app).await)
}

/// The user's switch for one provider. Turning it off stops the polling and clears the tray line;
/// turning it on refreshes that provider straight away. The choice is written to disk either way.
#[tauri::command]
async fn set_provider_enabled(
    provider: Provider,
    enabled: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<UsageSnapshot, String> {
    let snapshot = if enabled {
        set_provider_snapshot(&state, provider, true).await
    } else {
        disable_provider(&state, provider).await
    };
    if let Err(error) = settings::save(&state.settings_path, &snapshot.enabled) {
        eprintln!("could not save the provider switches: {error}");
    }
    update_tray_menu(&app, &snapshot);
    let _ = app.emit("usage-snapshot", snapshot.clone());
    if enabled {
        return Ok(refresh(&state, &app).await);
    }
    Ok(snapshot)
}

#[tauri::command]
async fn cached_usage(state: State<'_, AppState>) -> Result<UsageSnapshot, String> {
    Ok(state.snapshot.lock().await.clone())
}

async fn refresh(state: &AppState, app: &AppHandle) -> UsageSnapshot {
    if !claim_refresh(&state.refreshing) {
        return state.snapshot.lock().await.clone();
    }
    loop {
        let (codex, claude) = tokio::join!(
            read_enabled(state, Provider::Codex),
            read_enabled(state, Provider::Claude)
        );
        let snapshot = {
            let mut snapshot = state.snapshot.lock().await;
            apply_enabled(&mut snapshot, Provider::Codex, codex);
            apply_enabled(&mut snapshot, Provider::Claude, claude);
            snapshot.clone()
        };
        if !repeat_refresh(&state.refreshing) {
            update_tray_menu(app, &snapshot);
            let _ = app.emit("usage-snapshot", snapshot.clone());
            return snapshot;
        }
    }
}

async fn read_enabled(
    state: &AppState,
    provider: Provider,
) -> Option<Result<ProviderUsage, RefreshError>> {
    let _request = provider_request(state, provider).lock().await;
    if !provider_enabled(state, provider).await {
        return None;
    }
    let credentials =
        tauri::async_runtime::spawn_blocking(move || auth::read_credentials(provider))
            .await
            .expect("credential read panicked");
    if !provider_enabled(state, provider).await {
        return None;
    }
    Some(fetch_provider(state, provider, credentials).await)
}

async fn set_provider_snapshot(
    state: &AppState,
    provider: Provider,
    enabled: bool,
) -> UsageSnapshot {
    let mut snapshot = state.snapshot.lock().await;
    snapshot.enabled.set(provider, enabled);
    if !enabled {
        *provider_usage(&mut snapshot, provider) = ProviderUsage::default();
    }
    snapshot.clone()
}

async fn disable_provider(state: &AppState, provider: Provider) -> UsageSnapshot {
    let _request = provider_request(state, provider).lock().await;
    set_provider_snapshot(state, provider, false).await
}

fn provider_usage(snapshot: &mut UsageSnapshot, provider: Provider) -> &mut ProviderUsage {
    match provider {
        Provider::Codex => &mut snapshot.codex,
        Provider::Claude => &mut snapshot.claude,
    }
}

async fn provider_enabled(state: &AppState, provider: Provider) -> bool {
    state.snapshot.lock().await.enabled.enabled(provider)
}

fn provider_request(state: &AppState, provider: Provider) -> &Mutex<()> {
    match provider {
        Provider::Codex => &state.codex_request,
        Provider::Claude => &state.claude_request,
    }
}

async fn fetch_provider(
    state: &AppState,
    provider: Provider,
    credentials: Result<auth::Credentials, auth::AuthError>,
) -> Result<ProviderUsage, RefreshError> {
    let credentials = credentials.map_err(RefreshError::Auth)?;
    match provider {
        Provider::Codex => api::fetch_codex(&state.client, &credentials).await,
        Provider::Claude => api::fetch_claude(&state.client, &credentials).await,
    }
    .map_err(RefreshError::Api)
}

fn apply_enabled(
    snapshot: &mut UsageSnapshot,
    provider: Provider,
    result: Option<Result<ProviderUsage, RefreshError>>,
) {
    if snapshot.enabled.enabled(provider) {
        if let Some(result) = result {
            apply(provider_usage(snapshot, provider), result);
        }
    }
}

const REFRESHING: u8 = 1;
const REFRESH_PENDING: u8 = 2;

fn claim_refresh(refreshing: &AtomicU8) -> bool {
    loop {
        let current = refreshing.load(Ordering::Acquire);
        if current & REFRESHING == 0 {
            if refreshing
                .compare_exchange(current, REFRESHING, Ordering::AcqRel, Ordering::Acquire)
                .is_ok()
            {
                return true;
            }
        } else if refreshing
            .compare_exchange(
                current,
                current | REFRESH_PENDING,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_ok()
        {
            return false;
        }
    }
}

fn repeat_refresh(refreshing: &AtomicU8) -> bool {
    loop {
        let current = refreshing.load(Ordering::Acquire);
        let next = if current & REFRESH_PENDING == 0 {
            0
        } else {
            REFRESHING
        };
        if refreshing
            .compare_exchange(current, next, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            return next == REFRESHING;
        }
    }
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
    let mut lines = Vec::new();
    for (provider, id, name, usage) in [
        (Provider::Codex, "codex", "Codex", &snapshot.codex),
        (Provider::Claude, "claude", "Claude", &snapshot.claude),
    ] {
        if !snapshot.enabled.enabled(provider) {
            continue;
        }
        let Ok(item) = MenuItem::with_id(app, id, tray_line(name, usage), false, None::<&str>)
        else {
            return;
        };
        lines.push(item);
    }
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
    let mut items: Vec<&dyn IsMenuItem<tauri::Wry>> = lines
        .iter()
        .map(|item| item as &dyn IsMenuItem<_>)
        .collect();
    items.extend([
        &show as &dyn IsMenuItem<_>,
        &refresh_item as &dyn IsMenuItem<_>,
        &quit as &dyn IsMenuItem<_>,
    ]);
    if let Ok(menu) = Menu::with_items(app, &items) {
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

/// A hollow square outline. The transparent interior keeps the icon legible on light and dark
/// trays and lets macOS render it as a template image.
fn tray_icon() -> tauri::image::Image<'static> {
    let mut rgba = vec![0u8; 32 * 32 * 4];
    for y in 5..27 {
        for x in 5..27 {
            let border = !(7..25).contains(&x) || !(7..25).contains(&y);
            if border {
                let i = (y * 32 + x) * 4;
                rgba[i..i + 4].copy_from_slice(&[18, 102, 163, 255]);
            }
        }
    }
    tauri::image::Image::new_owned(rgba, 32, 32)
}

pub fn run() {
    let client = api::client().expect("failed to create HTTP client");
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            refresh_usage,
            cached_usage,
            set_provider_enabled
        ])
        .setup(move |app| {
            let settings_path = app
                .path()
                .app_config_dir()
                .expect("no config directory for this platform")
                .join("providers.json");
            app.manage(AppState {
                snapshot: Mutex::new(UsageSnapshot {
                    enabled: settings::load(&settings_path),
                    ..UsageSnapshot::default()
                }),
                refreshing: AtomicU8::new(0),
                codex_request: Mutex::new(()),
                claude_request: Mutex::new(()),
                client,
                settings_path,
            });
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

#[cfg(test)]
mod tests {
    use super::*;
    use settings::ProviderSettings;
    use std::sync::Arc;
    use tokio::sync::oneshot;

    fn state() -> AppState {
        AppState {
            snapshot: Mutex::new(UsageSnapshot::default()),
            refreshing: AtomicU8::new(0),
            codex_request: Mutex::new(()),
            claude_request: Mutex::new(()),
            client: api::client().expect("client"),
            settings_path: std::env::temp_dir().join("tantalus-test-providers.json"),
        }
    }

    #[tokio::test]
    async fn a_disabled_provider_is_never_read() {
        let state = state();
        state.snapshot.lock().await.enabled = ProviderSettings {
            codex: false,
            claude: false,
        };
        assert!(read_enabled(&state, Provider::Codex).await.is_none());
        assert!(read_enabled(&state, Provider::Claude).await.is_none());
    }

    #[test]
    fn the_switch_targets_only_its_own_provider() {
        let mut snapshot = UsageSnapshot::default();
        snapshot.enabled.set(Provider::Claude, false);
        assert!(snapshot.enabled.enabled(Provider::Codex));
        assert!(!snapshot.enabled.enabled(Provider::Claude));
    }

    #[test]
    fn a_disabled_provider_does_not_apply_an_in_flight_result() {
        let mut snapshot = UsageSnapshot::default();
        snapshot.enabled.set(Provider::Codex, false);
        let fresh = ProviderUsage {
            status: SnapshotStatus::Ready,
            ..ProviderUsage::default()
        };

        apply_enabled(&mut snapshot, Provider::Codex, Some(Ok(fresh)));

        assert_eq!(snapshot.codex.status, SnapshotStatus::Loading);
    }

    #[test]
    fn an_enable_during_refresh_requests_another_fetch() {
        let refreshing = AtomicU8::new(0);
        assert!(claim_refresh(&refreshing));
        assert!(!claim_refresh(&refreshing));
        assert!(repeat_refresh(&refreshing));
        assert_eq!(refreshing.load(Ordering::Acquire), REFRESHING);
        assert!(!repeat_refresh(&refreshing));
        assert_eq!(refreshing.load(Ordering::Acquire), 0);
    }

    #[tokio::test]
    async fn disabling_waits_for_a_provider_request_to_start() {
        let state = Arc::new(state());
        let request = provider_request(&state, Provider::Codex).lock().await;
        let (started, waiting) = oneshot::channel();
        let disabling = tokio::spawn({
            let state = Arc::clone(&state);
            async move {
                started.send(()).unwrap();
                disable_provider(&state, Provider::Codex).await;
            }
        });

        waiting.await.unwrap();
        tokio::task::yield_now().await;
        assert!(!disabling.is_finished());
        drop(request);
        disabling.await.unwrap();
        assert!(!provider_enabled(&state, Provider::Codex).await);
    }
}
