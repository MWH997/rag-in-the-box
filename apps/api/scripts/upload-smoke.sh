#!/usr/bin/env bash
# TICKET-10/32 verification: signs up a fresh user, uploads fixtures, and
# confirms: documentId + r2_key are returned/stored, the R2 object exists,
# oversize/wrong-type uploads are rejected, and the TICKET-32 triage router
# picks the expected `parser` for each fixture (csv/digital.pdf -> local,
# scanned.pdf -> llamaparse).
#
# NOTE (TICKET-32 partial): this only asserts `parser`/`status` immediately
# after upload, not that the document reaches `active` or that a real
# LlamaParse job id exists — those require TICKET-13/14 (chunker/embedder)
# and TICKET-11 (LlamaParse submission, blocked on LLAMA_CLOUD_API_KEY),
# none of which exist yet. See product.md Worklog for TICKET-32.
# Run: apps/api/scripts/upload-smoke.sh [base_url]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_URL="${1:-http://localhost:8787}"
EMAIL="upload-smoke-$(date +%s)@example.com"
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

# Uploads $1 (fixture path) with content-type $2 and asserts the resulting
# document row's `parser` column equals $3.
assert_parser() {
  local fixture="$1" content_type="$2" expected_parser="$3"
  local upload_body document_id row_json actual_parser actual_status

  upload_body=$(curl -sS -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
    -F "file=@$fixture;type=$content_type")
  document_id=$(echo "$upload_body" | python3 -c "import json,sys; print(json.load(sys.stdin)['documentId'])")
  if [ -z "$document_id" ]; then
    echo "FAIL: no documentId returned for $fixture" >&2
    echo "$upload_body" >&2
    exit 1
  fi

  row_json=$(cd "$SCRIPT_DIR/.." && npx wrangler d1 execute rag-db --local --json --command \
    "SELECT parser, status FROM documents WHERE id = '$document_id';")
  actual_parser=$(echo "$row_json" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['parser'])")
  actual_status=$(echo "$row_json" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['status'])")

  if [ "$actual_parser" != "$expected_parser" ]; then
    echo "FAIL: $fixture routed to parser='$actual_parser', expected '$expected_parser'" >&2
    exit 1
  fi
  echo "    $(basename "$fixture") -> parser=$actual_parser status=$actual_status (documentId=$document_id)"
}

echo "==> Signing up $EMAIL"
curl -sS -c "$COOKIE_JAR" -X POST "$BASE_URL/api/auth/sign-up/email" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"correct-horse-battery-staple\",\"name\":\"Upload Smoke\"}" \
  > /dev/null

echo "==> Uploading fixtures/sample.pdf"
UPLOAD_BODY=$(curl -sS -b "$COOKIE_JAR" -X POST "$BASE_URL/api/documents" \
  -F "file=@$SCRIPT_DIR/../fixtures/sample.pdf;type=application/pdf")

DOCUMENT_ID=$(echo "$UPLOAD_BODY" | python3 -c "import json,sys; print(json.load(sys.stdin)['documentId'])")
if [ -z "$DOCUMENT_ID" ]; then
  echo "FAIL: no documentId returned" >&2
  echo "$UPLOAD_BODY" >&2
  exit 1
fi
echo "    documentId: $DOCUMENT_ID"

echo "==> Confirming row via /api/documents/$DOCUMENT_ID is not yet exposed (TICKET-12); checking D1 directly"
cd "$SCRIPT_DIR/.."
ROW_JSON=$(npx wrangler d1 execute rag-db --local --json --command \
  "SELECT tenant_id, r2_key, status FROM documents WHERE id = '$DOCUMENT_ID';")
TENANT_ID=$(echo "$ROW_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['tenant_id'])")
R2_KEY=$(echo "$ROW_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['results'][0]['r2_key'])")

if [ -z "$TENANT_ID" ] || [ "$TENANT_ID" = "None" ]; then
  echo "FAIL: document row has no tenant_id" >&2
  exit 1
fi
if [ -z "$R2_KEY" ] || [ "$R2_KEY" = "None" ]; then
  echo "FAIL: document row has no r2_key" >&2
  exit 1
fi
echo "    tenant_id: $TENANT_ID"
echo "    r2_key: $R2_KEY"

echo "==> Confirming R2 object exists locally"
if ! npx wrangler r2 object get "rag-uploads/$R2_KEY" --local --pipe > /tmp/upload-smoke-r2-object 2>/dev/null; then
  echo "FAIL: r2 object get failed for $R2_KEY" >&2
  exit 1
fi
if [ ! -s /tmp/upload-smoke-r2-object ]; then
  echo "FAIL: r2 object is empty" >&2
  exit 1
fi
rm -f /tmp/upload-smoke-r2-object
echo "    object present in R2"

echo "==> Rejecting oversized upload"
head -c $((100 * 1024 * 1024 + 1)) /dev/zero > /tmp/upload-smoke-oversize.pdf
OVERSIZE_STATUS=$(curl -sS -b "$COOKIE_JAR" -o /tmp/upload-smoke-oversize-body.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/documents" \
  -F "file=@/tmp/upload-smoke-oversize.pdf;type=application/pdf;filename=oversize.pdf")
rm -f /tmp/upload-smoke-oversize.pdf
if [ "${OVERSIZE_STATUS:0:1}" != "4" ]; then
  echo "FAIL: oversize upload returned $OVERSIZE_STATUS, expected 4xx" >&2
  cat /tmp/upload-smoke-oversize-body.json >&2
  exit 1
fi
echo "    $OVERSIZE_STATUS as expected: $(cat /tmp/upload-smoke-oversize-body.json)"
rm -f /tmp/upload-smoke-oversize-body.json

echo "==> Rejecting wrong file type"
echo '#!/bin/sh' > /tmp/upload-smoke-wrong.exe
WRONGTYPE_STATUS=$(curl -sS -b "$COOKIE_JAR" -o /tmp/upload-smoke-wrongtype-body.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/documents" \
  -F "file=@/tmp/upload-smoke-wrong.exe;type=application/octet-stream")
rm -f /tmp/upload-smoke-wrong.exe
if [ "${WRONGTYPE_STATUS:0:1}" != "4" ]; then
  echo "FAIL: wrong-type upload returned $WRONGTYPE_STATUS, expected 4xx" >&2
  cat /tmp/upload-smoke-wrongtype-body.json >&2
  exit 1
fi
echo "    $WRONGTYPE_STATUS as expected: $(cat /tmp/upload-smoke-wrongtype-body.json)"
rm -f /tmp/upload-smoke-wrongtype-body.json

echo "==> Rejecting an oversized .txt (never falls back to LlamaParse, so it's rejected outright)"
head -c $((20 * 1024 * 1024 + 1)) /dev/zero > /tmp/upload-smoke-oversize.txt
OVERSIZE_TXT_STATUS=$(curl -sS -b "$COOKIE_JAR" -o /tmp/upload-smoke-oversize-txt-body.json -w "%{http_code}" \
  -X POST "$BASE_URL/api/documents" \
  -F "file=@/tmp/upload-smoke-oversize.txt;type=text/plain")
rm -f /tmp/upload-smoke-oversize.txt
if [ "${OVERSIZE_TXT_STATUS:0:1}" != "4" ]; then
  echo "FAIL: oversized .txt upload returned $OVERSIZE_TXT_STATUS, expected 4xx" >&2
  cat /tmp/upload-smoke-oversize-txt-body.json >&2
  exit 1
fi
echo "    $OVERSIZE_TXT_STATUS as expected: $(cat /tmp/upload-smoke-oversize-txt-body.json)"
rm -f /tmp/upload-smoke-oversize-txt-body.json

echo "==> TICKET-32 triage router: local vs. LlamaParse routing"
assert_parser "$SCRIPT_DIR/../fixtures/sample.csv" "text/csv" "local"
assert_parser "$SCRIPT_DIR/../fixtures/digital.pdf" "application/pdf" "local"
assert_parser "$SCRIPT_DIR/../fixtures/scanned.pdf" "application/pdf" "llamaparse"

echo "PASS"
