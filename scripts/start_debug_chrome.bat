@echo off
chcp 65001 >nul
title Xiaohongshu Debug Chrome - company-soft-review
setlocal

set "CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" set "CHROME=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
if not exist "%CHROME%" (
  echo [ERROR] Chrome not found. Check installation path.
  pause
  exit /b 1
)

set "PROF=%LOCALAPPDATA%\xhs_debug_prof"

echo ============================================
echo   Xiaohongshu Debug Chrome  (login launcher)
echo   Debug port : 9222
echo   Profile    : %PROF%
echo ============================================
echo.
echo Launching an INDEPENDENT Chrome instance...
echo (Your normal Chrome windows are not affected)
echo.

start "" "%CHROME%" ^
 --remote-debugging-port=9222 ^
 --user-data-dir="%PROF%" ^
 --no-first-run ^
 --no-default-browser-check ^
 --disable-blink-features=AutomationControlled ^
 --start-maximized ^
 "https://www.xiaohongshu.com/explore"

echo Waiting for debug port to come up...
set /a tries=0

:waitloop
set /a tries+=1
curl -s --max-time 3 http://127.0.0.1:9222/json/version >nul 2>&1
if %errorlevel%==0 goto ready
if %tries% GEQ 15 goto notready
timeout /t 2 >nul
goto waitloop

:ready
echo.
echo [OK] Debug port 9222 is UP.  (took %tries% checks)
echo.
echo --------------------------------------------
echo  NEXT STEPS
echo   1. A new Chrome window is now open
echo   2. Scan the QR code to log in to Xiaohongshu
echo   3. Come back to WorkBuddy and tell the assistant
echo --------------------------------------------
echo.
echo Keep this window open (minimize is fine).
echo Do NOT close the Chrome window.
echo.
pause
exit /b 0

:notready
echo.
echo [WARN] Debug port did not come up within 30 seconds.
echo.
echo Possible reasons:
echo   - Chrome is still starting, wait a few seconds and check manually
echo   - Another app occupies port 9222
echo.
echo Try closing Chrome completely, then run this script again.
echo.
pause
exit /b 2
