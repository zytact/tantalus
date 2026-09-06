use serde_json::Value;
use std::{env, fs, path::PathBuf};
use thiserror::Error;

#[derive(Debug, Clone)]
pub struct Credentials {
    pub access_token: String,
    pub account_id: Option<String>,
}

#[derive(Debug, Error)]
pub enum AuthError {
    #[error("Codex authentication file was not found")]
    MissingFile,
    #[error("Codex authentication file is not valid JSON")]
    Parse,
    #[error("Codex authentication is missing an access token")]
    MissingToken,
}

pub fn auth_path() -> Option<PathBuf> {
    env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")))
        .map(|directory| directory.join("auth.json"))
}

pub fn read_credentials() -> Result<Credentials, AuthError> {
    let path = auth_path().ok_or(AuthError::MissingFile)?;
    let raw = fs::read_to_string(path).map_err(|_| AuthError::MissingFile)?;
    parse_credentials(&raw)
}

pub fn parse_credentials(raw: &str) -> Result<Credentials, AuthError> {
    let value: Value = serde_json::from_str(raw).map_err(|_| AuthError::Parse)?;
    let token = string_at(&value, &["tokens", "access_token"])
        .or_else(|| string_at(&value, &["tokens", "access"]))
        .or_else(|| string_at(&value, &["access_token"]))
        .or_else(|| string_at(&value, &["access"]))
        .or_else(|| string_at(&value, &["chatgptAuthTokens", "access_token"]))
        .or_else(|| string_at(&value, &["chatgpt_auth", "access_token"]))
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
}
