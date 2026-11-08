@echo off
title RedTeamer Backend API (Port 8000)
cd /d "%~dp0"

echo ======================================================================
echo   Starting RedTeamer Backend API Server on http://127.0.0.1:8000
echo ======================================================================
echo.
echo Keep this terminal window open while using the web UI.
echo Press Ctrl+C in this window when you want to stop the backend.
echo.

if exist ".venv\Scripts\python.exe" (
    ".venv\Scripts\python.exe" server.py
) else (
    python server.py
)

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Backend process exited with error code %ERRORLEVEL%.
    pause
)

