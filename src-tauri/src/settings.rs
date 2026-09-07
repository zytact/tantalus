use crate::auth::Provider;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

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
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, settings: &ProviderSettings) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, serde_json::to_string(settings)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_or_corrupt_file_leaves_both_providers_on() {
        let directory = std::env::temp_dir().join("tantalus-settings-missing");
        let _ = fs::remove_dir_all(&directory);
        let path = directory.join("providers.json");
        assert_eq!(load(&path), ProviderSettings::default());

        fs::create_dir_all(&directory).unwrap();
        fs::write(&path, "not json").unwrap();
        assert_eq!(load(&path), ProviderSettings::default());
        let _ = fs::remove_dir_all(&directory);
    }

    #[test]
    fn a_saved_choice_survives_a_reload() {
        let path = std::env::temp_dir()
            .join("tantalus-settings-roundtrip")
            .join("providers.json");
        let _ = fs::remove_dir_all(path.parent().unwrap());
        let settings = ProviderSettings {
            codex: true,
            claude: false,
        };
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), settings);
        assert!(!load(&path).enabled(Provider::Claude));
        let _ = fs::remove_dir_all(path.parent().unwrap());
    }
}
