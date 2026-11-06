#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "======================================================================"
echo "  Starting RedTeamer Backend API Server on http://127.0.0.1:8000"
echo "======================================================================"
echo "Keep this terminal window open while using the web UI."
echo "Press Ctrl+C in this window when you want to stop the backend."
echo ""

if [ -f "./.venv/Scripts/python.exe" ]; then
    ./.venv/Scripts/python.exe server.py
elif [ -f "./.venv/bin/python" ]; then
    ./.venv/bin/python server.py
else
    python3 server.py
fi

