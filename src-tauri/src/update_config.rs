//! Shared by build.rs and runtime: only compile-time public release configuration.
use base64::{engine::general_purpose::STANDARD, Engine};

#[allow(dead_code)] // Used by the separately compiled build script.
pub const ENV_NAMES: [&str; 4] = [
    "JMCL_UPDATE_ENDPOINT",
    "JMCL_UPDATE_PUBLIC_KEY",
    "JMCL_UPDATE_CHANNEL",
    "JMCL_UPDATE_VERIFIED",
];

#[derive(Clone)]
pub struct UpdateConfig {
    pub endpoint: url::Url,
    pub public_key: String,
    pub channel: String,
}

pub fn secure_url(value: &str) -> Result<url::Url, &'static str> {
    let url = url::Url::parse(value).map_err(|_| "invalid update URL")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("update URLs require HTTPS without credentials or fragments");
    }
    Ok(url)
}

pub fn parse(values: [Option<&str>; 4]) -> Result<Option<UpdateConfig>, &'static str> {
    if values.iter().all(Option::is_none) {
        return Ok(None);
    }
    let [Some(endpoint), Some(key), Some(channel), Some(verified)] = values else {
        return Err("all four JMCL_UPDATE_* build variables are required");
    };
    if verified != "release-maintainer-verified" {
        return Err("release maintainer verification is required");
    }
    if !matches!(channel, "stable" | "beta") {
        return Err("update channel must be stable or beta");
    }
    let endpoint = secure_url(endpoint)?;
    let decoded = STANDARD
        .decode(key)
        .map_err(|_| "invalid public key encoding")?;
    let decoded = std::str::from_utf8(&decoded).map_err(|_| "invalid public key text")?;
    minisign_verify::PublicKey::decode(decoded).map_err(|_| "invalid updater public key")?;
    Ok(Some(UpdateConfig {
        endpoint,
        public_key: key.into(),
        channel: channel.into(),
    }))
}

pub fn compiled() -> Option<UpdateConfig> {
    parse([
        option_env!("JMCL_UPDATE_ENDPOINT"),
        option_env!("JMCL_UPDATE_PUBLIC_KEY"),
        option_env!("JMCL_UPDATE_CHANNEL"),
        option_env!("JMCL_UPDATE_VERIFIED"),
    ])
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_partial_unverified_or_bad_key_is_disabled() {
        assert!(parse([None; 4]).unwrap().is_none());
        assert!(parse([Some("https://example.invalid"), None, None, None]).is_err());
        assert!(parse([
            Some("https://example.invalid"),
            Some("bad"),
            Some("stable"),
            Some("yes")
        ])
        .is_err());
        assert!(parse([
            Some("https://example.invalid"),
            Some("bad"),
            Some("stable"),
            Some("release-maintainer-verified")
        ])
        .is_err());
    }
    #[test]
    fn synthetic_public_key_is_accepted_only_with_complete_verified_configuration() {
        // Structural synthetic public bytes only: no private key or signing operation.
        let mut bytes = vec![0_u8; 42];
        bytes[0] = b'E';
        bytes[1] = b'd';
        let public_text = format!(
            "untrusted comment: synthetic fixture\n{}",
            STANDARD.encode(bytes)
        );
        let key = STANDARD.encode(public_text);
        let config = parse([
            Some("https://example.invalid/stable.json"),
            Some(&key),
            Some("stable"),
            Some("release-maintainer-verified"),
        ])
        .unwrap()
        .unwrap();
        assert_eq!(config.channel, "stable");
        assert!(parse([
            Some("https://example.invalid/stable.json"),
            Some(&key),
            Some("nightly"),
            Some("release-maintainer-verified")
        ])
        .is_err());
    }
    #[test]
    fn url_policy_rejects_downgrade_credentials_and_fragment() {
        for url in [
            "http://example.invalid",
            "https://user@example.invalid",
            "https://example.invalid/#x",
            "file:///tmp/x",
            "garbage",
        ] {
            assert!(secure_url(url).is_err());
        }
        assert!(secure_url("https://example.invalid/stable.json").is_ok());
    }
}
