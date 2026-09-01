#!/usr/bin/env bash
#
# Checks that every credential in an env file actually works.
#
#   ./scripts/check-credentials.sh [--file .env.demo]
#
# Nothing secret is printed. Each key is used in a request and only the verdict
# comes back, so the output is safe to paste into an issue or read over a call.
# A credential that is present but rejected is worse than one that is missing,
# because a deployment will start and then fail on the first real request, so
# both are reported and told apart.

set -uo pipefail

ENV_FILE=".env.demo"
while [ $# -gt 0 ]; do
  case "$1" in
    --file) ENV_FILE="$2"; shift 2 ;;
    *) echo "Unknown argument: $1" >&2; exit 1 ;;
  esac
done

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RESET=$'\033[0m'
pass() { printf '  %s✓%s %-22s %s\n' "$GREEN" "$RESET" "$1" "$2"; }
fail() { printf '  %s✗%s %-22s %s\n' "$RED" "$RESET" "$1" "$2"; FAILED=$((FAILED + 1)); }
skip() { printf '  %s–%s %-22s %s%s%s\n' "$DIM" "$RESET" "$1" "$DIM" "$2" "$RESET"; }

FAILED=0

[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE. Copy $ENV_FILE.example and fill it in." >&2; exit 1; }

# Only KEY=value lines, and no eval, so a stray backtick in a secret cannot run.
while IFS= read -r line; do
  case "$line" in
    ''|'#'*) continue ;;
    *=*)
      key="${line%%=*}"
      [[ "$key" =~ ^[A-Z][A-Z0-9_]*$ ]] || continue
      value="${line#*=}"
      value="${value%\"}"; value="${value#\"}"
      export "$key=$value"
      ;;
  esac
done < "$ENV_FILE"

printf '\n%sChecking credentials in %s%s\n\n' "$BOLD" "$ENV_FILE" "$RESET"

# --- Cloudflare -------------------------------------------------------------
printf '%sCloudflare%s\n' "$BOLD" "$RESET"
if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  fail "API token" "not set"
else
  # Deliberately not /user/tokens/verify. That endpoint only understands user
  # tokens and rejects a perfectly good account-scoped token, which is the kind
  # this project asks for. Whether the account answers is the real question.
  if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    skip "API token" "cannot be checked without CLOUDFLARE_ACCOUNT_ID"
  else
    body=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
    if printf '%s' "$body" | grep -qE '"success":[[:space:]]*true'; then
      pass "API token" "accepted by the account"
    else
      msg=$(printf '%s' "$body" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p' | head -1)
      fail "API token" "${msg:-rejected}"
    fi
  fi
fi

if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  fail "Account id" "not set"
fi

# The token needs specific permissions, and a token that verifies can still be
# missing one. Each is checked by asking for the thing it guards.
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  probe() {
    local label="$1" path="$2"
    local body
    body=$(curl -s "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/$path" \
      -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN")
    if printf '%s' "$body" | grep -qE '"success":[[:space:]]*true'; then
      pass "$label" "permitted"
    else
      local msg
      msg=$(printf '%s' "$body" | sed -n 's/.*"message":"\([^"]*\)".*/\1/p' | head -1)
      fail "$label" "${msg:-refused}"
    fi
  }
  probe "Workers permission" "workers/scripts"
  probe "D1 permission" "d1/database"
  probe "Vectorize permission" "vectorize/v2/indexes"
  probe "Pages permission" "pages/projects"
  probe "R2 permission" "r2/buckets"
fi

# --- Model providers --------------------------------------------------------
printf '\n%sModel providers%s\n' "$BOLD" "$RESET"

check_openai_compatible() {
  local label="$1" key="$2" base="$3"
  if [ -z "$key" ]; then skip "$label" "not set"; return; fi
  local code
  code=$(curl -s -o /tmp/cred-body.txt -w '%{http_code}' "$base/models" -H "Authorization: Bearer $key")
  case "$code" in
    200) pass "$label" "valid, $(grep -o '"id"' /tmp/cred-body.txt | wc -l | tr -d ' ') models visible" ;;
    401|403) fail "$label" "rejected, HTTP $code" ;;
    *) fail "$label" "unexpected HTTP $code" ;;
  esac
  rm -f /tmp/cred-body.txt
}

check_openai_compatible "OpenAI" "${OPENAI_API_KEY:-}" "${OPENAI_BASE_URL:-https://api.openai.com/v1}"
check_openai_compatible "DeepSeek" "${DEEPSEEK_API_KEY:-}" "${DEEPSEEK_BASE_URL:-https://api.deepseek.com/v1}"

if [ -z "${LLAMA_CLOUD_API_KEY:-}" ]; then
  skip "LlamaCloud" "not set"
else
  base="${LLAMA_CLOUD_BASE_URL:-https://api.cloud.llamaindex.ai}"
  code=$(curl -s -o /dev/null -w '%{http_code}' "${base%/}/api/v1/parsing/supported_file_extensions" \
    -H "Authorization: Bearer $LLAMA_CLOUD_API_KEY")
  case "$code" in
    200) pass "LlamaCloud" "valid at ${base#https://}" ;;
    401|403) fail "LlamaCloud" "rejected at ${base#https://}, HTTP $code. Keys are region specific" ;;
    *) fail "LlamaCloud" "unexpected HTTP $code from ${base#https://}" ;;
  esac
fi

# --- R2 over the S3 API -----------------------------------------------------
printf '\n%sObject storage%s\n' "$BOLD" "$RESET"
if [ -z "${R2_ACCESS_KEY_ID:-}" ] || [ -z "${R2_SECRET_ACCESS_KEY:-}" ]; then
  skip "R2 S3 credentials" "not set, which is fine unless you want backups"
elif [ -z "${R2_S3_ENDPOINT:-}" ]; then
  fail "R2 S3 credentials" "R2_S3_ENDPOINT is empty, so there is nowhere to send them"
else
  # Signature Version 4 against the endpoint root, which lists buckets.
  host=$(printf '%s' "$R2_S3_ENDPOINT" | sed -E 's#^https?://##; s#/.*$##')
  now=$(date -u +%Y%m%dT%H%M%SZ); today=${now%T*}
  payload_hash=$(printf '' | shasum -a 256 | cut -d' ' -f1)
  canonical="GET\n/\n\nhost:$host\nx-amz-content-sha256:$payload_hash\nx-amz-date:$now\n\nhost;x-amz-content-sha256;x-amz-date\n$payload_hash"
  scope="$today/auto/s3/aws4_request"
  to_sign="AWS4-HMAC-SHA256\n$now\n$scope\n$(printf "$canonical" | shasum -a 256 | cut -d' ' -f1)"
  hmac() { printf "$2" | openssl dgst -sha256 -mac HMAC -macopt "$1" -hex | sed 's/^.*= //'; }
  k1=$(hmac "key:AWS4${R2_SECRET_ACCESS_KEY}" "$today")
  k2=$(hmac "hexkey:$k1" "auto")
  k3=$(hmac "hexkey:$k2" "s3")
  k4=$(hmac "hexkey:$k3" "aws4_request")
  sig=$(hmac "hexkey:$k4" "$to_sign")
  code=$(curl -s -o /dev/null -w '%{http_code}' "$R2_S3_ENDPOINT" \
    -H "Host: $host" -H "x-amz-date: $now" -H "x-amz-content-sha256: $payload_hash" \
    -H "Authorization: AWS4-HMAC-SHA256 Credential=$R2_ACCESS_KEY_ID/$scope, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=$sig")
  case "$code" in
    200) pass "R2 S3 credentials" "valid, buckets listed" ;;
    403) fail "R2 S3 credentials" "rejected, HTTP 403. Check the key and the endpoint account id" ;;
    *) fail "R2 S3 credentials" "unexpected HTTP $code" ;;
  esac
fi

# --- Secrets this deployment generates rather than borrows ------------------
printf '\n%sDeployment secrets%s\n' "$BOLD" "$RESET"
for name in BETTER_AUTH_SECRET ADMIN_TOKEN DEMO_COOKIE_SECRET; do
  value="${!name:-}"
  if [ -z "$value" ]; then
    fail "$name" "empty, generate one with: openssl rand -hex 32"
  elif [ ${#value} -lt 24 ]; then
    fail "$name" "only ${#value} characters, use at least 24"
  else
    pass "$name" "${#value} characters"
  fi
done

printf '\n'
if [ "$FAILED" -eq 0 ]; then
  printf '%sEvery credential checked out.%s\n\n' "$GREEN" "$RESET"
else
  printf '%s%s check(s) failed.%s Fix those before deploying.\n\n' "$YELLOW" "$FAILED" "$RESET"
  exit 1
fi
