#!/bin/sh
# Account/session-policy changes invalidate sessions without exposing Docker.
set -eu
account_file=${SMTVV_USERS_FILE:-/planner-state/accounts/users_database.yml}
policy_file=${SMTVV_SESSION_POLICY_FILE:-/planner-state/login-policy/current/session.json}
auth_pid=
stop_auth() {
    if [ -n "$auth_pid" ]; then
        kill -TERM "$auth_pid" 2>/dev/null || true
        attempts=0
        while kill -0 "$auth_pid" 2>/dev/null && [ "$attempts" -lt 40 ]; do
            sleep 0.2
            attempts=$((attempts + 1))
        done
        kill -KILL "$auth_pid" 2>/dev/null || true
        wait "$auth_pid" 2>/dev/null || true
    fi
}
trap 'stop_auth; exit 0' INT TERM
get_fingerprint() {
    sha256sum "$account_file"
    if [ -f "$policy_file" ]; then sha256sum "$policy_file"; fi
}
start_auth() {
    if [ -f "$policy_file" ]; then
        # Validate before starting. Never silently run with a policy different
        # from the administrator's saved settings.
        authelia config validate --config /config/configuration.yml --config "$policy_file" >/dev/null 2>&1
        authelia --config /config/configuration.yml --config "$policy_file" &
    else
        authelia --config /config/configuration.yml &
    fi
    auth_pid=$!
}
fingerprint=$(get_fingerprint)
start_auth
while kill -0 "$auth_pid" 2>/dev/null; do
    sleep 1 &
    wait $! || true
    changed=$(get_fingerprint)
    if [ "$changed" != "$fingerprint" ]; then
        stop_auth
        fingerprint=$changed
        start_auth
    fi
done
wait "$auth_pid"
