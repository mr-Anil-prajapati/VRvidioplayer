#!/data/data/com.termux/files/usr/bin/bash
# VR Video Player & OfflineTube - Startup Script for Termux / Linux
cd "$(dirname "$0")"

# Acquire wake lock on Android Termux
which termux-wake-lock >/dev/null 2>&1 && termux-wake-lock

# Stop previous instance if running
pkill -f "server.py" 2>/dev/null || true
pkill -f "offline_server.py" 2>/dev/null || true
sleep 1

# Start universal server
echo "[OfflineTube] Starting server on http://localhost:8080 ..."
python3 server.py 8080
