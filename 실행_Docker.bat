@echo off
title Wedding Photo Select (Docker)

echo =======================================================
echo   Starting Wedding Photo Select with Docker...
echo =======================================================
echo.

where docker >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Docker is not running or not installed.
    echo Please start Docker Desktop or install Node.js (https://nodejs.org).
    echo.
    pause
    exit /b
)

docker run --rm -it -p 3000:3000 -v "%cd%":/app -w /app node:24-alpine node server.js

pause
