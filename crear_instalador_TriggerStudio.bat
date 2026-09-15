@echo off
setlocal enabledelayedexpansion
title TriggerStudio - Creador de Instalador y Actualizador
color 0B

echo ================================================================
echo         TRIGGERSTUDIO - CREADOR DE INSTALADOR Y ACTUALIZADOR
echo ================================================================
echo.

cd /d "%~dp0"
set "ROOT_DIR=%~dp0"
set "INSTALLED_DIR=D:\Archivos de programa\TriggerStudio"
set "CLIENT_DIR=%ROOT_DIR%client_extracted"
set "SERVER_DIR=%ROOT_DIR%server"
set "OUTPUT_DIR=%ROOT_DIR%Instalador_TriggerStudio"

:: 1. Verificar si Node.js y npm estan disponibles
echo [1/6] Verificando entorno Node.js...
where node >nul 2>&1
if errorlevel 1 (
    color 0C
    echo [ERROR] Node.js no esta instalado o no se encuentra en el PATH.
    echo Por favor instala Node.js para continuar.
    pause
    exit /b 1
)
echo       [OK] Node.js detectado.

:: 2. Cerrar TriggerStudio si se encuentra en ejecucion para no bloquear archivos
echo.
echo [2/6] Verificando si TriggerStudio esta abierto...
tasklist /FI "IMAGENAME eq TriggerStudio.exe" 2>nul | find /I "TriggerStudio.exe" >nul
if not errorlevel 1 (
    echo       Cerrando TriggerStudio.exe para desbloquear recursos...
    taskkill /F /IM TriggerStudio.exe >nul 2>&1
    timeout /t 2 /nobreak >nul
) else (
    echo       [OK] TriggerStudio no esta en ejecucion.
)

:: 3. Sincronizar interfaz moderna y parches desde server/public a client_extracted/dist
echo.
echo [3/6] Sincronizando interfaz moderna a client_extracted...
if not exist "%CLIENT_DIR%\dist" mkdir "%CLIENT_DIR%\dist"
copy /Y "%SERVER_DIR%\public\index.html" "%CLIENT_DIR%\dist\index.html" >nul
if errorlevel 1 (
    color 0C
    echo [ERROR] No se pudo copiar index.html a client_extracted\dist.
    pause
    exit /b 1
)
echo       [OK] Interfaz y componentes sincronizados.

:: 4. Empaquetar client_extracted en nuevo app.asar con @electron/asar
echo.
echo [4/6] Empaquetando app.asar con @electron/asar...
set "TEMP_ASAR=%ROOT_DIR%app_nuevo.asar"
if exist "%TEMP_ASAR%" del /F /Q "%TEMP_ASAR%" >nul 2>&1

call npx @electron/asar pack "%CLIENT_DIR%" "%TEMP_ASAR%"
if not exist "%TEMP_ASAR%" (
    color 0C
    echo [ERROR] Fallo el empaquetado de app.asar.
    pause
    exit /b 1
)
echo       [OK] app.asar generado con exito.

:: 5. Actualizar aplicacion instalada si existe
echo.
echo [5/6] Actualizando TriggerStudio en el sistema...
if exist "%INSTALLED_DIR%\resources" (
    if not exist "%INSTALLED_DIR%\resources\app.asar.original" (
        copy /Y "%INSTALLED_DIR%\resources\app.asar" "%INSTALLED_DIR%\resources\app.asar.original" >nul 2>&1
    )
    copy /Y "%TEMP_ASAR%" "%INSTALLED_DIR%\resources\app.asar" >nul
    if errorlevel 1 (
        echo [ALERTA] No se pudo sobrescribir directamente en "%INSTALLED_DIR%\resources\app.asar". Asegurate de tener permisos de administrador.
    ) else (
        echo       [OK] Aplicacion instalada en "%INSTALLED_DIR%" actualizada correctamente.
    )
) else (
    echo       [INFO] No se encontro "%INSTALLED_DIR%". Saltando actualizacion directa.
)

:: 6. Crear paquete instalador / portable listo para distribuir
echo.
echo [6/6] Creando carpeta instalador portable...
if not exist "%OUTPUT_DIR%" mkdir "%OUTPUT_DIR%"

if exist "%INSTALLED_DIR%" (
    echo       Copiando binarios ejecutables de TriggerStudio...
    robocopy "%INSTALLED_DIR%" "%OUTPUT_DIR%" /E /XF "app.asar" "app.asar.original" "app.asar.bak" /NDL /NFL /NJH /NJS /nc /ns /np >nul
    if not exist "%OUTPUT_DIR%\resources" mkdir "%OUTPUT_DIR%\resources"
    copy /Y "%TEMP_ASAR%" "%OUTPUT_DIR%\resources\app.asar" >nul
    echo       [OK] Paquete portable listo en:
    echo            "%OUTPUT_DIR%"
) else (
    copy /Y "%TEMP_ASAR%" "%OUTPUT_DIR%\app.asar" >nul
    echo       [OK] app.asar guardado en "%OUTPUT_DIR%".
)

:: Limpiar temporal
if exist "%TEMP_ASAR%" del /F /Q "%TEMP_ASAR%" >nul 2>&1

echo.
echo ================================================================
echo              COMPILACION Y ACTUALIZACION FINALIZADA
echo ================================================================
echo.
echo  - Aplicacion instalada: ACTUALIZADA AL 100%%
echo  - Copia portable lista: "%OUTPUT_DIR%"
echo.
set /p LANZAR="Deseas iniciar TriggerStudio ahora mismo? (S/N): "
if /I "!LANZAR!"=="S" (
    if exist "%INSTALLED_DIR%\TriggerStudio.exe" (
        start "" "%INSTALLED_DIR%\TriggerStudio.exe"
    ) else if exist "%OUTPUT_DIR%\TriggerStudio.exe" (
        start "" "%OUTPUT_DIR%\TriggerStudio.exe"
    )
)

echo.
echo Presiona cualquier tecla para salir...
pause >nul
