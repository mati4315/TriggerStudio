@echo off
setlocal
cd /d "%~dp0"

:: Si existe la carpeta "server", entramos en ella
if exist server (
  cd server
)

title TriggerStudio - Control Panel

:: ─────────────────────────────────────────────
:: Puerto de la aplicación
:: ─────────────────────────────────────────────
set PORT=2188

:: ─────────────────────────────────────────────
:: Liberar el puerto si ya está en uso
:: ─────────────────────────────────────────────
echo Verificando puerto %PORT%...
for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  echo [INFO] Puerto %PORT% ocupado por PID %%P. Cerrando...
  taskkill /PID %%P /F >nul 2>&1
  timeout /t 1 /nobreak >nul
)
echo [OK] Puerto %PORT% libre.

:: ─────────────────────────────────────────────
:: Verificar .env
:: ─────────────────────────────────────────────
if not exist .env (
  if exist .env.example (
    copy /Y .env.example .env >nul
    echo [OK] Se creo .env desde .env.example
  )
)

:: ─────────────────────────────────────────────
:: Verificar Node.js
:: ─────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js no esta instalado.
  pause
  exit /b 1
)

:: ─────────────────────────────────────────────
:: Instalar dependencias si hace falta
:: ─────────────────────────────────────────────
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install fallo.
    pause
    exit /b 1
  )
)

:: ─────────────────────────────────────────────
:: Compilar TypeScript si no existe la carpeta dist
:: ─────────────────────────────────────────────
if not exist dist (
  echo Compilando codigo TypeScript...
  call npm run build
  if errorlevel 1 (
    echo [ERROR] La compilacion de TypeScript fallo.
    pause
    exit /b 1
  )
)

echo.
echo ===============================================
echo   TriggerStudio corriendo en http://localhost:%PORT%
echo   Control Panel: http://localhost:%PORT%/
echo ===============================================
echo.

:: Abrir el panel de control en el navegador
start http://localhost:%PORT%/

set PORT=%PORT%
call npm start

pause
