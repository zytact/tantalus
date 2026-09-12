use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{AppHandle, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// A signed release newer than the running build, as the window and tray show it.
#[derive(Clone, Serialize)]
pub struct AvailableUpdate {
    pub version: String,
}

impl From<&Update> for AvailableUpdate {
    fn from(update: &Update) -> Self {
        Self {
            version: update.version.clone(),
        }
    }
}

/// The release the last check found, kept so installing it does not fetch the manifest again. It
/// stays on offer through an install, so a failed one leaves nothing to put back.
#[derive(Default)]
pub struct PendingUpdate {
    update: Mutex<Option<Update>>,
    installing: AtomicBool,
}

impl PendingUpdate {
    pub fn available(&self) -> Option<AvailableUpdate> {
        self.get().as_ref().map(AvailableUpdate::from)
    }

    fn get(&self) -> Option<Update> {
        self.update
            .lock()
            .expect("pending update lock poisoned")
            .clone()
    }

    fn set(&self, update: Update) {
        *self.update.lock().expect("pending update lock poisoned") = Some(update);
    }
}

pub const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
/// A launch at login usually beats the network up, so a failed check comes back well before the
/// next interval.
const RETRY_START: Duration = Duration::from_secs(5 * 60);

/// The wait before the next check when it is not the normal interval. A failure backs off from
/// `RETRY_START`, doubling up to `CHECK_INTERVAL`, so a release published without a manifest is
/// not polled every few minutes.
pub fn next_retry(succeeded: bool, current: Option<Duration>) -> Option<Duration> {
    if succeeded {
        return None;
    }
    Some(current.map_or(RETRY_START, |wait| (wait * 2).min(CHECK_INTERVAL)))
}

/// Reads the manifest on the latest GitHub release and keeps the update it names, if any.
pub async fn check(app: &AppHandle) -> tauri_plugin_updater::Result<Option<AvailableUpdate>> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(None);
    };
    let available = AvailableUpdate::from(&update);
    app.state::<PendingUpdate>().set(update);
    Ok(Some(available))
}

/// Downloads the pending update, verifies its signature and installs it, then relaunches into it.
/// A deb or rpm install asks for an administrator password through polkit. Windows hands over to
/// the NSIS installer, which exits the app and starts the new version itself.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let pending = app.state::<PendingUpdate>();
    let update = pending.get().ok_or("No update is ready to install.")?;
    if pending.installing.swap(true, Ordering::AcqRel) {
        return Err("The update is already installing.".into());
    }
    let installed = update.download_and_install(|_, _| {}, || {}).await;
    pending.installing.store(false, Ordering::Release);
    installed.map_err(|error| format!("Could not install the update: {error}"))?;
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_failing_check_backs_off_to_the_normal_interval() {
        let mut retry = next_retry(false, None);
        assert_eq!(retry, Some(RETRY_START));
        let mut waits = vec![retry.expect("retry")];
        for _ in 0..8 {
            retry = next_retry(false, retry);
            waits.push(retry.expect("retry"));
        }
        assert!(waits.windows(2).all(|pair| pair[0] <= pair[1]));
        assert_eq!(waits.last(), Some(&CHECK_INTERVAL));
        assert_eq!(next_retry(true, retry), None);
    }
}
