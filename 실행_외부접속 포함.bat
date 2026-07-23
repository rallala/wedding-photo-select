@echo off
title Wedding Photo Select (External Access)

set "NODE_CMD=node"
where node >nul 2>nul
if %ERRORLEVEL%==0 goto RUN

if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_CMD=C:\Program Files\nodejs\node.exe"
    goto RUN
)

if exist "%LOCALAPPDATA%\Programs\node\node.exe" (
    set "NODE_CMD=%LOCALAPPDATA%\Programs\node\node.exe"
    goto RUN
)

echo.
echo =======================================================
echo  [Notice] Node.js is not installed on your computer.
echo =======================================================
echo.
echo  To run this program, Node.js is required.
echo.
echo  1. Open web browser: https://nodejs.org
echo  2. Download and install [LTS (Recommended)]
echo  3. After installation, double-click this file again!
echo.
echo =======================================================
echo.
pause
exit /b

:RUN
echo.
echo =======================================================
echo   Starting Wedding Photo Select (External Access)...
echo =======================================================
echo.
set TUNNEL=true
"%NODE_CMD%" "%~dp0server.js"
echo.
pause
