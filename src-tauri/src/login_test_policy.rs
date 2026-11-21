//! Fail-closed routing for the opt-in Microsoft sign-in test profile.
use serde_json::{json, Map, Value};

use crate::session::SessionError;

pub(crate) const GUI_PREVIEW_ID: &str = "page.mjoe.jmcl.experimental-rust-preview";
pub(crate) const MICROSOFT_TEST_ID: &str = "page.mjoe.jmcl.experimental-rust-preview.microsoft-signin-test";
pub(crate) const MICROSOFT_TEST_PRODUCT: &str = "JMCL Rust Microsoft Sign-in Test";
pub(crate) const MICROSOFT_TEST_BINARY: &str = "jmcl-rust-microsoft-signin-test";
pub(crate) const MICROSOFT_TEST_WEBVIEW: [u8; 16] =
    [19, 178, 149, 125, 118, 153, 68, 74, 155, 205, 217, 0, 128, 74, 172, 117];
// Public application ID pinned by the existing frontend, not evidence of vendor authorization.
pub(crate) const CLIENT_ID: &str = "3dca676e-ab27-4afb-a40d-c177a33ffd70";
const PENDING_KEY: &str = "pending-device-login";
// Exact URI observed in the authorized one-shot begin probe for this client.
pub(crate) const VERIFICATION_URI: &str = "https://www.microsoft.com/link";
const PRODUCTION_SERVICE: &str = "page.mjoe.jmcl";
const MICROSOFT_TEST_SERVICE: &str =
    "page.mjoe.jmcl.experimental-rust-preview.microsoft-signin-test.refresh";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Profile {
    Production,
    Preview,
    MicrosoftTest,
    IntegratedOffline,
    IntegratedMicrosoft,
    General,
}

impl Profile {
    pub(crate) fn select(preview: bool, microsoft: bool, identifier: &str) -> Option<Self> {
        match (preview, microsoft, identifier) {
            (true, false, GUI_PREVIEW_ID) => Some(Self::Preview),
            (true, true, MICROSOFT_TEST_ID) => Some(Self::MicrosoftTest),
            (true, true, crate::general_preview::IDENTIFIER) if cfg!(feature = "experimental-general-gui-test") => Some(Self::General),
            (false, false, id) if !matches!(id, GUI_PREVIEW_ID | MICROSOFT_TEST_ID | crate::integrated_qa::IDENTIFIER | crate::general_preview::IDENTIFIER) => {
                Some(Self::Production)
            }
            _ => None,
        }
    }

    pub(crate) fn restricted_microsoft(self) -> bool {
        matches!(self, Self::MicrosoftTest | Self::IntegratedMicrosoft | Self::General)
    }

    pub(crate) fn credential_service(self, key: &str) -> Option<&'static str> {
        match self {
            Self::Production => Some(PRODUCTION_SERVICE),
            Self::General if key == PENDING_KEY || id(key) => Some(crate::general_preview::CREDENTIALS),
            Self::MicrosoftTest if key == PENDING_KEY || id(key) => Some(MICROSOFT_TEST_SERVICE),
            Self::IntegratedMicrosoft if key == PENDING_KEY || id(key) => Some(crate::integrated_qa::KEYCHAIN_SERVICE),
            _ => None,
        }
    }

    pub(crate) fn uses_fresh_play(self) -> bool {
        matches!(self, Self::IntegratedMicrosoft | Self::General)
    }

    pub(crate) fn mute_events(self) -> bool {
        // Also conceal late stderr/events consumed by a subsequent non-auth call.
        self.restricted_microsoft()
    }
}

fn id(value: &str) -> bool {
    value.len() == 32 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn only(fields: &Map<String, Value>, keys: &[&str]) -> bool {
    fields.keys().all(|k| keys.contains(&k.as_str()))
}

fn client(fields: &Map<String, Value>) -> bool {
    fields.get("client_id").and_then(Value::as_str) == Some(CLIENT_ID)
}

pub(crate) fn protected_method(method: &str) -> bool {
    method.starts_with("auth.") || method.starts_with("account.microsoft.")
}

pub(crate) fn allows(profile: Profile, method: &str, params: &Value, curseforge: bool) -> bool {
    if profile == Profile::Production {
        return true;
    }
    if curseforge || profile == Profile::IntegratedOffline {
        return false;
    }
    if profile == Profile::Preview {
        return !protected_method(method) || method == "account.microsoft.list";
    }
    // This is a sign-in test, not an authenticated game launch test.
    if matches!(method, "launch.plan" | "launch.execute") {
        return false;
    }
    if !protected_method(method) {
        return true;
    }
    let Some(fields) = params.as_object() else {
        return false;
    };
    match method {
        "auth.microsoft.device.begin" => {
            client(fields) && only(fields, &["client_id", "locale"])
                && fields.get("locale").is_none_or(|v| matches!(v.as_str(), Some("en" | "zh")))
        }
        "auth.microsoft.device.poll" | "auth.minecraft.exchange" | "auth.minecraft.refresh_exchange" => {
            let secret = match method {
                "auth.microsoft.device.poll" => "device_code",
                "auth.minecraft.exchange" => "access_token",
                _ => "refresh_token",
            };
            client(fields) && only(fields, &["client_id", secret])
                && fields.get(secret).and_then(Value::as_str).is_some_and(|s| !s.is_empty())
        }
        "account.microsoft.list" => fields.is_empty(),
        "account.microsoft.get" | "account.microsoft.delete" => {
            only(fields, &["id"]) && fields.get("id").and_then(Value::as_str).is_some_and(id)
        }
        "account.microsoft.save" => {
            only(fields, &["account"]) && fields.get("account").and_then(Value::as_object)
                .is_some_and(|account| {
                    only(account, &["id", "player_name", "client_id", "xuid", "schema_version"])
                        && client(account)
                        && account.get("id").and_then(Value::as_str).is_some_and(id)
                        && account.get("player_name").and_then(Value::as_str).is_some_and(|s| !s.is_empty())
                })
        }
        _ => false,
    }
}

fn safe_code(code: &str) -> &'static str {
    match code {
        "INVALID_PARAMS" => "INVALID_PARAMS",
        "AUTH_CANCELED" => "AUTH_CANCELED",
        "AUTH_NETWORK_ERROR" => "AUTH_NETWORK_ERROR",
        "AUTH_TIMEOUT" => "AUTH_TIMEOUT",
        "QA_REFRESH_BUSY" => "QA_REFRESH_BUSY",
        "AUTH_INVALID_RESPONSE" => "AUTH_INVALID_RESPONSE",
        "AUTH_RATE_LIMITED" => "AUTH_RATE_LIMITED",
        "AUTHORIZATION_DECLINED" => "AUTHORIZATION_DECLINED",
        "DEVICE_CODE_EXPIRED" => "DEVICE_CODE_EXPIRED",
        "OAUTH_REJECTED" => "OAUTH_REJECTED",
        "AUTH_SERVICE_ERROR" => "AUTH_SERVICE_ERROR",
        "XBOX_ACCOUNT_BANNED" => "XBOX_ACCOUNT_BANNED",
        "XBOX_ACCOUNT_REQUIRED" => "XBOX_ACCOUNT_REQUIRED",
        "XBOX_REGION_UNSUPPORTED" => "XBOX_REGION_UNSUPPORTED",
        "XBOX_ADULT_VERIFICATION_REQUIRED" => "XBOX_ADULT_VERIFICATION_REQUIRED",
        "XBOX_CHILD_ACCOUNT_RESTRICTED" => "XBOX_CHILD_ACCOUNT_RESTRICTED",
        "XBOX_AUTH_FAILED" => "XBOX_AUTH_FAILED",
        "MINECRAFT_ACCESS_DENIED" => "MINECRAFT_ACCESS_DENIED",
        "MINECRAFT_SERVICE_ERROR" => "MINECRAFT_SERVICE_ERROR",
        "GAME_NOT_OWNED" => "GAME_NOT_OWNED",
        "PROFILE_NOT_FOUND" => "PROFILE_NOT_FOUND",
        "ACCOUNT_STORE_ERROR" => "ACCOUNT_STORE_ERROR",
        "ACCOUNT_NOT_FOUND" => "ACCOUNT_NOT_FOUND",
        "ACCOUNT_LIMIT_REACHED" => "ACCOUNT_LIMIT_REACHED",
        "SESSION_CLOSED" => "SESSION_CLOSED",
        "CORE_RPC_EOF" => "CORE_RPC_EOF",
        "CORE_RPC_READ_FAILED" => "CORE_RPC_READ_FAILED",
        "CORE_RPC_WRITE_FAILED" => "CORE_RPC_WRITE_FAILED",
        "CORE_PROTOCOL_ERROR" => "CORE_PROTOCOL_ERROR",
        _ => "PREVIEW_MICROSOFT_REQUEST_FAILED",
    }
}

pub(crate) fn safe_error(error: SessionError) -> SessionError {
    // Never forward the raw error message or an arbitrary error code.
    match error {
        SessionError::Rpc { code, .. } => SessionError::Rpc {
            code: safe_code(&code).into(),
            message: "Microsoft sign-in test request failed.".into(),
        },
        SessionError::Transport { code, .. } => {
            SessionError::coded(safe_code(&code), "Microsoft sign-in test session failed.")
        }
    }
}

pub(crate) fn sanitize_result(method: &str, mut result: Value) -> Result<Value, SessionError> {
    if method == "auth.microsoft.device.begin" {
        let fields = result.as_object_mut().ok_or_else(invalid_verification_uri)?;
        if fields.get("verification_uri").and_then(Value::as_str) != Some(VERIFICATION_URI) {
            return Err(invalid_verification_uri());
        }
        // The dialog displays the plain verified URI and the separate user code.
        // Never forward unused alternatives or service-authored instructions.
        fields.remove("verification_uri_complete");
        fields.remove("message");
    }
    if method == "auth.minecraft.refresh_exchange"
        && result.get("state").and_then(Value::as_str) == Some("exchange_failed")
    {
        let code = safe_code(result.pointer("/exchange_error/code")
            .and_then(Value::as_str).unwrap_or(""));
        result["exchange_error"] = json!({
            "code": code, "message": "Minecraft exchange failed after Microsoft refresh."
        });
    }
    // Expected success credentials are deliberately returned to the existing
    // caller for use/persistence, never written to logs.
    Ok(result)
}

fn invalid_verification_uri() -> SessionError {
    SessionError::Rpc {
        code: "AUTH_INVALID_RESPONSE".into(),
        message: "Microsoft sign-in test verification destination changed.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROFILE_ID: &str = "0123456789abcdef0123456789abcdef";

    #[test]
    fn requires_exact_build_pair_and_distinct_keyring_binding() {
        assert_eq!(Profile::select(false, false, "page.mjoe.jmcl"), Some(Profile::Production));
        assert_eq!(Profile::select(true, false, GUI_PREVIEW_ID), Some(Profile::Preview));
        assert_eq!(Profile::select(true, true, MICROSOFT_TEST_ID), Some(Profile::MicrosoftTest));
        for (preview, test, id) in [
            (false, false, MICROSOFT_TEST_ID), (true, false, MICROSOFT_TEST_ID),
            (true, true, GUI_PREVIEW_ID), (false, true, MICROSOFT_TEST_ID),
            (true, true, "page.mjoe.jmcl"),
        ] {
            assert_eq!(Profile::select(preview, test, id), None);
        }
        assert_eq!(Profile::Preview.credential_service(PROFILE_ID), None);
        assert_eq!(Profile::Production.credential_service(PROFILE_ID), Some("page.mjoe.jmcl"));
        assert_eq!(Profile::MicrosoftTest.credential_service(PENDING_KEY), Some(MICROSOFT_TEST_SERVICE));
        assert_ne!(Profile::MicrosoftTest.credential_service(PROFILE_ID),
            Profile::Production.credential_service(PROFILE_ID));
        for reject in ["", "PROFILE", "pending-device-login/anything"] {
            assert_eq!(Profile::MicrosoftTest.credential_service(reject), None);
        }
    }

    #[test]
    fn authenticates_only_exact_native_allowlist_and_compiled_public_client() {
        let test = Profile::MicrosoftTest;
        for (method, payload) in [
            ("auth.microsoft.device.begin", json!({"client_id": CLIENT_ID, "locale": "en"})),
            ("auth.microsoft.device.poll", json!({"client_id": CLIENT_ID, "device_code": "fixture"})),
            ("auth.minecraft.exchange", json!({"client_id": CLIENT_ID, "access_token": "fixture"})),
            ("auth.minecraft.refresh_exchange", json!({"client_id": CLIENT_ID, "refresh_token": "fixture"})),
        ] {
            assert!(allows(test, method, &payload, false));
            assert!(!allows(test, method, &payload, true));
            assert!(!allows(Profile::Preview, method, &payload, false));
            let mut wrong_client = payload.clone();
            wrong_client["client_id"] = json!("another-client");
            assert!(!allows(test, method, &wrong_client, false));
        }
        for method in ["auth.microsoft.refresh", "auth.other", "launch.execute", "launch.plan"] {
            assert!(!allows(test, method, &json!({}), false));
        }
        assert!(allows(Profile::Production, "launch.execute", &json!({}), false));
    }

    #[test]
    fn metadata_never_accepts_path_override_or_secrets() {
        let test = Profile::MicrosoftTest;
        let account = json!({"id": PROFILE_ID, "player_name": "Fixture", "client_id": CLIENT_ID});
        assert!(allows(test, "account.microsoft.save", &json!({"account": account.clone()}), false));
        assert!(!allows(test, "account.microsoft.save",
            &json!({"account": account.clone(), "directory": "different"}), false));
        let mut bad = account;
        bad["refresh_token"] = json!("fixture-only");
        assert!(!allows(test, "account.microsoft.save", &json!({"account": bad}), false));
        assert!(allows(test, "account.microsoft.get", &json!({"id": PROFILE_ID}), false));
        assert!(allows(test, "account.microsoft.delete", &json!({"id": PROFILE_ID}), false));
        for method in ["account.microsoft.list", "account.microsoft.get", "account.microsoft.delete"] {
            assert!(!allows(test, method, &json!({"id": PROFILE_ID, "directory": "different"}), false));
        }
        assert!(allows(test, "account.microsoft.list", &json!({}), false));
        assert!(!allows(test, "account.microsoft.not_supported", &json!({}), false));
    }

    #[test]
    fn device_begin_exposes_only_the_verified_destination() {
        let got = sanitize_result("auth.microsoft.device.begin", json!({
            "verification_uri": VERIFICATION_URI,
            "verification_uri_complete": "https://example.invalid/fixture",
            "message": "synthetic instruction",
            "user_code": "FIXTURE"
        })).unwrap();
        assert_eq!(got["verification_uri"], VERIFICATION_URI);
        assert_eq!(got["user_code"], "FIXTURE");
        assert!(got.get("verification_uri_complete").is_none());
        assert!(got.get("message").is_none());
        for uri in [
            "http://www.microsoft.com/link", "https://microsoft.com/link",
            "https://www.microsoft.com/link?fixture=1", "https://www.microsoft.com/link#fixture",
            "https://www.microsoft.com:443/link", "https://www.microsoft.com/link/",
            "https://www.microsoft.com.example.invalid/link",
        ] {
            let err = sanitize_result("auth.microsoft.device.begin", json!({"verification_uri": uri}))
                .unwrap_err().to_string();
            assert!(err.contains("AUTH_INVALID_RESPONSE"));
            assert!(!err.contains(uri));
        }
        assert!(sanitize_result("auth.microsoft.device.begin", json!({})).is_err());
    }

    #[test]
    fn synthetic_secrets_never_escape_errors_events_or_nested_failure() {
        let fragment = "sensitive-fixture-only";
        let err = safe_error(SessionError::Rpc { code: fragment.into(), message: fragment.into() });
        assert!(!err.to_string().contains(fragment));
        let err = safe_error(SessionError::coded("CORE_RPC_EOF", fragment));
        assert!(err.to_string().contains("CORE_RPC_EOF") && !err.to_string().contains(fragment));
        assert!(Profile::MicrosoftTest.mute_events());
        assert!(!Profile::Preview.mute_events());
        assert!(!Profile::Production.mute_events());
        let got = sanitize_result("auth.minecraft.refresh_exchange", json!({
            "state": "exchange_failed", "refresh_token": "fixture-rotated",
            "exchange_error": {"code": "MINECRAFT_ACCESS_DENIED", "message": fragment, "body": fragment}
        })).unwrap();
        assert_eq!(got["refresh_token"], "fixture-rotated");
        assert_eq!(got["exchange_error"]["code"], "MINECRAFT_ACCESS_DENIED");
        assert!(!got.to_string().contains(fragment));
    }
}
