#!/usr/bin/env bash
# TICKET-07/08 verification: signs up a fresh user against a running
# `wrangler dev --local` instance and asserts the session immediately has an
# active organization id, that /api/me requires auth, and that it returns the
# expected tenant context once authenticated.
# Run: apps/api/scripts/auth-smoke.sh [base_url]
set -euo pipefail

BASE_URL="${1:-http://localhost:8787}"
EMAIL="smoke-$(date +%s)@example.com"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "==> GET /api/me with no session"
UNAUTH_STATUS=$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/me")
if [ "$UNAUTH_STATUS" != "401" ]; then
  echo "FAIL: unauthenticated /api/me returned $UNAUTH_STATUS, expected 401" >&2
  exit 1
fi
echo "    401 as expected"

echo "==> Signing up $EMAIL"
SIGNUP_BODY=$(curl -sS -c "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery-staple\",\"name\":\"Smoke Test\"}")

if ! grep -q "better-auth.session_token" "$COOKIE_JAR"; then
  echo "FAIL: no session cookie returned from sign-up" >&2
  echo "$SIGNUP_BODY" >&2
  exit 1
fi
echo "    session cookie received"

echo "==> Fetching /api/auth/get-session"
SESSION_BODY=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/auth/get-session")

USER_EMAIL=$(echo "$SESSION_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['user']['email'])")
ACTIVE_ORG=$(echo "$SESSION_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['session']['activeOrganizationId'] or '')")

if [ "$USER_EMAIL" != "$EMAIL" ]; then
  echo "FAIL: get-session returned wrong user ($USER_EMAIL != $EMAIL)" >&2
  exit 1
fi

if [ -z "$ACTIVE_ORG" ]; then
  echo "FAIL: session has no activeOrganizationId" >&2
  echo "$SESSION_BODY" >&2
  exit 1
fi

echo "    user: $USER_EMAIL"
echo "    activeOrganizationId: $ACTIVE_ORG"

echo "==> GET /api/me with session"
ME_BODY=$(curl -sS -b "$COOKIE_JAR" "$BASE_URL/api/me")
ME_EMAIL=$(echo "$ME_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['email'])")
ME_TENANT=$(echo "$ME_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['tenantId'])")

if [ "$ME_EMAIL" != "$EMAIL" ]; then
  echo "FAIL: /api/me returned wrong email ($ME_EMAIL != $EMAIL)" >&2
  exit 1
fi

if [ "$ME_TENANT" != "$ACTIVE_ORG" ]; then
  echo "FAIL: /api/me tenantId ($ME_TENANT) != session activeOrganizationId ($ACTIVE_ORG)" >&2
  exit 1
fi

echo "    /api/me: $ME_BODY"
echo "PASS"
