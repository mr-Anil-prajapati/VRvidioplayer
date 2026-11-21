#!/data/data/com.termux/files/usr/bin/bash
cd /data/data/com.termux/files/home/offline-youtube
pkill -f "offline_server.py" 2>/dev/null || true
sleep 1
nohup python3 offline_server.py 8080 > server.log 2>&1 &
sleep 2
echo "=== Server Log ==="
cat server.log
echo "=== Testing API Status ==="
curl -s http://localhost:8080/api/status
echo ""
