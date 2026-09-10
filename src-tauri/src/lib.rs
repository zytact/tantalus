mod api;
mod auth;
mod settings;
mod usage;

use auth::Provider;
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU8, Ordering},
    time::Duration,
};
use tauri::{
    menu::{IsMenuItem, Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::Color,
    AppHandle, Emitter, Manager, RunEvent, State, Theme, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::MacosLauncher;
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
    /// One lock per provider, in `Provider::ALL` order, so a refresh and a switch never read the
    /// same provider at once.
    requests: [Mutex<()>; Provider::ALL.len()],
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

#[tauri::command]
async fn set_provider_enabled(
    provider: Provider,
    enabled: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<UsageSnapshot, String> {
    let snapshot = apply_provider_toggle(&state, provider, enabled, |snapshot| {
        update_tray_menu(&app, snapshot);
        let _ = app.emit("usage-snapshot", snapshot.clone());
    })
    .await?;
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
        let (codex, claude, opencode) = tokio::join!(
            read_enabled(state, Provider::Codex),
            read_enabled(state, Provider::Claude),
            read_enabled(state, Provider::Opencode)
        );
        let snapshot = {
            let mut snapshot = state.snapshot.lock().await;
            apply_enabled(&mut snapshot, Provider::Codex, codex);
            apply_enabled(&mut snapshot, Provider::Claude, claude);
            apply_enabled(&mut snapshot, Provider::Opencode, opencode);
            if repeat_refresh(&state.refreshing) {
                None
            } else {
                update_tray_menu(app, &snapshot);
                let _ = app.emit("usage-snapshot", snapshot.clone());
                Some(snapshot.clone())
            }
        };
        if let Some(snapshot) = snapshot {
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
    Some(fetch_provider(state, provider, credentials).await)
}

async fn apply_provider_toggle<P>(
    state: &AppState,
    provider: Provider,
    enabled: bool,
    publish: P,
) -> Result<UsageSnapshot, String>
where
    P: FnOnce(&UsageSnapshot),
{
    let _request = if enabled {
        None
    } else {
        Some(provider_request(state, provider).lock().await)
    };
    let mut snapshot = state.snapshot.lock().await;
    let proposed =
        persist_provider_settings(&state.settings_path, snapshot.enabled, provider, enabled)?;
    snapshot.enabled = proposed;
    if !enabled {
        *provider_usage_mut(&mut snapshot, provider) = ProviderUsage::default();
    }
    publish(&snapshot);
    Ok(snapshot.clone())
}

fn persist_provider_settings(
    path: &std::path::Path,
    current: settings::ProviderSettings,
    provider: Provider,
    enabled: bool,
) -> Result<settings::ProviderSettings, String> {
    let mut proposed = current;
    proposed.set(provider, enabled);
    settings::save(path, &proposed)
        .map_err(|error| format!("Could not save provider setting: {error}"))?;
    Ok(proposed)
}

fn provider_usage(snapshot: &UsageSnapshot, provider: Provider) -> &ProviderUsage {
    match provider {
        Provider::Codex => &snapshot.codex,
        Provider::Claude => &snapshot.claude,
        Provider::Opencode => &snapshot.opencode,
    }
}

fn provider_usage_mut(snapshot: &mut UsageSnapshot, provider: Provider) -> &mut ProviderUsage {
    match provider {
        Provider::Codex => &mut snapshot.codex,
        Provider::Claude => &mut snapshot.claude,
        Provider::Opencode => &mut snapshot.opencode,
    }
}

async fn provider_enabled(state: &AppState, provider: Provider) -> bool {
    state.snapshot.lock().await.enabled.enabled(provider)
}

fn provider_request(state: &AppState, provider: Provider) -> &Mutex<()> {
    &state.requests[provider as usize]
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
        Provider::Opencode => api::fetch_opencode(&state.client, &credentials).await,
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
            apply(provider_usage_mut(snapshot, provider), result);
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

fn apply(provider: &mut ProviderUsage, result: Result<ProviderUsage, RefreshError>) {
    match result {
        Ok(fresh) => *provider = fresh,
        Err(error) => {
            provider.status = if provider.last_successful_update_epoch.is_some() {
                SnapshotStatus::Stale
            } else if matches!(
                error,
                RefreshError::Auth(auth::AuthError::MissingFile | auth::AuthError::MissingToken)
            ) {
                // Opencode shares one auth.json across every provider it can log into, so the
                // file exists without a Go key. That is not signed in, not a failed refresh.
                SnapshotStatus::AuthMissing
            } else {
                SnapshotStatus::Error
            };
            provider.error_message = Some(error.to_string());
        }
    }
}

const REFRESH_INTERVAL: Duration = Duration::from_secs(300);
const RETRY_BACKOFF_START: Duration = Duration::from_secs(5);

/// Every enabled provider holds a reading. A launch at login usually beats the network up, so the
/// first pass fails and the tray would otherwise sit on "no successful update yet" for a full
/// interval.
fn settled(snapshot: &UsageSnapshot) -> bool {
    Provider::ALL
        .into_iter()
        .filter(|provider| snapshot.enabled.enabled(*provider))
        .all(|provider| provider_usage(snapshot, provider).status == SnapshotStatus::Ready)
}

/// The wait before the next reading. `None` is the healthy cadence. A failed pass backs off from
/// `RETRY_BACKOFF_START`, doubling up to `REFRESH_INTERVAL` and holding there, so a provider that
/// stays unreachable settles back to the normal polling rate instead of hammering it.
fn next_backoff(settled: bool, current: Option<Duration>) -> Option<Duration> {
    if settled {
        return None;
    }
    Some(current.map_or(RETRY_BACKOFF_START, |wait| (wait * 2).min(REFRESH_INTERVAL)))
}

fn update_tray_menu(app: &AppHandle, snapshot: &UsageSnapshot) {
    let Some(tray) = app.tray_by_id("usage") else {
        return;
    };
    let mut lines = Vec::new();
    for provider in Provider::ALL {
        if !snapshot.enabled.enabled(provider) {
            continue;
        }
        let line = tray_line(provider.name(), provider_usage(snapshot, provider));
        let Ok(item) = MenuItem::with_id(app, provider.id(), line, false, None::<&str>) else {
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

/// A column per window the reading actually carries. Which windows an account has depends on its
/// plan, so none of the three is assumed: a Codex Go or free account has only the monthly one, and
/// OpenAI has switched the 5-hour one off for a plan before. A reading with no window at all keeps
/// the provider on the menu with a bare `--`.
fn tray_line(name: &str, provider: &ProviderUsage) -> String {
    let columns = [
        ("5h", &provider.five_hour),
        ("7d", &provider.seven_day),
        ("30d", &provider.monthly),
    ]
    .into_iter()
    .filter(|(_, window)| window.limit_window_seconds.is_some())
    .map(|(span, window)| format!("  {span} {}", percent(window.used_percent)))
    .collect::<String>();
    if columns.is_empty() {
        return format!("{name}  --");
    }
    format!("{name}{columns}")
}

/// Opencode reports fractional percentages, so one decimal is kept when the reading has one.
/// The providers that report whole numbers never grow a hollow ".0".
fn percent(value: Option<f64>) -> String {
    match value {
        Some(value) => {
            let rounded = (value * 10.0).round() / 10.0;
            if rounded.fract() == 0.0 {
                format!("{rounded:.0}%")
            } else {
                format!("{rounded:.1}%")
            }
        }
        None => "--".to_owned(),
    }
}

const MAIN_WINDOW: &str = "main";

/// The login registration launches with this flag so the app settles into the tray instead of
/// pushing a window at someone who has just signed in. The window config carries `create: false`,
/// so a normal launch is the only one that opens it.
const HIDDEN_FLAG: &str = "--hidden";

/// The window shell paints before the webview does, so it carries the same canvas color the
/// stylesheet uses. Without it a dark desktop gets a cream flash on every open.
const LIGHT_CANVAS: Color = Color(251, 248, 241, 255);
const DARK_CANVAS: Color = Color(10, 10, 10, 255);

fn paint_canvas(window: &WebviewWindow, theme: Theme) {
    let color = match theme {
        Theme::Dark => DARK_CANVAS,
        _ => LIGHT_CANVAS,
    };
    let _ = window.set_background_color(Some(color));
}

/// Closing the window destroys it, so the tray rebuilds it from the same configuration, and a
/// normal launch opens the first one the same way. A window that is hidden and shown again keeps a
/// stale input region on Wayland, which leaves its titlebar buttons dead until tao 0.36 reaches a
/// Tauri release (tauri-apps/tao#1218).
fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        let _ = window.unminimize();
        let _ = window.set_focus();
        return;
    }
    let Some(config) = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN_WINDOW)
        .cloned()
    else {
        return;
    };
    // Every caller is an event handler, and building a window from one deadlocks on Windows.
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        // The title comes from the product name rather than the window config, so a preview build
        // titles its window after itself instead of the release app.
        let title = app.package_info().name.clone();
        match tauri::WebviewWindowBuilder::from_config(&app, &config)
            .map(|builder| builder.title(title))
            .and_then(|builder| builder.build())
        {
            Ok(window) => {
                paint_canvas(&window, window.theme().unwrap_or(Theme::Light));
                let painted = window.clone();
                window.on_window_event(move |event| {
                    if let WindowEvent::ThemeChanged(theme) = event {
                        paint_canvas(&painted, *theme);
                    }
                });
            }
            Err(error) => eprintln!("Failed to open the window: {error}"),
        }
    });
}

/// The identifier `tauri.preview.conf.json` sets. The tray icon follows the identifier the build
/// was bundled with rather than a build flag, so a preview can never end up wearing release
/// identity or the other way round.
const PREVIEW_IDENTIFIER: &str = "dev.arnab.tantalus.preview";

/// The app mark without its base arc, which stays legible at tray sizes. macOS renders it from
/// the alpha channel alone as a template image.
const TRAY_PNG: &[u8] = include_bytes!("../icons/tray.png");

/// The same mark in the preview blue. Both marks share one silhouette, so macOS has to draw this
/// one in color to tell it from the release icon sitting beside it.
const PREVIEW_TRAY_PNG: &[u8] = include_bytes!("../icons/preview/tray.png");

fn is_preview(app: &AppHandle) -> bool {
    app.config().identifier == PREVIEW_IDENTIFIER
}

fn tray_icon(preview: bool) -> tauri::image::Image<'static> {
    let bytes = if preview { PREVIEW_TRAY_PNG } else { TRAY_PNG };
    tauri::image::Image::from_bytes(bytes).expect("tray icon is a valid PNG")
}

pub fn run() {
    let client = api::client().expect("failed to create HTTP client");
    tauri::Builder::default()
        // A second launch belongs to the instance already in the tray, so it raises that
        // window instead of starting a rival process with its own tray icon.
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _cwd| {
                show_window(app);
            },
        ))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![HIDDEN_FLAG]),
        ))
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
                requests: Default::default(),
                client,
                settings_path,
            });
            let show = MenuItem::with_id(app, "show", "Show usage", true, None::<&str>)?;
            let refresh_item =
                MenuItem::with_id(app, "refresh", "Refresh now", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &refresh_item, &quit])?;
            let preview = is_preview(app.handle());
            let tray = TrayIconBuilder::with_id("usage")
                .icon(tray_icon(preview))
                .menu(&menu)
                .tooltip(&app.package_info().name)
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
            let tray = tray.icon_as_template(!preview);
            tray.build(app)?;
            if !std::env::args().any(|argument| argument == HIDDEN_FLAG) {
                show_window(app.handle());
            }
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let state = handle.state::<AppState>();
                let mut backoff = None;
                loop {
                    let snapshot = refresh(&state, &handle).await;
                    backoff = next_backoff(settled(&snapshot), backoff);
                    tokio::time::sleep(backoff.unwrap_or(REFRESH_INTERVAL)).await;
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Tantalus")
        .run(|_app, event| match event {
            // Closing the window leaves the app in the tray. Only the tray's Quit item, which
            // exits with a code, ends the process.
            RunEvent::ExitRequested {
                api, code: None, ..
            } => api.prevent_exit(),
            // Clicking the dock icon on macOS reopens the app window.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_window(_app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    use settings::ProviderSettings;
    use std::sync::{Arc, Mutex as StdMutex};
    use tokio::sync::oneshot;

    /// A preview build picks its tray icon by identifier, so the two have to agree.
    #[test]
    fn the_preview_identifier_matches_the_preview_config() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.preview.conf.json")).expect("valid JSON");
        assert_eq!(config["identifier"], PREVIEW_IDENTIFIER);
    }

    fn window(seconds: i64, used: f64) -> usage::WindowUsage {
        usage::WindowUsage {
            used_percent: Some(used),
            limit_window_seconds: Some(seconds),
            reset_at_epoch: None,
        }
    }

    #[test]
    fn the_tray_keeps_a_fractional_percentage() {
        let provider = ProviderUsage {
            five_hour: window(usage::FIVE_HOUR_SECONDS, 12.74),
            seven_day: window(usage::SEVEN_DAY_SECONDS, 3.0),
            ..Default::default()
        };
        assert_eq!(
            tray_line("Opencode", &provider),
            "Opencode  5h 12.7%  7d 3%"
        );
    }

    /// A Codex Go or free account reports only a monthly window, so that is the only column.
    #[test]
    fn the_tray_carries_only_the_windows_the_account_has() {
        let provider = ProviderUsage {
            monthly: window(usage::MONTHLY_SECONDS, 58.0),
            ..Default::default()
        };
        assert_eq!(tray_line("Codex", &provider), "Codex  30d 58%");
    }

    /// A plan without the 5-hour window, which is what Pro reports while OpenAI has it switched
    /// off, keeps its weekly column instead of a hollow 5h one.
    #[test]
    fn the_tray_drops_a_window_the_plan_does_not_have() {
        let provider = ProviderUsage {
            seven_day: window(usage::SEVEN_DAY_SECONDS, 41.0),
            ..Default::default()
        };
        assert_eq!(tray_line("Codex", &provider), "Codex  7d 41%");
    }

    /// A reading that came back with no window keeps the provider on the menu.
    #[test]
    fn the_tray_says_nothing_was_read_rather_than_inventing_a_column() {
        assert_eq!(tray_line("Codex", &ProviderUsage::default()), "Codex  --");
    }

    fn state() -> AppState {
        AppState {
            snapshot: Mutex::new(UsageSnapshot::default()),
            refreshing: AtomicU8::new(0),
            requests: Default::default(),
            client: api::client().expect("client"),
            settings_path: std::env::temp_dir().join("tantalus-test-providers.json"),
        }
    }

    #[tokio::test]
    async fn a_disabled_provider_is_never_read() {
        let state = state();
        state.snapshot.lock().await.enabled = ProviderSettings::NONE;
        for provider in Provider::ALL {
            assert!(read_enabled(&state, provider).await.is_none());
        }
    }

    #[test]
    fn a_failed_reading_retries_before_the_next_interval() {
        let mut backoff = next_backoff(false, None);
        assert_eq!(backoff, Some(RETRY_BACKOFF_START));

        let mut waits = vec![backoff.expect("backoff")];
        for _ in 0..8 {
            backoff = next_backoff(false, backoff);
            waits.push(backoff.expect("backoff"));
        }
        // Climbs from the first retry and holds at the normal interval rather than hammering a
        // provider that stays unreachable.
        assert_eq!(waits.last(), Some(&REFRESH_INTERVAL));
        assert!(waits.windows(2).all(|pair| pair[0] <= pair[1]));

        assert_eq!(next_backoff(true, backoff), None);
    }

    #[test]
    fn a_disabled_provider_does_not_hold_the_refresh_in_backoff() {
        let mut snapshot = UsageSnapshot::default();
        snapshot.codex.status = SnapshotStatus::Ready;
        snapshot.claude.status = SnapshotStatus::Error;
        assert!(!settled(&snapshot));

        snapshot.enabled.set(Provider::Claude, false);
        assert!(settled(&snapshot));
    }

    /// `provider_request` indexes by discriminant, so a variant missing from `ALL` or listed out
    /// of order would hand a provider another one's lock, or panic past the end of the array.
    #[test]
    fn every_provider_indexes_its_own_request_lock() {
        for provider in Provider::ALL {
            assert_eq!(Provider::ALL[provider as usize], provider);
        }
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
                apply_provider_toggle(&state, Provider::Codex, false, |_| {})
                    .await
                    .unwrap();
            }
        });

        waiting.await.unwrap();
        tokio::task::yield_now().await;
        assert!(!disabling.is_finished());
        drop(request);
        disabling.await.unwrap();
        assert!(!provider_enabled(&state, Provider::Codex).await);
    }

    #[tokio::test]
    async fn a_refresh_queued_after_disable_does_not_read_credentials() {
        let state = Arc::new(state());
        let request = provider_request(&state, Provider::Codex).lock().await;
        let (disable_started, disable_started_wait) = oneshot::channel();
        let disabling = tokio::spawn({
            let state = Arc::clone(&state);
            async move {
                disable_started.send(()).unwrap();
                apply_provider_toggle(&state, Provider::Codex, false, |_| {})
                    .await
                    .unwrap();
            }
        });
        disable_started_wait.await.unwrap();
        tokio::task::yield_now().await;
        let reader = tokio::spawn({
            let state = Arc::clone(&state);
            async move { read_enabled(&state, Provider::Codex).await }
        });
        tokio::task::yield_now().await;
        drop(request);
        disabling.await.unwrap();
        assert!(reader.await.unwrap().is_none());
        assert!(!provider_enabled(&state, Provider::Codex).await);
    }

    #[tokio::test]
    async fn a_failed_persistence_keeps_the_current_snapshot() {
        let mut state = state();
        let directory =
            std::env::temp_dir().join(format!("tantalus-settings-failure-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        let path = directory.join("not-a-directory");
        std::fs::write(&path, "file").unwrap();
        state.settings_path = path.join("providers.json");
        {
            let mut snapshot = state.snapshot.lock().await;
            snapshot.codex.status = SnapshotStatus::Ready;
            snapshot.codex.five_hour.used_percent = Some(42.0);
        }
        assert!(
            apply_provider_toggle(&state, Provider::Codex, false, |_| {})
                .await
                .is_err()
        );
        let snapshot = state.snapshot.lock().await;
        assert!(snapshot.enabled.codex);
        assert_eq!(snapshot.codex.status, SnapshotStatus::Ready);
        assert_eq!(snapshot.codex.five_hour.used_percent, Some(42.0));
        let _ = std::fs::remove_dir_all(&directory);
    }

    #[tokio::test]
    async fn a_refresh_publication_precedes_a_following_toggle_publication() {
        let state = Arc::new(state());
        let events = Arc::new(StdMutex::new(Vec::new()));
        let refresh_snapshot = state.snapshot.lock().await;
        let toggling = tokio::spawn({
            let state = Arc::clone(&state);
            let events = Arc::clone(&events);
            async move {
                apply_provider_toggle(&state, Provider::Codex, false, move |snapshot| {
                    events.lock().unwrap().push(snapshot.enabled.codex);
                })
                .await
                .unwrap();
            }
        });
        tokio::task::yield_now().await;
        assert!(!toggling.is_finished());
        {
            let events = Arc::clone(&events);
            events.lock().unwrap().push(refresh_snapshot.enabled.codex);
        }
        drop(refresh_snapshot);
        toggling.await.unwrap();
        assert_eq!(*events.lock().unwrap(), [true, false]);
    }
}
