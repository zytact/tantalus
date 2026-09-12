use serde::Serialize;
use std::{sync::Mutex, time::Duration};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// A signed release newer than the running build, as the window and tray show it.
#[derive(Clone, Serialize)]
pub struct AvailableUpdate {
    pub version: String,
}

/// The release the last check found, kept so installing it does not fetch the manifest again.
#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

impl PendingUpdate {
    pub fn available(&self) -> Option<AvailableUpdate> {
        self.0
            .lock()
            .expect("pending update lock poisoned")
            .as_ref()
            .map(|update| AvailableUpdate {
                version: update.version.clone(),
            })
    }
}

pub const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// A launch at login usually beats the network up, so a failed check comes back well before the
/// next interval.
pub const CHECK_RETRY: Duration = Duration::from_secs(5 * 60);

/// Reads the manifest on the latest GitHub release and keeps the update it names, if any.
pub async fn check(app: &AppHandle) -> tauri_plugin_updater::Result<Option<AvailableUpdate>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    let available = AvailableUpdate {
        version: update.version.clone(),
    };
    *app.state::<PendingUpdate>()
        .0
        .lock()
        .expect("pending update lock poisoned") = Some(update);
    Ok(Some(available))
}

/// Downloads the pending update, verifies its signature and installs it, then relaunches into it.
/// A deb or rpm install asks for an administrator password through polkit. Windows hands over to
/// the NSIS installer, which exits the app and starts the new version itself.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let pending = app.state::<PendingUpdate>();
    let update = pending
        .0
        .lock()
        .expect("pending update lock poisoned")
        .take()
        .ok_or("No update is ready to install.")?;
    if let Err(error) = update.download_and_install(|_, _| {}, || {}).await {
        // Cancelling the password prompt lands here, and the update stays on offer.
        *pending.0.lock().expect("pending update lock poisoned") = Some(update);
        return Err(format!("Could not install the update: {error}"));
    }
    app.restart();
}
