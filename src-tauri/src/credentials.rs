//! OS keychain storage for OAuth refresh tokens (contract §5).
//!
//! Only refresh tokens live here; account metadata stays in the core via
//! `account.microsoft.*`. Nothing is logged — error messages never include
//! token material.

use std::time::Instant;

use crate::{login_test_policy::Profile, play_freshness};
use keyring::Entry;
use tauri::{AppHandle, Manager, State};

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

fn entry(profile: Profile, account_id: &str) -> Result<Entry, CredentialError> {
    let service = profile.credential_service(account_id).ok_or_else(|| {
        CredentialError::Keychain("Microsoft credential slot is disabled for this GUI profile".into())
    })?;
    Entry::new(service, &key(account_id)).map_err(|err| keychain_error(profile, err))
}

fn keychain_error(profile: Profile, err: keyring::Error) -> CredentialError {
    if profile.restricted_microsoft() {
        CredentialError::Keychain("Microsoft sign-in test keychain operation failed".into())
    } else {
        err.into()
    }
}

fn set_blocking(profile: Profile, account_id: String, refresh_token: String) -> Result<(), CredentialError> {
    entry(profile, &account_id)?.set_password(&refresh_token).map_err(|err| keychain_error(profile, err))?;
    Ok(())
}

fn get_blocking(profile: Profile, account_id: String) -> Result<Option<String>, CredentialError> {
    match entry(profile, &account_id)?.get_password() {
        Ok(token) => Ok(Some(token)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(keychain_error(profile, error)),
    }
}

fn delete_blocking(profile: Profile, account_id: String) -> Result<(), CredentialError> {
    match entry(profile, &account_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(keychain_error(profile, error)),
    }
}

fn qa_write_guard(
    app: &AppHandle,
    profile: Profile,
) -> Result<Option<tokio::sync::OwnedMutexGuard<play_freshness::State>>, CredentialError> {
    if !profile.uses_fresh_play() {
        return Ok(None);
    }
    let failure = || CredentialError::Keychain("Integrated Microsoft storage is not ready".into());
    let shared = app.try_state::<play_freshness::PlayFreshness>().ok_or_else(failure)?;
    shared.try_lock().map(Some).map_err(|_| failure())
}

/// Store (or overwrite) the refresh token for an account. Callers MUST
/// persist rotated tokens before using a refreshed session (contract §6.4).
#[tauri::command]
pub(crate) async fn credential_set(
    app: AppHandle,
    profile: State<'_, Profile>,
    account_id: String,
    refresh_token: String,
) -> Result<(), CredentialError> {
    let profile = *profile.inner();
    let mut guard = qa_write_guard(&app, profile)?;
    let pending = guard.as_mut().and_then(|state| state.start_write(&account_id, &refresh_token, Instant::now()));
    // Keep the integrated mutation lock inside the actual worker even if
    // the command future is dropped. A cancelled reply never arms proof.
    let (mut guard, pending, result) = tauri::async_runtime::spawn_blocking(move || {
        let result = set_blocking(profile, account_id, refresh_token);
        (guard, pending, result)
    })
    .await
    .map_err(|error| CredentialError::Keychain(if profile.restricted_microsoft() {
        "Microsoft sign-in test keychain task failed".into()
    } else {
        error.to_string()
    }))?;
    result?;
    if let Some(state) = guard.as_mut() {
        state.finish_ack(pending, Instant::now());
    }
    Ok(())
}

/// Read the refresh token for an account; `None` when none is stored.
#[tauri::command]
pub(crate) async fn credential_get(
    profile: State<'_, Profile>,
    account_id: String,
) -> Result<Option<String>, CredentialError> {
    let profile = *profile.inner();
    tauri::async_runtime::spawn_blocking(move || get_blocking(profile, account_id))
        .await
        .map_err(|error| CredentialError::Keychain(if profile.restricted_microsoft() {
            "Microsoft sign-in test keychain task failed".into()
        } else {
            error.to_string()
        }))?
}

/// Delete the refresh token for an account. Unknown ids are a no-op.
#[tauri::command]
pub(crate) async fn credential_delete(
    app: AppHandle,
    profile: State<'_, Profile>,
    account_id: String,
) -> Result<(), CredentialError> {
    let profile = *profile.inner();
    let mut guard = qa_write_guard(&app, profile)?;
    if let Some(state) = guard.as_mut() {
        state.clear();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let result = delete_blocking(profile, account_id);
        drop(guard);
        result
    })
        .await
        .map_err(|error| CredentialError::Keychain(if profile.restricted_microsoft() {
            "Microsoft sign-in test keychain task failed".into()
        } else {
            error.to_string()
        }))?
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
