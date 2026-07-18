@echo off
cd /d "%~dp0"
set "OVERLAY_ROOT=%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ports=@(8080); $state=Join-Path $env:OVERLAY_ROOT 'overlay-server.json'; if(Test-Path -LiteralPath $state){ try { $saved=Get-Content -Raw -LiteralPath $state | ConvertFrom-Json; if($saved.port){ $ports=@([int]$saved.port) } } catch {} }; foreach($p in ($ports | Select-Object -Unique)){ try { $v=Invoke-RestMethod -Uri ('http://localhost:{0}/api/version' -f $p) -TimeoutSec 1; if($v.name -eq 'twitch-chat-overlay-helper'){ Invoke-RestMethod -Uri ('http://localhost:{0}/api/shutdown' -f $p) -Method Post -TimeoutSec 1 | Out-Null } } catch {} }"
if exist overlay-server.json del overlay-server.json >nul 2>nul
if exist overlay-server.pid del overlay-server.pid >nul 2>nul
start "" powershell -WindowStyle Hidden -NoProfile -ExecutionPolicy Bypass -Command "$state=Join-Path $env:OVERLAY_ROOT 'overlay-server.json'; for($i=0;$i -lt 50;$i++){ if(Test-Path -LiteralPath $state){ try { $saved=Get-Content -Raw -LiteralPath $state | ConvertFrom-Json; if($saved.port){ Start-Process ('http://localhost:{0}/control' -f [int]$saved.port); exit } } catch {} }; Start-Sleep -Milliseconds 100 }; Start-Process 'http://localhost:8080/control'"
node server.js
pause
