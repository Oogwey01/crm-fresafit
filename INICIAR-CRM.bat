@echo off
title CRM Fresafit
cd /d "%~dp0"
echo ============================================
echo    Iniciando el CRM de Fresafit...
echo.
echo    Espera a que aparezca la palabra "Ready".
echo    Se abrira solo en tu navegador.
echo.
echo    NO cierres esta ventana mientras lo usas.
echo    Para apagar el CRM: cierra esta ventana.
echo ============================================
echo.
start "" cmd /c "timeout /t 12 /nobreak >nul & start http://localhost:3000"
"C:\Program Files\nodejs\node.exe" "node_modules\next\dist\bin\next" dev
echo.
echo El CRM se detuvo. Puedes cerrar esta ventana.
pause
