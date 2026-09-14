use crate::auth::Credentials;
use crate::usage::{
    now_epoch, parse_claude_usage, parse_credits, parse_opencode_usage, parse_usage, ProviderUsage,
    SnapshotStatus, WindowUsage,
};
use reqwest::{Client, StatusCode};
use serde_json::Value;
use thiserror::Error;

struct Endpoint {
    origin: &'static str,
    path: &'static str,
}

const WHAM_USAGE: Endpoint = Endpoint {
    origin: "https://chatgpt.com",
    path: "/backend-api/wham/usage",
};
const CODEX_USAGE: Endpoint = Endpoint {
    origin: "https://chatgpt.com",
    path: "/backend-api/codex/usage",
};
const RESET_CREDITS: Endpoint = Endpoint {
    origin: "https://chatgpt.com",
    path: "/backend-api/wham/rate-limit-reset-credits",
};
const CLAUDE_USAGE: Endpoint = Endpoint {
    origin: "https://api.anthropic.com",
    path: "/api/oauth/usage",
};
const OPENCODE_USAGE: Endpoint = Endpoint {
    origin: "https://opencode.ai",
    path: "/zen/go/v1/usage",
};
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

pub struct UsageApi {
    client: Client,
    origin_override: Option<String>,
}

impl UsageApi {
    pub fn new(origin_override: Option<String>) -> Result<Self, ApiError> {
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(12))
            .build()
            .map_err(|_| ApiError::Request)?;
        Ok(Self {
            client,
            origin_override,
        })
    }

    fn url(&self, endpoint: &Endpoint) -> String {
        let origin = self.origin_override.as_deref().unwrap_or(endpoint.origin);
        format!("{}{}", origin.trim_end_matches('/'), endpoint.path)
    }

    pub async fn fetch_codex(&self, credentials: &Credentials) -> Result<ProviderUsage, ApiError> {
        let usage = self.fetch_codex_usage(credentials).await?;
        let credits = self
            .fetch_json(&RESET_CREDITS, credentials, &codex_reset_headers())
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

    pub async fn fetch_claude(&self, credentials: &Credentials) -> Result<ProviderUsage, ApiError> {
        let usage = self
            .fetch_json(&CLAUDE_USAGE, credentials, &claude_headers())
            .await?;
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
        &self,
        credentials: &Credentials,
    ) -> Result<ProviderUsage, ApiError> {
        let usage = self
            .fetch_json(&OPENCODE_USAGE, credentials, &[("User-Agent", USER_AGENT)])
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

    async fn fetch_codex_usage(&self, credentials: &Credentials) -> Result<Value, ApiError> {
        match self.fetch_json(&WHAM_USAGE, credentials, &[]).await {
            Ok(value) => Ok(value),
            Err(_) => self.fetch_json(&CODEX_USAGE, credentials, &[]).await,
        }
    }

    async fn fetch_json(
        &self,
        endpoint: &Endpoint,
        credentials: &Credentials,
        headers: &[(&str, &str)],
    ) -> Result<Value, ApiError> {
        let mut request = self
            .client
            .get(self.url(endpoint))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_origin_override_keeps_each_providers_path() {
        let live = UsageApi::new(None).expect("client");
        let fixture = UsageApi::new(Some("http://127.0.0.1:4010/".into())).expect("client");

        assert_eq!(
            live.url(&CLAUDE_USAGE),
            "https://api.anthropic.com/api/oauth/usage"
        );
        assert_eq!(
            fixture.url(&CLAUDE_USAGE),
            "http://127.0.0.1:4010/api/oauth/usage"
        );
        assert_eq!(
            fixture.url(&WHAM_USAGE),
            "http://127.0.0.1:4010/backend-api/wham/usage"
        );
    }
}
