#!/usr/bin/env bash
#
# Pulls the models the local stack expects.
#
# Works against Ollama in Docker or installed directly on the host, because it
# talks to the HTTP API rather than the CLI. Safe to run repeatedly: Ollama
# skips a model it already has.

set -euo pipefail

BASE_URL="${OLLAMA_BASE_URL:-http://localhost:11434}"
BASE_URL="${BASE_URL%/}"

# The chat model is the small one on purpose. It answers on a laptop without a
# GPU, which is what makes trying the project cheap. Swap it in the settings
# screen for anything else you have pulled.
MODELS=(
  "all-minilm"
  "llama3.2:3b"
)

if ! curl -fsS --max-time 3 "${BASE_URL}/api/tags" >/dev/null 2>&1; then
  echo "No Ollama server at ${BASE_URL}." >&2
  echo >&2
  echo "Start one with:   docker compose up -d" >&2
  echo "Or install it:    https://ollama.com/download" >&2
  exit 1
fi

for model in "${MODELS[@]}"; do
  echo "Pulling ${model}"
  # The pull endpoint streams progress as newline-delimited JSON. The output is
  # discarded and the exit status is what decides success, so a failure here
  # stops the script rather than leaving a model half absent.
  if ! curl -fsS --max-time 3600 "${BASE_URL}/api/pull" \
    -H 'content-type: application/json' \
    -d "{\"model\":\"${model}\",\"stream\":false}" >/dev/null; then
    echo "Could not pull ${model}." >&2
    exit 1
  fi
  echo "  done"
done

echo
echo "Ready. Add this to apps/api/.dev.vars:"
echo
echo "  OLLAMA_BASE_URL = \"${BASE_URL}\""
echo
echo "Then restart the API and pick the local models in Settings."
