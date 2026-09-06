use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WindowUsage {
    pub used_percent: Option<f64>,
    pub limit_window_seconds: Option<i64>,
    pub reset_at_epoch: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ResetCredit {
    pub expires_at_epoch: Option<i64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageSnapshot {
    pub five_hour: WindowUsage,
    pub seven_day: WindowUsage,
    pub allowed: Option<bool>,
    pub limit_reached: Option<bool>,
    pub reset_credits: Vec<ResetCredit>,
    pub reset_credit_count: Option<usize>,
    pub last_successful_update_epoch: Option<i64>,
    pub status: SnapshotStatus,
    pub error_message: Option<String>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotStatus {
    Ready,
    Loading,
    Stale,
    AuthMissing,
    Error,
}
impl Default for UsageSnapshot {
    fn default() -> Self {
        Self {
            five_hour: WindowUsage::default(),
            seven_day: WindowUsage::default(),
            allowed: None,
            limit_reached: None,
            reset_credits: vec![],
            reset_credit_count: None,
            last_successful_update_epoch: None,
            status: SnapshotStatus::Loading,
            error_message: None,
        }
    }
}

pub fn parse_usage(
    value: &Value,
    now: i64,
) -> (WindowUsage, WindowUsage, Option<bool>, Option<bool>) {
    let rate_limit = value.get("rate_limit");
    let primary = parse_window(rate_limit.and_then(|item| item.get("primary_window")), now);
    let secondary = parse_window(
        rate_limit.and_then(|item| item.get("secondary_window")),
        now,
    );
    let allowed = rate_limit
        .and_then(|item| item.get("allowed"))
        .and_then(Value::as_bool);
    let limit_reached = rate_limit
        .and_then(|item| item.get("limit_reached"))
        .and_then(Value::as_bool);
    let windows = [primary, secondary];
    let five_hour = windows
        .iter()
        .find(|window| window.limit_window_seconds == Some(18_000))
        .cloned()
        .unwrap_or_default();
    let seven_day = windows
        .iter()
        .find(|window| window.limit_window_seconds == Some(604_800))
        .cloned()
        .unwrap_or_default();
    (five_hour, seven_day, allowed, limit_reached)
}
pub fn parse_credits(value: &Value) -> (Vec<ResetCredit>, Option<usize>) {
    let items = ["credits", "data", "items"]
        .iter()
        .find_map(|key| value.get(key).and_then(Value::as_array));
    let credits = items
        .map(|items| {
            items
                .iter()
                .map(|credit| ResetCredit {
                    expires_at_epoch: [
                        "expires_at",
                        "expiresAt",
                        "expiry",
                        "expires",
                        "expiration",
                        "expiration_at",
                    ]
                    .iter()
                    .find_map(|key| epoch(credit.get(key))),
                })
                .collect()
        })
        .unwrap_or_default();
    let count = value
        .get("available_count")
        .and_then(Value::as_u64)
        .and_then(|count| usize::try_from(count).ok())
        .or_else(|| items.map(Vec::len));
    (credits, count)
}
fn parse_window(value: Option<&Value>, now: i64) -> WindowUsage {
    let Some(value) = value else {
        return WindowUsage::default();
    };
    let used_percent = value.get("used_percent").and_then(Value::as_f64);
    let limit_window_seconds = value
        .get("limit_window_seconds")
        .and_then(exact_integer)
        .or_else(|| value.get("window_seconds").and_then(exact_integer));
    let reset_at_epoch = value
        .get("reset_after_seconds")
        .and_then(number)
        .map(|seconds| now + seconds)
        .or_else(|| epoch(value.get("reset_at")));
    WindowUsage {
        used_percent,
        limit_window_seconds,
        reset_at_epoch,
    }
}
fn number(value: &Value) -> Option<i64> {
    value.as_f64().map(|number| number as i64)
}
fn exact_integer(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| {
        value.as_f64().and_then(|number| {
            (number.is_finite()
                && number.fract() == 0.0
                && number >= i64::MIN as f64
                && number <= i64::MAX as f64)
                .then_some(number as i64)
        })
    })
}
fn epoch(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    let seconds = number(value)?;
    Some(if seconds > 100_000_000_000 {
        seconds / 1000
    } else {
        seconds
    })
}
pub fn now_epoch() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs() as i64)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn maps_windows_by_duration_and_parses_millisecond_reset_at() {
        let (five_hour, seven_day, allowed, reached) = parse_usage(
            &json!({"rate_limit":{"primary_window":{"used_percent":44.0,"reset_at":1700003600000i64,"window_seconds":604800},"secondary_window":{"used_percent":12.5,"reset_after_seconds":90,"limit_window_seconds":18000},"allowed":false,"limit_reached":true}}),
            1_700_000_000,
        );
        assert_eq!(five_hour.used_percent, Some(12.5));
        assert_eq!(five_hour.limit_window_seconds, Some(18_000));
        assert_eq!(five_hour.reset_at_epoch, Some(1_700_000_090));
        assert_eq!(seven_day.used_percent, Some(44.0));
        assert_eq!(seven_day.limit_window_seconds, Some(604_800));
        assert_eq!(seven_day.reset_at_epoch, Some(1_700_003_600));
        assert_eq!(allowed, Some(false));
        assert_eq!(reached, Some(true));
    }
    #[test]
    fn unknown_values_stay_unavailable() {
        let (primary, _, _, _) = parse_usage(&json!({"rate_limit":{"primary_window":{}}}), 1);
        assert_eq!(primary.used_percent, None);
    }

    #[test]
    fn parses_credit_container_and_expiry_field_alternatives() {
        let responses = [
            json!({"credits":[{"expires_at":1}, {"expiresAt":2}]}),
            json!({"data":[{"expiry":3}, {"expires":4}]}),
            json!({"items":[{"expiration":5}, {"expiration_at":6000}]}),
        ];
        let expiries = [1, 2, 3, 4, 5, 6000];

        let parsed = responses
            .iter()
            .flat_map(|response| parse_credits(response).0)
            .map(|credit| credit.expires_at_epoch)
            .collect::<Vec<_>>();
        assert_eq!(parsed, expiries.map(Some));
    }

    #[test]
    fn available_count_takes_precedence_over_credit_array_length() {
        let (_, count) = parse_credits(&json!({"credits":[{}],"available_count":3}));
        assert_eq!(count, Some(3));
    }

    #[test]
    fn parses_both_duration_field_alternatives() {
        let (five_hour, seven_day, _, _) = parse_usage(
            &json!({"rate_limit":{"primary_window":{"limit_window_seconds":18000},"secondary_window":{"window_seconds":604800}}}),
            1,
        );
        assert_eq!(five_hour.limit_window_seconds, Some(18_000));
        assert_eq!(seven_day.limit_window_seconds, Some(604_800));
    }

    #[test]
    fn missing_or_unfamiliar_duration_is_not_assigned_to_a_known_window() {
        let (five_hour, seven_day, _, _) = parse_usage(
            &json!({"rate_limit":{"primary_window":{"used_percent":9.0},"secondary_window":{"used_percent":18.0,"limit_window_seconds":3600}}}),
            1,
        );
        assert_eq!(five_hour.used_percent, None);
        assert_eq!(seven_day.used_percent, None);
    }

    #[test]
    fn fractional_durations_are_not_assigned_to_known_windows() {
        let (five_hour, seven_day, _, _) = parse_usage(
            &json!({"rate_limit":{"primary_window":{"used_percent":9.0,"limit_window_seconds":18000.9},"secondary_window":{"used_percent":18.0,"window_seconds":604800.1}}}),
            1,
        );
        assert_eq!(five_hour.used_percent, None);
        assert_eq!(seven_day.used_percent, None);
    }
}
