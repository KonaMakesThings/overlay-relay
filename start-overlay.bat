@echo off
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "foreach($p in 8080..8099){ try { $v=Invoke-RestMethod -Uri ('http://localhost:{0}/api/version' -f $p) -TimeoutSec 1; if($v.name -eq 'twitch-chat-overlay-helper'){ Invoke-RestMethod -Uri ('http://localhost:{0}/api/shutdown' -f $p) -Method Post -TimeoutSec 1 | Out-Null } } catch {} }"
if exist overlay-server.pid del overlay-server.pid >nul 2>nul
start "" powershell -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "Start-Sleep -Seconds 1; Start-Process 'http://localhost:8080/control'"
node server.js
pause
