@echo off
setlocal

cd /d "%~dp0"
if not defined JIZURA_PORT set "JIZURA_PORT=8765"
set "JIZURA_URL=http://127.0.0.1:%JIZURA_PORT%/"

where py >nul 2>nul
if %errorlevel% equ 0 (
  set "JIZURA_PYTHON=py -3"
  goto :start
)

where python >nul 2>nul
if %errorlevel% equ 0 (
  set "JIZURA_PYTHON=python"
  goto :start
)

echo JIZURA could not find Python 3.
echo Install Python from https://www.python.org/downloads/ and try again.
pause
exit /b 1

:start
echo Starting JIZURA at %JIZURA_URL%
echo Keep this window open while using the app.
echo Press Ctrl+C to stop the local server.
echo.

if not defined JIZURA_NO_BROWSER start "" "%JIZURA_URL%"
%JIZURA_PYTHON% -m http.server %JIZURA_PORT% --bind 127.0.0.1

if %errorlevel% neq 0 (
  echo.
  echo The local server stopped with an error. Port %JIZURA_PORT% may already be in use.
  pause
  exit /b 1
)

endlocal
