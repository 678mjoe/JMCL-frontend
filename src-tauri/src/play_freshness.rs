//! Integrated-only in-memory proof of actual Core refresh and isolated vault ACK.
//! No token, witness digest or renderer-supplied approval is sent to logs/storage.

use std::{sync::Arc, time::{Duration, Instant}};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use tokio::sync::{Mutex, OwnedMutexGuard};

use crate::{login_test_policy::CLIENT_ID, session::{SessionError, SessionEvent}};

pub(crate) const REFRESH: &str = "auth.minecraft.refresh_exchange";
const MAX_LIFETIME_SECS: u64 = 30;
const MAX_OPAQUE_BYTES: usize = 64 * 1024;
type Digest32 = [u8; 32];

#[derive(Default)]
pub(crate) struct PlayFreshness(Arc<Mutex<State>>);

impl PlayFreshness {
    pub(crate) fn try_lock(&self) -> Result<OwnedMutexGuard<State>, SessionError> {
        self.0.clone().try_lock_owned().map_err(|_| busy())
    }
}

pub(crate) fn busy() -> SessionError {
    SessionError::coded("QA_REFRESH_BUSY", "An integrated Microsoft operation is already in progress.")
}

pub(crate) fn denied() -> SessionError {
    SessionError::coded("QA_FRESH_PLAY_REQUIRED", "A fresh, saved Microsoft launch session for this fixture is required.")
}

pub(crate) fn invalidates(method: &str) -> bool {
    matches!(method,
        "auth.microsoft.device.begin" | "auth.microsoft.device.poll" | "auth.minecraft.exchange"
        | "account.microsoft.save" | "account.microsoft.delete"
    )
}

#[derive(Clone, Copy)]
struct SessionProofRef<'a> {
    uuid: &'a str,
    digest: Digest32,
    ttl: u64,
}

fn field<'a>(value: &'a Value, name: &str) -> Option<&'a str> {
    value.get(name)?.as_str()
}

fn add_field(hasher: &mut Sha256, name: &str) {
    hasher.update((name.len() as u64).to_be_bytes());
    hasher.update(name.as_bytes());
}

fn plausible_opaque(token: &str) -> bool {
    !token.is_empty() && token.len() <= MAX_OPAQUE_BYTES && !token.contains('\0')
}

fn token_digest(token: &str) -> Digest32 {
    let mut hasher = Sha256::new();
    hasher.update(b"jmcl-integrated-rotation-v1");
    add_field(&mut hasher, token);
    hasher.finalize().into()
}

fn session_proof(value: &Value) -> Option<SessionProofRef<'_>> {
    // Exact pinned Rust Core Session shape; unknown/missing fields cannot attest.
    if value.as_object()?.len() != 8 { return None; }
    let player = field(value, "player_name")?;
    let uuid = field(value, "uuid")?;
    let access = field(value, "access_token")?;
    let kind = field(value, "user_type")?;
    let xuid = field(value, "xuid")?;
    let client = field(value, "client_id")?;
    let properties = field(value, "user_properties")?;
    let expiry = value.get("expires_in")?.as_u64()?;
    if player.is_empty() || player.len() > 16
        || !player.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        || uuid.len() != 32 || !uuid.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || !plausible_opaque(access) || kind != "msa"
        || xuid.len() > 32 || !xuid.bytes().all(|b| b.is_ascii_digit())
        || client != CLIENT_ID || properties != "{}" || !(1..=u32::MAX as u64).contains(&expiry)
    {
        return None;
    }
    let mut hasher = Sha256::new();
    hasher.update(b"jmcl-integrated-launch-session-v1");
    for part in [player, uuid, access, kind, xuid, client, properties] {
        add_field(&mut hasher, part);
    }
    hasher.update(expiry.to_be_bytes());
    Some(SessionProofRef { uuid, digest: hasher.finalize().into(), ttl: expiry.min(MAX_LIFETIME_SECS) })
}

pub(crate) struct Acknowledgable {
    account: String,
    session: Digest32,
    expires: Instant,
}

enum Slot {
    Awaiting { proof: Acknowledgable, rotation: Digest32 },
    Armed(Acknowledgable),
}

impl Slot {
    fn expires(&self) -> Instant {
        match self {
            Self::Awaiting { proof, .. } | Self::Armed(proof) => proof.expires,
        }
    }
}

#[derive(Default)]
pub(crate) struct State {
    slot: Option<Slot>,
}

impl State {
    pub(crate) fn clear(&mut self) { self.slot = None; }

    pub(crate) fn begin_refresh(&mut self, now: Instant) -> Result<(), SessionError> {
        if self.slot.as_ref().is_some_and(|slot| now < slot.expires()) {
            return Err(busy());
        }
        self.clear();
        Ok(())
    }

    // Invoked only from the actual adjacent Core request's terminal result.
    pub(crate) fn observe_terminal(&mut self, value: &Value, now: Instant) {
        self.clear();
        if value.as_object().is_none_or(|obj| obj.len() != 4)
            || field(value, "stage") != Some("refresh_exchange")
            || field(value, "state") != Some("authenticated")
        {
            return;
        }
        let Some(proof) = value.get("session").and_then(session_proof) else { return };
        let Some(rotation) = field(value, "refresh_token").filter(|token| plausible_opaque(token)) else { return };
        self.slot = Some(Slot::Awaiting {
            proof: Acknowledgable {
                account: proof.uuid.to_owned(),
                session: proof.digest,
                expires: now + Duration::from_secs(proof.ttl),
            },
            rotation: token_digest(rotation),
        });
    }

    // Called before the actual blocking Keychain setter. Removes the record
    // even on mismatch; unrelated/reordered writes cannot leave a valid grant.
    pub(crate) fn start_write(&mut self, account: &str, token: &str, now: Instant) -> Option<Acknowledgable> {
        let Some(Slot::Awaiting { proof, rotation }) = self.slot.take() else { return None };
        (now < proof.expires && account == proof.account.as_str() && plausible_opaque(token)
            && bool::from(rotation.ct_eq(&token_digest(token)))).then_some(proof)
    }

    // The handler calls this only after the scoped OS setter returns Ok.
    pub(crate) fn finish_ack(&mut self, pending: Option<Acknowledgable>, now: Instant) {
        self.slot = pending.filter(|proof| now < proof.expires).map(Slot::Armed);
    }

    // Even a mismatched authenticated attempt consumes any record before the
    // Core launch, so there is no replay or retry on a lost/failed dispatch.
    pub(crate) fn consume(&mut self, auth: Option<&Value>, now: Instant) -> Option<Instant> {
        let Some(Slot::Armed(proof)) = self.slot.take() else { return None };
        let actual = auth.and_then(session_proof)?;
        (now < proof.expires && actual.uuid == proof.account.as_str()
            && bool::from(proof.session.ct_eq(&actual.digest))).then_some(proof.expires)
    }
}

// Microsoft intent never emits raw process/Core logs. Reconstruct only the
// bounded numeric PID, not the original event object or unknown fields.
pub(crate) fn safe_started(event: &SessionEvent) -> Option<SessionEvent> {
    let SessionEvent::Event(value) = event else { return None };
    if field(value, "event") != Some("started") { return None; }
    let pid = value.pointer("/started/pid")?.as_u64()?;
    if !(2..=i32::MAX as u64).contains(&pid) { return None; }
    Some(SessionEvent::Event(json!({"event":"started","started":{"pid":pid}})))
}

pub(crate) fn safe_terminal(result: Result<Value, SessionError>) -> Result<Value, SessionError> {
    safe_terminal_for(result, "1.20.1")
}

pub(crate) fn safe_terminal_for(result: Result<Value, SessionError>, expected_version: &str) -> Result<Value, SessionError> {
    fn failure() -> SessionError {
        SessionError::coded("QA_AUTH_PLAY_FAILED", "The integrated authenticated Play request did not complete.")
    }
    let value = result.map_err(|_| failure())?;
    if field(&value, "stage") != Some("launch") || field(&value, "version_id") != Some(expected_version) {
        return Err(failure());
    }
    let process = value.get("process").ok_or_else(failure)?;
    let termination = match field(process, "termination") {
        Some(value @ ("exited" | "signal" | "stopped" | "unknown")) => value,
        _ => return Err(failure()),
    };
    Ok(json!({
        "stage":"launch","version_id":expected_version,"process":{
            "termination":termination,
            "exit_code":process.get("exit_code").and_then(Value::as_u64).filter(|n| *n <= 255),
            "signal":process.get("signal").and_then(Value::as_u64).filter(|n| *n <= 255)
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    const UUID: &str = "0123456789abcdef0123456789abcdef";
    const ROTATION: &str = "rotated-token-fixture-only";

    fn terminal() -> Value {
        json!({
            "stage":"refresh_exchange","state":"authenticated","refresh_token":ROTATION,"session":{
                "player_name":"Fixture","uuid":UUID,"access_token":"game-token-fixture-only",
                "user_type":"msa","xuid":"","client_id":CLIENT_ID,"user_properties":"{}","expires_in":60
            }
        })
    }

    fn arm(state: &mut State, result: &Value, now: Instant) {
        state.observe_terminal(result, now);
        let pending = state.start_write(UUID, ROTATION, now);
        assert!(pending.is_some());
        state.finish_ack(pending, now);
    }

    #[test]
    fn successful_terminal_exact_ack_then_single_use() {
        let now = Instant::now();
        let result = terminal();
        let mut state = State::default();
        state.observe_terminal(&result, now);
        assert!(state.begin_refresh(now).is_err());
        assert!(state.consume(result.get("session"), now).is_none()); // no native ACK yet
        arm(&mut state, &result, now);
        assert!(state.consume(result.get("session"), now).is_some());
        assert!(state.consume(result.get("session"), now).is_none());
        assert!(state.begin_refresh(now).is_ok());
    }

    #[test]
    fn wrong_rotation_wrong_account_failed_write_or_deletion_never_arm() {
        let now = Instant::now();
        let result = terminal();
        let mut state = State::default();
        for (account, token) in [("different-fixture", ROTATION), (UUID, "wrong-fixture-token")] {
            state.observe_terminal(&result, now);
            let pending = state.start_write(account, token, now);
            assert!(pending.is_none());
            state.finish_ack(pending, now);
            assert!(state.consume(result.get("session"), now).is_none());
        }
        state.observe_terminal(&result, now);
        let pending = state.start_write(UUID, ROTATION, now);
        assert!(pending.is_some());
        drop(pending); // failed or cancelled OS write: no finish_ack
        assert!(state.consume(result.get("session"), now).is_none());
        arm(&mut state, &result, now);
        state.clear();
        assert!(state.consume(result.get("session"), now).is_none());
    }

    #[test]
    fn no_proof_from_failed_exchange_or_modified_malformed_or_expired_session() {
        let now = Instant::now();
        let result = terminal();
        let mut state = State::default();
        for (part, bad) in [
            ("stage", json!("minecraft_exchange")), ("state", json!("exchange_failed")),
            ("session", json!({"user_type":"msa"})), ("refresh_token", json!("")),
        ] {
            let mut mutated = result.clone();
            mutated[part] = bad;
            state.observe_terminal(&mutated, now);
            assert!(state.start_write(UUID, ROTATION, now).is_none());
        }
        let mut changed = result["session"].clone();
        changed["access_token"] = json!("different-game-token-fixture");
        arm(&mut state, &result, now);
        assert!(state.consume(Some(&changed), now).is_none());
        assert!(state.consume(result.get("session"), now).is_none());
        let mut short = result.clone();
        short["session"]["expires_in"] = json!(2);
        arm(&mut state, &short, now);
        assert!(state.consume(short.get("session"), now + Duration::from_secs(2)).is_none());
        state.observe_terminal(&result, now);
        let pending = state.start_write(UUID, ROTATION, now);
        state.finish_ack(pending, now + Duration::from_secs(30));
        assert!(state.consume(result.get("session"), now + Duration::from_secs(30)).is_none());
    }

    #[test]
    fn concurrent_operation_rejected_and_only_mapped_evidence_visible() {
        let state = PlayFreshness::default();
        let held = state.try_lock().unwrap();
        assert!(state.try_lock().is_err());
        drop(held);
        assert!(state.try_lock().is_ok());
        let event = SessionEvent::Event(json!({"event":"started","started":{"pid":55,"secret":"fixture"}}));
        let mapped = safe_started(&event).unwrap();
        let SessionEvent::Event(data) = mapped else { panic!("expected whitelisted numeric event") };
        assert_eq!(data, json!({"event":"started","started":{"pid":55}}));
        assert!(safe_started(&SessionEvent::Event(json!({"event":"stdout","text":"fixture"}))).is_none());
        let result = safe_terminal(Ok(json!({"stage":"launch","version_id":"1.20.1",
            "process":{"termination":"exited","exit_code":0,"detail":"fixture"}}))).unwrap();
        assert!(!result.to_string().contains("fixture"));
    }
}
