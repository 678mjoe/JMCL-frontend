//! OS keychain storage for OAuth refresh tokens (contract §5).
//!
//! Only refresh tokens live here; account metadata stays in the core via
//! `account.microsoft.*`. Nothing is logged — error messages never include
//! token material.

use keyring::Entry;

const SERVICE: &str = "page.mjoe.jmcl";

#[derive(Debug, thiserror::Error, serde::Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum CredentialError {
    #[error("keychain operation failed: {0}")]
    Keychain(String),
}

impl From<keyring::Error> for CredentialError {
    fn from(error: keyring::Error) -> Self {
        CredentialError::Keychain(error.to_string())
    }
}

fn key(account_id: &str) -> String {
    format!("refresh-token/{account_id}")
}

fn entry(account_id: &str) -> Result<Entry, CredentialError> {
    Ok(Entry::new(SERVICE, &key(account_id))?)
}

fn set_blocking(account_id: String, refresh_token: String) -> Result<(), CredentialError> {
    entry(&account_id)?.set_password(&refresh_token)?;
    Ok(())
}

fn get_blocking(account_id: String) -> Result<Option<String>, CredentialError> {
    match entry(&account_id)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}

fn delete_blocking(account_id: String) -> Result<(), CredentialError> {
    match entry(&account_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

/// Store (or overwrite) the refresh token for an account. Callers MUST
/// persist rotated tokens before using a refreshed session (contract §6.4).
#[tauri::command]
pub async fn credential_set(
    account_id: String,
    refresh_token: String,
) -> Result<(), CredentialError> {
    tauri::async_runtime::spawn_blocking(move || set_blocking(account_id, refresh_token))
        .await
        .map_err(|error| CredentialError::Keychain(error.to_string()))?
}

/// Read the refresh token for an account; `None` when none is stored.
#[tauri::command]
pub async fn credential_get(account_id: String) -> Result<Option<String>, CredentialError> {
    tauri::async_runtime::spawn_blocking(move || get_blocking(account_id))
        .await
        .map_err(|error| CredentialError::Keychain(error.to_string()))?
}

/// Delete the refresh token for an account. Unknown ids are a no-op.
#[tauri::command]
pub async fn credential_delete(account_id: String) -> Result<(), CredentialError> {
    tauri::async_runtime::spawn_blocking(move || delete_blocking(account_id))
        .await
        .map_err(|error| CredentialError::Keychain(error.to_string()))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_is_scoped_per_account() {
        assert_eq!(key("alice"), "refresh-token/alice");
        assert_eq!(key("bob"), "refresh-token/bob");
        assert_ne!(key("alice"), key("alice2"));
    }
}
