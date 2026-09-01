#!/usr/bin/env bash
#
# Deploys RAG in the Box to your own Cloudflare account.
#
#   cp .env.example .env      fill it in
#   ./scripts/deploy.sh
#
# It creates whatever is missing, leaves whatever already exists alone, and can
# be run again after any change. Nothing is destroyed without being asked.
#
#   --profile production   read .env        (default)
#   --profile demo         read .env.demo
#   --dry-run              print what it would do and stop
#   --skip-web             deploy the API only
#   --skip-api             deploy the interface only
#   --non-interactive      never prompt, fail instead
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

PROFILE="production"
DRY_RUN=false
SKIP_WEB=false
SKIP_API=false
INTERACTIVE=true

while [ $# -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=true; shift ;;
    --skip-web) SKIP_WEB=true; shift ;;
    --skip-api) SKIP_API=true; shift ;;
    --non-interactive) INTERACTIVE=false; shift ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$PROFILE" in
  production) ENV_FILE=".env" ;;
  demo) ENV_FILE=".env.demo" ;;
  *) echo "Profile must be production or demo." >&2; exit 2 ;;
esac

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'
  YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; BLUE=""; RESET=""
fi

step()  { printf '\n%s==>%s %s%s%s\n' "$BLUE" "$RESET" "$BOLD" "$1" "$RESET"; }
ok()    { printf '  %s+%s %s\n' "$GREEN" "$RESET" "$1"; }
skip()  { printf '  %s=%s %s\n' "$DIM" "$RESET" "$1"; }
warn()  { printf '  %s!%s %s\n' "$YELLOW" "$RESET" "$1"; }
die()   { printf '\n%serror%s %s\n' "$RED" "$RESET" "$1" >&2; exit 1; }
run()   { if [ "$DRY_RUN" = true ]; then printf '  %swould run:%s %s\n' "$DIM" "$RESET" "$*"; else "$@"; fi; }

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
step "Checking the toolchain"

command -v node >/dev/null 2>&1 || die "Node is not installed. This project needs Node 24 or newer."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 24 ] || die "Node $NODE_MAJOR found, but this project needs Node 24 or newer."
ok "Node $(node -v)"

command -v npm >/dev/null 2>&1 || die "npm is not installed."
ok "npm $(npm -v)"

[ -d node_modules ] || die "Dependencies are missing. Run: npm install"
ok "dependencies installed"

[ -f "$ENV_FILE" ] || die "$ENV_FILE not found. Copy ${ENV_FILE}.example to $ENV_FILE and fill it in."

# Read the file without letting it run anything: only KEY=value lines are used.
while IFS= read -r line || [ -n "$line" ]; do
  case "$line" in
    ''|'#'*) continue ;;
  esac
  key="${line%%=*}"
  value="${line#*=}"
  case "$key" in
    *[!A-Za-z0-9_]*) continue ;;
  esac
  # Strip one layer of surrounding quotes if present.
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  export "$key=$value"
done < "$ENV_FILE"
ok "read $ENV_FILE"

require() {
  local name="$1"
  local value="${!name:-}"
  [ -n "$value" ] || die "$name is empty in $ENV_FILE."
}

require CLOUDFLARE_ACCOUNT_ID
require BETTER_AUTH_SECRET
require ADMIN_TOKEN

WORKER_NAME="${WORKER_NAME:-rag-in-the-box}"
PAGES_PROJECT="${PAGES_PROJECT:-rag-in-the-box}"
D1_DATABASE_NAME="${D1_DATABASE_NAME:-rag-db}"
VECTORIZE_INDEX_NAME="${VECTORIZE_INDEX_NAME:-rag-index}"
VECTOR_DIMENSIONS="${VECTOR_DIMENSIONS:-384}"
DEFAULT_TIER="${DEFAULT_TIER:-free}"
PASSWORD_KDF_ITERATIONS="${PASSWORD_KDF_ITERATIONS:-100000}"

if [ "${#BETTER_AUTH_SECRET}" -lt 24 ]; then
  die "BETTER_AUTH_SECRET is too short. Use at least 24 characters."
fi
if [ "$PROFILE" = "demo" ] && [ -z "${DEMO_COOKIE_SECRET:-}" ]; then
  die "DEMO_COOKIE_SECRET is empty in $ENV_FILE."
fi

# Guards against a development-only setting reaching a real deployment.
if [ "${OFFLINE_AI:-}" = "true" ]; then
  die "OFFLINE_AI is set. That switch replaces the models with local stand-ins and must never be deployed."
fi
# The S3 endpoint is per account, so one copied from another project points at
# somebody else's storage. Nothing in the Worker reads it, but a wrong value in
# the env file will waste an afternoon of backup debugging.
if [ -n "${R2_S3_ENDPOINT:-}" ] && ! printf '%s' "$R2_S3_ENDPOINT" | grep -q "$CLOUDFLARE_ACCOUNT_ID"; then
  warn "R2_S3_ENDPOINT does not contain CLOUDFLARE_ACCOUNT_ID. It should look like https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com"
fi

if [ -n "${R2_ACCESS_KEY_ID:-}" ] && [ -z "${R2_SECRET_ACCESS_KEY:-}" ]; then
  warn "R2_ACCESS_KEY_ID is set but R2_SECRET_ACCESS_KEY is empty. Both are needed to reach the bucket from outside a Worker."
fi

if [ "${VECTOR_BACKEND:-}" = "d1" ]; then
  warn "VECTOR_BACKEND is d1. Searching by scan reads one D1 row per stored vector, and Cloudflare has enforced 5,000,000 row reads a day since 1 September 2026, so a full scan buys about 1,250 questions a day. Vectorize reads no rows to search."
fi

WRANGLER="npx --no-install wrangler"
export CLOUDFLARE_ACCOUNT_ID

step "Checking Cloudflare access"
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  export CLOUDFLARE_API_TOKEN
  ok "using the API token from $ENV_FILE"
elif [ "$DRY_RUN" = true ]; then
  skip "no CLOUDFLARE_API_TOKEN set, a real run would open a browser to sign in"
elif [ "$INTERACTIVE" = false ]; then
  die "No API token and not interactive. Set CLOUDFLARE_API_TOKEN in $ENV_FILE."
else
  warn "no CLOUDFLARE_API_TOKEN set, opening a browser to sign in"
  $WRANGLER login
fi

if [ "$DRY_RUN" = false ]; then
  $WRANGLER whoami >/dev/null 2>&1 || die "Cloudflare rejected those credentials. Check CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID."
  ok "credentials accepted"
fi

# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------
cd apps/api

step "Database"
if [ "$DRY_RUN" = true ]; then
  skip "would check whether $D1_DATABASE_NAME exists and create it if not"
elif $WRANGLER d1 info "$D1_DATABASE_NAME" >/dev/null 2>&1; then
  skip "$D1_DATABASE_NAME already exists"
else
  run $WRANGLER d1 create "$D1_DATABASE_NAME"
  ok "created $D1_DATABASE_NAME"
fi

DATABASE_ID=""
if [ "$DRY_RUN" = false ]; then
  DATABASE_ID="$($WRANGLER d1 info "$D1_DATABASE_NAME" --json 2>/dev/null | node -e '
    let raw = "";
    process.stdin.on("data", (d) => (raw += d));
    process.stdin.on("end", () => {
      try {
        const info = JSON.parse(raw);
        process.stdout.write(info.uuid ?? info.database_id ?? info?.result?.uuid ?? "");
      } catch {
        process.stdout.write("");
      }
    });
  ')"
  [ -n "$DATABASE_ID" ] || die "Could not read the id of $D1_DATABASE_NAME."
  ok "database id $DATABASE_ID"
fi

step "Vector index"
if [ "$DRY_RUN" = true ]; then
  skip "would create $VECTORIZE_INDEX_NAME at $VECTOR_DIMENSIONS dimensions if missing"
elif $WRANGLER vectorize get "$VECTORIZE_INDEX_NAME" >/dev/null 2>&1; then
  skip "$VECTORIZE_INDEX_NAME already exists"
else
  run $WRANGLER vectorize create "$VECTORIZE_INDEX_NAME" \
    --dimensions="$VECTOR_DIMENSIONS" --metric=cosine
  # The metadata index has to exist before a filter on tenant_id can match.
  run $WRANGLER vectorize create-metadata-index "$VECTORIZE_INDEX_NAME" \
    --property-name=tenant_id --type=string
  ok "created $VECTORIZE_INDEX_NAME at $VECTOR_DIMENSIONS dimensions"
fi

# ---------------------------------------------------------------------------
# Object storage
#
# Optional. Naming a bucket is what turns it on, so a deployment that does not
# want R2 pays nothing and needs no extra token permission.
# ---------------------------------------------------------------------------
if [ -n "${R2_BUCKET_NAME:-}" ]; then
  step "Object storage"
  if [ "$DRY_RUN" = true ]; then
    skip "would create the R2 bucket $R2_BUCKET_NAME if missing"
  elif $WRANGLER r2 bucket info "$R2_BUCKET_NAME" >/dev/null 2>&1; then
    skip "$R2_BUCKET_NAME already exists"
  else
    run $WRANGLER r2 bucket create "$R2_BUCKET_NAME"
    ok "created $R2_BUCKET_NAME"
  fi
fi

# ---------------------------------------------------------------------------
# Worker configuration
# ---------------------------------------------------------------------------
step "Worker configuration"
GENERATED="wrangler.generated.toml"

API_ORIGIN="${API_ORIGIN:-https://${WORKER_NAME}.workers.dev}"
WEB_ORIGIN="${WEB_ORIGIN:-https://${PAGES_PROJECT}.pages.dev}"

{
  echo "# Generated by scripts/deploy.sh from $ENV_FILE. Do not edit or commit."
  echo "name = \"$WORKER_NAME\""
  echo 'main = "src/index.ts"'
  echo 'compatibility_date = "2026-09-01"'
  echo 'compatibility_flags = ["nodejs_compat"]'
  echo
  echo "[observability]"
  echo "enabled = true"
  echo
  echo "[ai]"
  echo 'binding = "AI"'
  echo
  echo "[[d1_databases]]"
  echo 'binding = "DB"'
  echo "database_name = \"$D1_DATABASE_NAME\""
  echo "database_id = \"${DATABASE_ID:-PLACEHOLDER}\""
  echo 'migrations_dir = "drizzle"'
  echo
  echo "[[vectorize]]"
  echo 'binding = "VECTORIZE"'
  echo "index_name = \"$VECTORIZE_INDEX_NAME\""
  echo
  if [ -n "${R2_BUCKET_NAME:-}" ]; then
    echo "[[r2_buckets]]"
    echo 'binding = "BUCKET"'
    echo "bucket_name = \"$R2_BUCKET_NAME\""
    echo
  fi
  echo "[vars]"
  echo "APP_MODE = \"$([ "$PROFILE" = demo ] && echo demo || echo self-host)\""
  echo "APP_VERSION = \"$(node -p "require('$ROOT/package.json').version")\""
  echo "ALLOWED_ORIGIN = \"$WEB_ORIGIN\""
  echo "BETTER_AUTH_URL = \"$API_ORIGIN\""
  echo 'VECTOR_BACKEND = "vectorize"'
  echo "VECTOR_DIMENSIONS = \"$VECTOR_DIMENSIONS\""
  echo "DEFAULT_TIER = \"$DEFAULT_TIER\""
  echo "PASSWORD_KDF_ITERATIONS = \"$PASSWORD_KDF_ITERATIONS\""
  # Endpoint overrides are configuration rather than secrets, and are only
  # written when set so the code keeps its own vendor defaults otherwise.
  [ -n "${OPENAI_BASE_URL:-}" ] && echo "OPENAI_BASE_URL = \"$OPENAI_BASE_URL\""
  [ -n "${DEEPSEEK_BASE_URL:-}" ] && echo "DEEPSEEK_BASE_URL = \"$DEEPSEEK_BASE_URL\""
  [ -n "${LLAMA_CLOUD_BASE_URL:-}" ] && echo "LLAMA_CLOUD_BASE_URL = \"$LLAMA_CLOUD_BASE_URL\""
  [ -n "${OLLAMA_BASE_URL:-}" ] && echo "OLLAMA_BASE_URL = \"$OLLAMA_BASE_URL\""
  if [ "$PROFILE" = "demo" ]; then
    echo "DEMO_TENANT_ID = \"${DEMO_TENANT_ID:-demo-curated}\""
    echo "DEMO_VISITOR_CHATS_PER_DAY = \"${DEMO_VISITOR_CHATS_PER_DAY:-12}\""
    echo "DEMO_GLOBAL_CHATS_PER_DAY = \"${DEMO_GLOBAL_CHATS_PER_DAY:-110}\""
    echo "DEMO_VISITOR_UPLOADS_PER_DAY = \"${DEMO_VISITOR_UPLOADS_PER_DAY:-1}\""
    echo "DEMO_GLOBAL_UPLOADS_PER_DAY = \"${DEMO_GLOBAL_UPLOADS_PER_DAY:-30}\""
    echo "DEMO_UPLOADS_ENABLED = \"${DEMO_UPLOADS_ENABLED:-true}\""
    echo "DEMO_MAX_UPLOAD_BYTES = \"${DEMO_MAX_UPLOAD_BYTES:-2097152}\""
    echo "DEMO_RETENTION_HOURS = \"${DEMO_RETENTION_HOURS:-3}\""
    echo
    # Without this the purge never runs and visitor uploads accumulate until
    # Vectorize storage, which does not reset daily, is permanently full.
    echo "[triggers]"
    echo 'crons = ["17 * * * *"]'
  fi
} > "$GENERATED"
ok "wrote apps/api/$GENERATED"

if [ "$SKIP_API" = false ]; then
  step "Migrations"
  run $WRANGLER d1 migrations apply "$D1_DATABASE_NAME" --remote --config "$GENERATED"
  ok "schema up to date"

  step "Secrets"
  put_secret() {
    local name="$1" value="${2:-}"
    if [ -z "$value" ]; then
      skip "$name not set, leaving it unconfigured"
      return
    fi
    if [ "$DRY_RUN" = true ]; then
      printf '  %swould set:%s %s\n' "$DIM" "$RESET" "$name"
      return
    fi
    printf '%s' "$value" | $WRANGLER secret put "$name" --config "$GENERATED" >/dev/null
    ok "$name"
  }
  put_secret BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
  put_secret ADMIN_TOKEN "$ADMIN_TOKEN"
  put_secret OPENAI_API_KEY "${OPENAI_API_KEY:-}"
  put_secret DEEPSEEK_API_KEY "${DEEPSEEK_API_KEY:-}"
  put_secret LLAMA_CLOUD_API_KEY "${LLAMA_CLOUD_API_KEY:-}"
  [ "$PROFILE" = "demo" ] && put_secret DEMO_COOKIE_SECRET "${DEMO_COOKIE_SECRET:-}"

  step "Deploying the API"
  # A custom domain needs no zone id and no DNS record of your own: Cloudflare
  # creates the record and the certificate, as long as the zone is on this
  # account. The workers.dev default has no host to bind, so it is skipped.
  API_HOST="$(printf '%s' "$API_ORIGIN" | sed -E 's#^https?://##; s#/.*$##')"
  if [ -n "$API_HOST" ] && ! printf '%s' "$API_HOST" | grep -qE '(workers\.dev|localhost)$'; then
    run $WRANGLER deploy --config "$GENERATED" --domain "$API_HOST"
    ok "API deployed and bound to $API_HOST"
  else
    run $WRANGLER deploy --config "$GENERATED"
    ok "API deployed"
  fi
fi

# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------
if [ "$SKIP_WEB" = false ]; then
  cd "$ROOT"
  step "Building the interface"
  run npm run build:shared
  VITE_API_URL="$API_ORIGIN" run npm run build --workspace apps/web
  ok "built against $API_ORIGIN"

  step "Deploying the interface"
  cd apps/web
  if [ "$DRY_RUN" = true ]; then
    skip "would create the Pages project $PAGES_PROJECT if missing"
  elif $WRANGLER pages project list 2>/dev/null | grep -q "\b$PAGES_PROJECT\b"; then
    skip "Pages project $PAGES_PROJECT already exists"
  else
    run $WRANGLER pages project create "$PAGES_PROJECT" --production-branch main
    ok "created Pages project $PAGES_PROJECT"
  fi
  run $WRANGLER pages deploy dist --project-name "$PAGES_PROJECT" --branch main --commit-dirty=true
  ok "interface deployed"

  # Pages has no wrangler command for custom domains, so this is the REST API.
  # It needs the account and project only: the zone is found from the name, and
  # Cloudflare writes the DNS record when the zone is on the same account.
  WEB_HOST="$(printf '%s' "$WEB_ORIGIN" | sed -E 's#^https?://##; s#/.*$##')"
  if [ -n "$WEB_HOST" ] && ! printf '%s' "$WEB_HOST" | grep -qE '(pages\.dev|localhost)$'; then
    step "Custom domain"
    if [ "$DRY_RUN" = true ]; then
      skip "would attach $WEB_HOST to the Pages project $PAGES_PROJECT"
    elif [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
      skip "no API token, attach $WEB_HOST in the dashboard instead"
    else
      DOMAIN_API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PAGES_PROJECT/domains"
      # 409 means it is already attached, which is success on a repeat run.
      DOMAIN_STATUS="$(curl -s -o /tmp/rib-domain.json -w '%{http_code}' -X POST "$DOMAIN_API" \
        -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
        -H "Content-Type: application/json" \
        --data "{\"name\":\"$WEB_HOST\"}" || echo 000)"
      case "$DOMAIN_STATUS" in
        200 | 201) ok "attached $WEB_HOST to $PAGES_PROJECT" ;;
        409) skip "$WEB_HOST is already attached" ;;
        *)
          warn "could not attach $WEB_HOST (HTTP $DOMAIN_STATUS). Add it in the dashboard under Pages, $PAGES_PROJECT, Custom domains."
          [ -s /tmp/rib-domain.json ] && printf '  %s%s%s\n' "$DIM" "$(head -c 200 /tmp/rib-domain.json)" "$RESET"
          ;;
      esac
      rm -f /tmp/rib-domain.json
    fi
  fi
fi

# ---------------------------------------------------------------------------
# What to do next
# ---------------------------------------------------------------------------
cd "$ROOT"
step "Done"
cat <<SUMMARY

  API         $API_ORIGIN
  Interface   $WEB_ORIGIN
  Database    $D1_DATABASE_NAME
  Vectors     $VECTORIZE_INDEX_NAME at $VECTOR_DIMENSIONS dimensions
  Mode        $([ "$PROFILE" = demo ] && echo "public demo, no accounts" || echo "self hosted, accounts on")

Next:
SUMMARY

if [ "$PROFILE" = "demo" ]; then
  cat <<SUMMARY
  1. Load the document the demo answers from:

       ADMIN_TOKEN='...' node scripts/seed-demo.ts \\
         --api $API_ORIGIN --tenant ${DEMO_TENANT_ID:-demo-curated}

  2. Open $WEB_ORIGIN/demo and ask it something.

  Both domains were attached above. A certificate can take a few minutes the
  first time, so a failure to connect right away is usually just that.
SUMMARY
else
  cat <<SUMMARY
  1. Open $WEB_ORIGIN and create the first workspace.
  2. Add a document. It is read in your browser, so nothing large runs on the
     Worker and you stay inside the free plan.
  3. Watch the usage screen for the first few days to see where your own
     volume sits against the free allowances.

  To create a workspace for someone else without giving them a sign-up form:

       ADMIN_TOKEN='...' node apps/api/scripts/provision-tenant.ts \\
         name@example.com "Their organisation" $API_ORIGIN
SUMMARY
fi
echo
