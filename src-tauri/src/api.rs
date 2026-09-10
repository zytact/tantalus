use crate::auth::Credentials;
use crate::usage::{
    now_epoch, parse_claude_usage, parse_credits, parse_opencode_usage, parse_usage, ProviderUsage,
    SnapshotStatus, WindowUsage,
};
use reqwest::{Client, StatusCode};
use serde_json::Value;
use thiserror::Error;

const WHAM_USAGE_URL: &str = "https://chatgpt.com/backend-api/wham/usage";
const CODEX_USAGE_URL: &str = "https://chatgpt.com/backend-api/codex/usage";
const RESET_CREDITS_URL: &str = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
const CLAUDE_USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
const OPENCODE_USAGE_URL: &str = "https://opencode.ai/zen/go/v1/usage";
const USER_AGENT: &str = "tantalus/0.1";

#[derive(Debug, Error)]
pub enum ApiError {
    #[error("The usage service did not respond in time")]
    Timeout,
    #[error("The usage service could not be reached")]
    Request,
    #[error("The usage service returned an unexpected response")]
    Response,
}

pub async fn fetch_codex(
    client: &Client,
    credentials: &Credentials,
) -> Result<ProviderUsage, ApiError> {
    let usage = fetch_codex_usage(client, credentials).await?;
    let credits = fetch_json(
        client,
        RESET_CREDITS_URL,
        credentials,
        &codex_reset_headers(),
    )
    .await?;
    let now = now_epoch();
    let (five_hour, seven_day, monthly, allowed, limit_reached) = parse_usage(&usage, now);
    let (reset_credits, reset_credit_count) = parse_credits(&credits);
    Ok(ProviderUsage {
        five_hour,
        seven_day,
        monthly,
        allowed,
        limit_reached,
        reset_credits,
        reset_credit_count,
        extra_usage: None,
        last_successful_update_epoch: Some(now),
        status: SnapshotStatus::Ready,
        error_message: None,
    })
}

pub async fn fetch_claude(
    client: &Client,
    credentials: &Credentials,
) -> Result<ProviderUsage, ApiError> {
    let usage = fetch_json(client, CLAUDE_USAGE_URL, credentials, &claude_headers()).await?;
    let (five_hour, seven_day, limit_reached, extra_usage) = parse_claude_usage(&usage);
    Ok(ProviderUsage {
        five_hour,
        seven_day,
        monthly: WindowUsage::default(),
        allowed: limit_reached.map(|reached| !reached),
        limit_reached,
        reset_credits: Vec::new(),
        reset_credit_count: None,
        extra_usage,
        last_successful_update_epoch: Some(now_epoch()),
        status: SnapshotStatus::Ready,
        error_message: None,
    })
}

pub async fn fetch_opencode(
    client: &Client,
    credentials: &Credentials,
) -> Result<ProviderUsage, ApiError> {
    let usage = fetch_json(
        client,
        OPENCODE_USAGE_URL,
        credentials,
        &[("User-Agent", USER_AGENT)],
    )
    .await?;
    let (five_hour, seven_day, monthly, limit_reached) = parse_opencode_usage(&usage);
    Ok(ProviderUsage {
        five_hour,
        seven_day,
        monthly,
        allowed: limit_reached.map(|reached| !reached),
        limit_reached,
        reset_credits: Vec::new(),
        reset_credit_count: None,
        extra_usage: None,
        last_successful_update_epoch: Some(now_epoch()),
        status: SnapshotStatus::Ready,
        error_message: None,
    })
}

fn codex_reset_headers() -> [(&'static str, &'static str); 3] {
    [
        ("OpenAI-Beta", "codex-1"),
        ("originator", "Codex Desktop"),
        ("User-Agent", USER_AGENT),
    ]
}

fn claude_headers() -> [(&'static str, &'static str); 2] {
    [
        ("anthropic-beta", "oauth-2025-04-20"),
        ("User-Agent", USER_AGENT),
    ]
}

async fn fetch_codex_usage(client: &Client, credentials: &Credentials) -> Result<Value, ApiError> {
    match fetch_json(client, WHAM_USAGE_URL, credentials, &[]).await {
        Ok(value) => Ok(value),
        Err(_) => fetch_json(client, CODEX_USAGE_URL, credentials, &[]).await,
    }
}

async fn fetch_json(
    client: &Client,
    url: &str,
    credentials: &Credentials,
    headers: &[(&str, &str)],
) -> Result<Value, ApiError> {
    let mut request = client
        .get(url)
        .bearer_auth(&credentials.access_token)
        .header("accept", "application/json");
    if let Some(account_id) = &credentials.account_id {
        request = request.header("chatgpt-account-id", account_id);
    }
    for (name, value) in headers {
        request = request.header(*name, *value);
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
