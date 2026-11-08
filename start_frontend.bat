@echo off
title RedTeamer Frontend (Port 5173)
cd /d "%~dp0\frontend"

echo ======================================================================
echo   Starting RedTeamer Frontend on http://localhost:5173
echo ======================================================================
echo.

npm run dev

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Frontend exited with error code %ERRORLEVEL%.
    pause
)

