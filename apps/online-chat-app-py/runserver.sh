#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

uv run uvicorn chat_api.asgi:application \
  --host 127.0.0.1 \
  --port 8000 \
  --reload
