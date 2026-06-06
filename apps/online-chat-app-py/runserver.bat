@echo off
setlocal

cd /d "%~dp0"

uv run uvicorn chat_api.asgi:application ^
  --host 127.0.0.1 ^
  --port 8000 ^
  --reload

endlocal
