#!/usr/bin/env bash
# End-to-end check against a running local API.
#
#   npm run dev:api          # in one terminal
#   apps/api/scripts/smoke.sh
#
# Exercises sign-up, document creation, batched ingestion, retrieval and chat,
# then asserts that a second workspace cannot see the first one's document.
set -euo pipefail

BASE="${BASE_URL:-http://127.0.0.1:8787}"
JAR_A="$(mktemp)"
JAR_B="$(mktemp)"
trap 'rm -f "$JAR_A" "$JAR_B"' EXIT

fail() { printf '\033[31mFAIL\033[0m %s\n' "$1"; exit 1; }
pass() { printf '\033[32m  ok\033[0m %s\n' "$1"; }

signup() {
  local jar="$1" email="$2"
  curl -sS -c "$jar" -X POST "$BASE/api/auth/sign-up/email" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$email\",\"password\":\"Str0ngPassw0rd!\",\"name\":\"Smoke\"}" >/dev/null
}

echo "1. health"
curl -sS "$BASE/health" | grep -q '"ok":true' || fail "health check"
pass "worker responds"

echo "2. rejects anonymous access"
code="$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/api/me")"
[ "$code" = "401" ] || fail "expected 401 without a session, got $code"
pass "unauthenticated request refused"

echo "3. sign up two separate workspaces"
EMAIL_A="smoke-a-$RANDOM@example.com"
EMAIL_B="smoke-b-$RANDOM@example.com"
signup "$JAR_A" "$EMAIL_A"
signup "$JAR_B" "$EMAIL_B"
TENANT_A="$(curl -sS -b "$JAR_A" "$BASE/api/me" | sed -n 's/.*"tenantId":"\([^"]*\)".*/\1/p')"
TENANT_B="$(curl -sS -b "$JAR_B" "$BASE/api/me" | sed -n 's/.*"tenantId":"\([^"]*\)".*/\1/p')"
[ -n "$TENANT_A" ] && [ -n "$TENANT_B" ] || fail "no tenant id after sign-up"
[ "$TENANT_A" != "$TENANT_B" ] || fail "both accounts landed in one workspace"
pass "two workspaces with distinct ids"

echo "4. create a document"
DOC="$(curl -sS -b "$JAR_A" -X POST "$BASE/api/documents" \
  -H 'content-type: application/json' \
  -d '{"filename":"smoke.md","kind":"md","sizeBytes":512,"extractor":"browser","pageCount":1,"totalChunks":2}')"
DOC_ID="$(printf '%s' "$DOC" | sed -n 's/.*"documentId":"\([^"]*\)".*/\1/p')"
[ -n "$DOC_ID" ] || fail "no document id returned: $DOC"
pass "document $DOC_ID"

echo "5. ingest one batch"
INGEST="$(curl -sS -b "$JAR_A" -X POST "$BASE/api/documents/$DOC_ID/ingest" \
  -H 'content-type: application/json' \
  -d '{"segments":[{"seq":0,"charStart":0,"page":1,"markdown":"# Falcon heavy\n\nThe rocket carries 63800 kg to low earth orbit."}],"chunks":[{"seq":0,"heading":"Falcon heavy","page":1,"charStart":0,"charEnd":80,"bodyStart":0,"text":"The Falcon Heavy rocket carries 63800 kg to low earth orbit.","tokenEstimate":15},{"seq":1,"heading":"Falcon heavy","page":1,"charStart":80,"charEnd":150,"bodyStart":80,"text":"Its first stage boosters return to the launch site and land upright.","tokenEstimate":16}],"done":true}')"
printf '%s' "$INGEST" | grep -q '"status":"active"' || fail "ingest did not finish: $INGEST"
printf '%s' "$INGEST" | grep -q '"embedded":2' || fail "wrong embedded count: $INGEST"
pass "two chunks embedded and stored"

echo "6. document content reads back"
curl -sS -b "$JAR_A" "$BASE/api/documents/$DOC_ID/content" | grep -q "Falcon heavy" \
  || fail "content endpoint did not return the markdown"
pass "reader content available"

echo "7. chat returns citations and an answer"
CHAT="$(curl -sS -b "$JAR_A" -X POST "$BASE/api/chat" \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"How much mass does the rocket carry to orbit?"}]}')"
printf '%s' "$CHAT" | grep -q '"type":"citations"' || fail "no citations event: $CHAT"
printf '%s' "$CHAT" | grep -q '"type":"token"' || fail "no answer tokens: $CHAT"
printf '%s' "$CHAT" | grep -q '"type":"done"' || fail "stream did not complete: $CHAT"
printf '%s' "$CHAT" | grep -q '63800' || fail "answer did not quote the retrieved figure: $CHAT"
pass "answer streamed with citations"

echo "8. the second workspace cannot see the first one's document"
LIST_B="$(curl -sS -b "$JAR_B" "$BASE/api/documents")"
printf '%s' "$LIST_B" | grep -q "$DOC_ID" && fail "workspace B listed workspace A's document"
CODE_B="$(curl -sS -o /dev/null -w '%{http_code}' -b "$JAR_B" "$BASE/api/documents/$DOC_ID/content")"
[ "$CODE_B" = "404" ] || fail "workspace B read workspace A's content, got $CODE_B"
CHAT_B="$(curl -sS -b "$JAR_B" -X POST "$BASE/api/chat" \
  -H 'content-type: application/json' \
  -d '{"messages":[{"role":"user","content":"How much mass does the rocket carry to orbit?"}]}')"
printf '%s' "$CHAT_B" | grep -q '63800' && fail "workspace B retrieved workspace A's text"
pass "tenant isolation holds across list, read and retrieval"

echo "9. settings round trip"
curl -sS -b "$JAR_A" "$BASE/api/settings" | grep -q '"tier":"free"' || fail "settings did not default to free"
curl -sS -b "$JAR_A" -X PATCH "$BASE/api/settings" \
  -H 'content-type: application/json' -d '{"tier":"paid"}' | grep -q '"tier":"paid"' \
  || fail "tier switch did not persist"
curl -sS -b "$JAR_A" -X PATCH "$BASE/api/settings" \
  -H 'content-type: application/json' -d '{"tier":"free"}' >/dev/null
pass "tier switches both ways"

echo "10. usage reflects the activity"
curl -sS -b "$JAR_A" "$BASE/api/usage" | grep -q '"chatMessages":1' || fail "usage did not record the chat"
pass "usage recorded"

echo "11. deleting the document clears its chunks"
curl -sS -b "$JAR_A" -X DELETE "$BASE/api/documents/$DOC_ID" | grep -q '"deleted"' || fail "delete failed"
curl -sS -b "$JAR_A" "$BASE/api/documents" | grep -q "$DOC_ID" && fail "document still listed after delete"
pass "document removed"

printf '\n\033[32mAll smoke checks passed.\033[0m\n'
