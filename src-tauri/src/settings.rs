use crate::auth::Provider;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct ProviderSettings {
    pub codex: bool,
    pub claude: bool,
}

impl Default for ProviderSettings {
    fn default() -> Self {
        Self {
            codex: true,
            claude: true,
        }
    }
}

impl ProviderSettings {
    pub fn enabled(&self, provider: Provider) -> bool {
        match provider {
            Provider::Codex => self.codex,
            Provider::Claude => self.claude,
        }
    }

    pub fn set(&mut self, provider: Provider, enabled: bool) {
        match provider {
            Provider::Codex => self.codex = enabled,
            Provider::Claude => self.claude = enabled,
        }
    }
}

pub fn load(path: &Path) -> ProviderSettings {
    match fs::read_to_string(path) {
        Ok(text) => match serde_json::from_str(&text) {
            Ok(settings) => settings,
            Err(error) => {
                eprintln!(
                    "Failed to parse provider settings at {}: {error}",
                    path.display()
                );
                ProviderSettings {
                    codex: false,
                    claude: false,
                }
            }
        },
        Err(error) if error.kind() == io::ErrorKind::NotFound => ProviderSettings::default(),
        Err(error) => {
            eprintln!(
                "Failed to read provider settings at {}: {error}",
                path.display()
            );
            ProviderSettings {
                codex: false,
                claude: false,
            }
        }
    }
}

pub fn save(path: &Path, settings: &ProviderSettings) -> std::io::Result<()> {
    save_with_writer(path, settings, |file, contents| file.write_all(contents))
}

fn save_with_writer<F>(path: &Path, settings: &ProviderSettings, writer: F) -> io::Result<()>
where
    F: FnOnce(&mut File, &[u8]) -> io::Result<()>,
{
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent)?;
        }
    }

    let contents = serde_json::to_vec(settings)?;
    let directory = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let (temporary_path, mut temporary_file) = create_temporary_file(directory, path)?;

    let write_result =
        writer(&mut temporary_file, &contents).and_then(|_| temporary_file.sync_all());
    drop(temporary_file);

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    if let Err(error) = fs::rename(&temporary_path, path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    sync_directory(directory);
    Ok(())
}

fn create_temporary_file(directory: &Path, path: &Path) -> io::Result<(PathBuf, File)> {
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();

    for _ in 0..100 {
        let sequence = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temporary_path = directory.join(format!(
            ".{file_name}.{}.{}.tmp",
            std::process::id(),
            sequence
        ));
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)
        {
            Ok(file) => return Ok((temporary_path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "could not create a unique provider settings temporary file",
    ))
}

#[cfg(unix)]
fn sync_directory(directory: &Path) {
    let _ = File::open(directory).and_then(|file| file.sync_all());
}

#[cfg(not(unix))]
fn sync_directory(_directory: &Path) {}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_directory(name: &str) -> PathBuf {
        let sequence = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "tantalus-settings-{name}-{}-{sequence}",
            std::process::id()
        ))
    }

    #[test]
    fn a_missing_file_leaves_both_providers_on() {
        let directory = test_directory("missing");
        let _ = fs::remove_dir_all(&directory);
        let path = directory.join("providers.json");
        assert_eq!(load(&path), ProviderSettings::default());

        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_malformed_file_disables_both_providers() {
        let directory = test_directory("malformed");
        let path = directory.join("providers.json");
        fs::create_dir_all(&directory).unwrap();
        fs::write(&path, "not json").unwrap();
        assert_eq!(
            load(&path),
            ProviderSettings {
                codex: false,
                claude: false,
            }
        );
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_saved_choice_survives_a_reload() {
        let directory = test_directory("roundtrip");
        let path = directory.join("providers.json");
        let _ = fs::remove_dir_all(&directory);
        let settings = ProviderSettings {
            codex: true,
            claude: false,
        };
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), settings);
        assert!(!load(&path).enabled(Provider::Claude));
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_failed_save_leaves_existing_settings_intact() {
        let directory = test_directory("failed-save");
        let path = directory.join("providers.json");
        let original = ProviderSettings {
            codex: false,
            claude: true,
        };
        save(&path, &original).unwrap();

        let error = save_with_writer(&path, &ProviderSettings::default(), |_, _| {
            Err(io::Error::other("simulated write failure"))
        });

        assert!(error.is_err());
        assert_eq!(load(&path), original);
        let _ = fs::remove_dir_all(&directory);
    }
}
