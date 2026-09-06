use crate::auth::Credentials;
use crate::usage::{now_epoch, parse_credits, parse_usage, UsageSnapshot};
use reqwest::{Client, StatusCode};
use serde_json::Value;
use thiserror::Error;

const WHAM_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/codex/usage";
const RESET_CREDITS_URL: &str = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("The Codex usage service did not respond in time")]
    Timeout,
    #[error("The Codex usage service could not be reached")]
    Request,
    #[error("The Codex usage service returned an unexpected response")]
    Response,
}

pub async fn fetch_snapshot(
    client: &Client,
    credentials: &Credentials,
) -> Result<UsageSnapshot, ApiError> {
    let usage = fetch_usage(client, credentials).await?;
    let credits = fetch_json(client, RESET_CREDITS_URL, credentials, true).await?;
    let now = now_epoch();
    let (primary, secondary, allowed, limit_reached) = parse_usage(&usage, now);
    let (reset_credits, reset_credit_count) = parse_credits(&credits);
    Ok(UsageSnapshot {
        five_hour: primary,
        seven_day: secondary,
        allowed,
        limit_reached,
        reset_credits,
        reset_credit_count,
        last_successful_update_epoch: Some(now),
        status: crate::usage::SnapshotStatus::Ready,
        error_message: None,
    })
}
async fn fetch_usage(client: &Client, credentials: &Credentials) -> Result<Value, ApiError> {
    match fetch_json(client, WHAM_USAGE_URL, credentials, false).await {
        Ok(value) => Ok(value),
        Err(_) => fetch_json(client, CODEX_USAGE_URL, credentials, false).await,
    }
}
async fn fetch_json(
    client: &Client,
    url: &str,
    credentials: &Credentials,
    is_reset_request: bool,
) -> Result<Value, ApiError> {
    let mut request = client
        .get(url)
        .bearer_auth(&credentials.access_token)
        .header("accept", "application/json");
    if let Some(account_id) = &credentials.account_id {
        request = request.header("chatgpt-account-id", account_id);
    }
    if is_reset_request {
        request = request
            .header("OpenAI-Beta", "codex-1")
            .header("originator", "Codex Desktop")
            .header("User-Agent", "codex-usage-tray/0.1");
    }
    let response = request.send().await.map_err(|error| {
        if error.is_timeout() {
            ApiError::Timeout
        } else {
            ApiError::Request
        }
    })?;
    if response.status() != StatusCode::OK {
        return Err(ApiError::Response);
    }
    response.json().await.map_err(|_| ApiError::Response)
}
pub fn client() -> Result<Client, ApiError> {
    Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|_| ApiError::Request)
}
