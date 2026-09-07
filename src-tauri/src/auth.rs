use serde_json::Value;
use std::{
    env, fs,
    path::{Path, PathBuf},
};
use thiserror::Error;

/// The two logins Tantalus reads. Each one keeps its credentials in its own directory, under its
/// own override variable, so every lookup is parameterised by the provider rather than duplicated.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Provider {
    Codex,
    Claude,
}

impl Provider {
    fn home_variable(self) -> &'static str {
        match self {
            Self::Codex => "CODEX_HOME",
            Self::Claude => "CLAUDE_CONFIG_DIR",
        }
    }

    fn directory(self) -> &'static str {
        match self {
            Self::Codex => ".codex",
            Self::Claude => ".claude",
        }
    }

    fn file(self) -> &'static str {
        match self {
            Self::Codex => "auth.json",
            Self::Claude => ".credentials.json",
        }
    }
}

#[derive(Debug, Clone)]
pub struct Credentials {
    pub access_token: String,
    pub account_id: Option<String>,
}

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("No sign-in was found for this provider")]
    MissingFile,
    #[error("The sign-in file is not valid JSON")]
    Parse,
    #[error("The sign-in file is missing an access token")]
    MissingToken,
}

/// Reads the first readable credential file for `provider`. Its home variable wins outright;
/// otherwise the native home directory is tried before any WSL distribution home.
pub fn read_credentials(provider: Provider) -> Result<Credentials, AuthError> {
    if let Some(directory) = env::var_os(provider.home_variable()) {
        return read_from(&PathBuf::from(directory).join(provider.file()));
    }
    let native = first_readable(native_auth_path(provider));
    if !matches!(native, Err(AuthError::MissingFile)) {
        return native;
    }
    // Touching the WSL share starts the distribution behind it, so it is only scanned once the
    // native home has turned up nothing.
    first_readable(wsl_auth_paths(provider))
}

fn first_readable(paths: impl IntoIterator<Item = PathBuf>) -> Result<Credentials, AuthError> {
    let mut last_error = AuthError::MissingFile;
    for path in paths {
        match read_from(&path) {
            Ok(credentials) => return Ok(credentials),
            Err(AuthError::MissingFile) => {}
            Err(error) => last_error = error,
        }
    }
    Err(last_error)
}

fn read_from(path: &Path) -> Result<Credentials, AuthError> {
    let raw = fs::read_to_string(path).map_err(|_| AuthError::MissingFile)?;
    parse_credentials(&raw)
}

fn native_auth_path(provider: Provider) -> Option<PathBuf> {
    home_directory().map(|home| home.join(provider.directory()).join(provider.file()))
}

fn home_directory() -> Option<PathBuf> {
    if let Some(home) = env::var_os("HOME").filter(|home| !home.is_empty()) {
        return Some(PathBuf::from(home));
    }
    #[cfg(windows)]
    {
        if let Some(profile) = env::var_os("USERPROFILE").filter(|value| !value.is_empty()) {
            return Some(PathBuf::from(profile));
        }
        let drive = env::var_os("HOMEDRIVE")?;
        let path = env::var_os("HOMEPATH")?;
        let mut home = PathBuf::from(drive);
        home.push(PathBuf::from(path));
        return Some(home);
    }
    #[cfg(not(windows))]
    None
}

#[cfg(windows)]
fn wsl_auth_paths(provider: Provider) -> Vec<PathBuf> {
    wsl::auth_paths(provider)
}

#[cfg(not(windows))]
fn wsl_auth_paths(_provider: Provider) -> Vec<PathBuf> {
    Vec::new()
}

pub fn parse_credentials(raw: &str) -> Result<Credentials, AuthError> {
    let value: Value = serde_json::from_str(raw).map_err(|_| AuthError::Parse)?;
    let token = string_at(&value, &["tokens", "access_token"])
        .or_else(|| string_at(&value, &["tokens", "access"]))
        .or_else(|| string_at(&value, &["access_token"]))
        .or_else(|| string_at(&value, &["access"]))
        .or_else(|| string_at(&value, &["chatgptAuthTokens", "access_token"]))
        .or_else(|| string_at(&value, &["chatgpt_auth", "access_token"]))
        .or_else(|| string_at(&value, &["claudeAiOauth", "accessToken"]))
        .filter(|value| !value.is_empty())
        .ok_or(AuthError::MissingToken)?;
    let account_id = string_at(&value, &["account_id"])
        .or_else(|| string_at(&value, &["accountId"]))
        .or_else(|| string_at(&value, &["tokens", "account_id"]))
        .or_else(|| string_at(&value, &["tokens", "accountId"]))
        .or_else(|| string_at(&value, &["chatgpt_account_id"]))
        .or_else(|| string_at(&value, &["chatgptAccountId"]))
        .filter(|value| !value.is_empty());
    Ok(Credentials {
        access_token: token,
        account_id,
    })
}

fn string_at(value: &Value, path: &[&str]) -> Option<String> {
    path.iter()
        .try_fold(value, |current, key| current.get(key))?
        .as_str()
        .map(str::to_owned)
}

/// Windows hosts can hold their logins inside a WSL distribution, reachable over the
/// `\\wsl.localhost` share. Distribution names are listed once per process; the home directories
/// behind them are read on every lookup so a fresh login is picked up without a restart.
#[cfg(windows)]
mod wsl {
    use super::Provider;
    use std::{
        fs, os::windows::process::CommandExt, path::PathBuf, process::Command, sync::OnceLock,
    };

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    const SHARE_ROOTS: [&str; 2] = [r"\\wsl.localhost", r"\\wsl$"];

    pub fn auth_paths(provider: Provider) -> Vec<PathBuf> {
        distributions()
            .iter()
            .flat_map(|distribution| distribution_auth_paths(distribution, provider))
            .collect()
    }

    fn distributions() -> &'static [String] {
        static DISTRIBUTIONS: OnceLock<Vec<String>> = OnceLock::new();
        DISTRIBUTIONS.get_or_init(|| {
            Command::new("wsl.exe")
                .args(["--list", "--quiet"])
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map(|output| super::distribution_names(&output.stdout))
                .unwrap_or_default()
        })
    }

    fn distribution_auth_paths(distribution: &str, provider: Provider) -> Vec<PathBuf> {
        SHARE_ROOTS
            .iter()
            .find_map(|root| {
                let base = PathBuf::from(root).join(distribution);
                let entries = fs::read_dir(base.join("home")).ok()?;
                let homes = entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .chain(std::iter::once(base.join("root")));
                Some(
                    homes
                        .map(|home| home.join(provider.directory()).join(provider.file()))
                        .collect(),
                )
            })
            .unwrap_or_default()
    }
}

/// `wsl.exe --list --quiet` writes UTF-16LE on most Windows builds and UTF-8 on some, so the
/// encoding is detected from the bytes rather than assumed.
#[cfg_attr(not(windows), allow(dead_code))]
fn distribution_names(output: &[u8]) -> Vec<String> {
    let text = if output.len() >= 2
        && output.len().is_multiple_of(2)
        && output.chunks_exact(2).all(|pair| pair[1] == 0)
    {
        let units: Vec<u16> = output
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(output).into_owned()
    };
    text.lines()
        .map(|line| {
            line.trim_matches(|character: char| {
                character.is_whitespace() || character == '\u{feff}' || character == '\0'
            })
        })
        .filter(|line| !line.is_empty())
        .map(str::to_owned)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_reference_auth_field_alternatives() {
        for raw in [
            r#"{"tokens":{"access_token":"a","account_id":"id"}}"#,
            r#"{"tokens":{"access":"a","accountId":"id"}}"#,
            r#"{"access_token":"a","account_id":"id"}"#,
            r#"{"access":"a","accountId":"id"}"#,
            r#"{"chatgptAuthTokens":{"access_token":"a"},"chatgpt_account_id":"id"}"#,
            r#"{"chatgpt_auth":{"access_token":"a"},"chatgptAccountId":"id"}"#,
        ] {
            let credentials = parse_credentials(raw).unwrap();
            assert_eq!(credentials.access_token, "a");
            assert_eq!(credentials.account_id.as_deref(), Some("id"));
        }
    }

    #[test]
    fn reads_the_claude_oauth_token() {
        let credentials =
            parse_credentials(r#"{"claudeAiOauth":{"accessToken":"a","refreshToken":"r"}}"#)
                .unwrap();
        assert_eq!(credentials.access_token, "a");
        assert_eq!(credentials.account_id, None);
    }

    #[test]
    fn reads_distribution_names_from_either_console_encoding() {
        let utf16: Vec<u8> = "Ubuntu\r\nDebian\r\n"
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        assert_eq!(distribution_names(&utf16), ["Ubuntu", "Debian"]);
        assert_eq!(
            distribution_names(b"Ubuntu\nDebian\n"),
            ["Ubuntu", "Debian"]
        );
        assert!(distribution_names(b"").is_empty());
    }
}
