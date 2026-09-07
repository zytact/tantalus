use crate::settings::ProviderSettings;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

pub const FIVE_HOUR_SECONDS: i64 = 18_000;
pub const SEVEN_DAY_SECONDS: i64 = 604_800;

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
/// Claude's paid overflow allowance. Codex has no equivalent and leaves this empty.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExtraUsage {
    pub enabled: bool,
    pub used_credits: Option<f64>,
    pub monthly_limit: Option<f64>,
    pub currency: Option<String>,
}
/// One provider's reading. Each provider succeeds or fails on its own, so status and freshness
/// live here rather than on the snapshot.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProviderUsage {
    pub five_hour: WindowUsage,
    pub seven_day: WindowUsage,
    pub allowed: Option<bool>,
    pub limit_reached: Option<bool>,
    pub reset_credits: Vec<ResetCredit>,
    pub reset_credit_count: Option<usize>,
    pub extra_usage: Option<ExtraUsage>,
    pub last_successful_update_epoch: Option<i64>,
    pub status: SnapshotStatus,
    pub error_message: Option<String>,
}
/// Both readings plus the switches that decide which providers get polled at all.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UsageSnapshot {
    pub codex: ProviderUsage,
    pub claude: ProviderUsage,
    pub enabled: ProviderSettings,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "snake_case")]
pub enum SnapshotStatus {
    Ready,
    #[default]
    Loading,
    Stale,
    AuthMissing,
    Error,
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
        .find(|window| window.limit_window_seconds == Some(FIVE_HOUR_SECONDS))
        .cloned()
        .unwrap_or_default();
    let seven_day = windows
        .iter()
        .find(|window| window.limit_window_seconds == Some(SEVEN_DAY_SECONDS))
        .cloned()
        .unwrap_or_default();
    (five_hour, seven_day, allowed, limit_reached)
}

/// Claude names its windows instead of reporting a duration, so the duration is supplied here.
/// A `locked_reason` on either window is the only signal that the account is actually cut off.
pub fn parse_claude_usage(
    value: &Value,
) -> (WindowUsage, WindowUsage, Option<bool>, Option<ExtraUsage>) {
    let five_hour = claude_window(value.get("five_hour"), FIVE_HOUR_SECONDS);
    let seven_day = claude_window(value.get("seven_day"), SEVEN_DAY_SECONDS);
    let locked = ["five_hour", "seven_day"]
        .iter()
        .filter_map(|key| value.get(key))
        .any(|window| {
            window
                .get("locked_reason")
                .is_some_and(|reason| !reason.is_null())
        });
    (
        five_hour,
        seven_day,
        Some(locked),
        parse_extra_usage(value.get("extra_usage")),
    )
}

fn claude_window(value: Option<&Value>, seconds: i64) -> WindowUsage {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return WindowUsage::default();
    };
    WindowUsage {
        used_percent: value.get("utilization").and_then(Value::as_f64),
        limit_window_seconds: Some(seconds),
        reset_at_epoch: epoch(value.get("resets_at")),
    }
}

fn parse_extra_usage(value: Option<&Value>) -> Option<ExtraUsage> {
    let value = value.filter(|value| !value.is_null())?;
    Some(ExtraUsage {
        enabled: value
            .get("is_enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        used_credits: value.get("used_credits").and_then(Value::as_f64),
        monthly_limit: value.get("monthly_limit").and_then(Value::as_f64),
        currency: value
            .get("currency")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
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
/// `jq -r` prints a JSON string as its text, so the reference script treats "90" and 90 alike.
/// Numeric fields accept either, truncating any fractional part.
fn number(value: &Value) -> Option<i64> {
    match value {
        Value::String(text) => whole_digits(text),
        value => value.as_f64().map(|number| number as i64),
    }
}
/// Digits with an optional fractional part, truncated. Deliberately stricter than `f64::parse`,
/// which would turn "NaN" and "inf" into an epoch of zero.
fn whole_digits(text: &str) -> Option<i64> {
    let (whole, fraction) = text.split_once('.').unwrap_or((text, ""));
    let digits = |part: &str| part.bytes().all(|byte| byte.is_ascii_digit());
    (!whole.is_empty() && digits(whole) && digits(fraction))
        .then(|| whole.parse().ok())
        .flatten()
}
/// Window durations match against 18,000 and 604,800 exactly, so unlike [`number`] this keeps a
/// fractional value unavailable rather than truncating it into a window it does not belong to.
fn exact_integer(value: &Value) -> Option<i64> {
    if let Value::String(text) = value {
        return (!text.contains('.')).then(|| whole_digits(text)).flatten();
    }
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
/// Timestamps arrive as an epoch in seconds or milliseconds, or as an RFC 3339 string.
fn epoch(value: Option<&Value>) -> Option<i64> {
    let value = value?;
    match number(value) {
        Some(epoch) => Some(to_seconds(epoch)),
        None => OffsetDateTime::parse(value.as_str()?, &Rfc3339)
            .ok()
            .map(OffsetDateTime::unix_timestamp),
    }
}
/// Epochs above this threshold are milliseconds. It is the year 5138 in seconds, so no plausible
/// second-resolution timestamp reaches it.
fn to_seconds(epoch: i64) -> i64 {
    if epoch > 100_000_000_000 {
        epoch / 1000
    } else {
        epoch
    }
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
    fn parses_rfc_3339_string_expiry() {
        let (credits, _) = parse_credits(
            &json!({"credits":[{"expires_at":"2026-10-04T01:14:37.945219Z"},{"expires_at":"2026-10-04T02:00:00+01:00"}]}),
        );
        let parsed = credits
            .iter()
            .map(|credit| credit.expires_at_epoch)
            .collect::<Vec<_>>();
        assert_eq!(parsed, [Some(1_791_076_477), Some(1_791_075_600)]);
    }

    #[test]
    fn numeric_string_expiry_is_read_as_an_epoch() {
        let (credits, _) = parse_credits(&json!({"credits":[
            {"expires_at":"1791076477"},
            {"expires_at":"1791076477945"},
            {"expires_at":"1791076477.945219"}
        ]}));
        let parsed = credits
            .iter()
            .map(|credit| credit.expires_at_epoch)
            .collect::<Vec<_>>();
        assert_eq!(parsed, [Some(1_791_076_477); 3]);
    }

    #[test]
    fn unparseable_expiry_string_stays_unavailable() {
        for text in ["whenever", "NaN", "inf", "-1e9", ""] {
            let (credits, _) = parse_credits(&json!({"credits":[{"expires_at":text}]}));
            assert_eq!(credits[0].expires_at_epoch, None, "{text} should not parse");
        }
    }

    #[test]
    fn string_durations_map_to_windows_but_fractional_ones_do_not() {
        let (five_hour, seven_day, _, _) = parse_usage(
            &json!({"rate_limit":{"primary_window":{"used_percent":9.0,"limit_window_seconds":"18000"},"secondary_window":{"used_percent":18.0,"window_seconds":"604800.5"}}}),
            1,
        );
        assert_eq!(five_hour.used_percent, Some(9.0));
        assert_eq!(seven_day.used_percent, None);
    }

    #[test]
    fn reset_after_seconds_accepts_a_string() {
        let (five_hour, _, _, _) = parse_usage(
            &json!({"rate_limit":{"primary_window":{"reset_after_seconds":"90","limit_window_seconds":18000}}}),
            1_700_000_000,
        );
        assert_eq!(five_hour.reset_at_epoch, Some(1_700_000_090));
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

    #[test]
    fn reads_claude_windows_and_extra_usage() {
        let (five_hour, seven_day, locked, extra) = parse_claude_usage(&json!({
            "five_hour": {"utilization": 65.0, "resets_at": "2026-09-07T00:39:59.850576+00:00", "locked_reason": null},
            "seven_day": {"utilization": 74.0, "resets_at": "2026-09-07T00:39:59.850576+00:00"},
            "seven_day_opus": null,
            "extra_usage": {"is_enabled": true, "used_credits": 12.5, "monthly_limit": 50.0, "currency": "USD"}
        }));
        assert_eq!(five_hour.used_percent, Some(65.0));
        assert_eq!(five_hour.limit_window_seconds, Some(FIVE_HOUR_SECONDS));
        assert_eq!(five_hour.reset_at_epoch, Some(1_788_741_599));
        assert_eq!(seven_day.limit_window_seconds, Some(SEVEN_DAY_SECONDS));
        assert_eq!(locked, Some(false));
        let extra = extra.unwrap();
        assert!(extra.enabled);
        assert_eq!(extra.used_credits, Some(12.5));
        assert_eq!(extra.currency.as_deref(), Some("USD"));
    }

    #[test]
    fn absent_claude_windows_stay_unavailable() {
        let (five_hour, seven_day, locked, extra) =
            parse_claude_usage(&json!({"five_hour": null, "extra_usage": null}));
        assert_eq!(five_hour.used_percent, None);
        assert_eq!(five_hour.limit_window_seconds, None);
        assert_eq!(seven_day.used_percent, None);
        assert_eq!(locked, Some(false));
        assert!(extra.is_none());
    }

    #[test]
    fn a_locked_window_reports_the_limit_as_reached() {
        let (_, _, locked, _) = parse_claude_usage(
            &json!({"seven_day": {"utilization": 100.0, "locked_reason": "usage_limit"}}),
        );
        assert_eq!(locked, Some(true));
    }

    #[test]
    fn claude_reset_stamps_read_their_offset_and_reject_junk() {
        let parse = |stamp| {
            parse_claude_usage(&json!({"five_hour": {"resets_at": stamp}}))
                .0
                .reset_at_epoch
        };
        assert_eq!(
            parse("2026-09-07T00:39:59.850576+00:00"),
            Some(1_788_741_599)
        );
        assert_eq!(parse("2026-09-07T05:39:59+05:30"), Some(1_788_739_799));
        assert_eq!(parse("whenever"), None);
    }
}
