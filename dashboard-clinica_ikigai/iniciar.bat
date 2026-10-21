@echo off
chcp 65001 >nul
title Clínica Ikigai - Inicialização Automática
echo ====================================================================
echo   🏥 CLÍNICA IKIGAI - INICIALIZAÇÃO AUTOMÁTICA EM 1 CLIQUE
echo ====================================================================
echo.

:: 1. Configuração automática do .env se não existir
if not exist "backend\.env" (
    echo [1/3] Configurando arquivo de ambiente local (backend\.env)...
    copy "backend\.env.example" "backend\.env" >nul
    echo       -> Arquivo .env gerado com sucesso com padrões locais!
) else (
    echo [1/3] Arquivo backend\.env já existente. Mantido.
)

:: 2. Instalação das dependências do Backend se necessário
if not exist "backend\node_modules" (
    echo.
    echo [2/3] Instalando pacotes do Backend (npm install)... Aguarde...
    cd backend && call npm.cmd install && cd ..
    echo       -> Backend configurado com sucesso!
) else (
    echo [2/3] Módulos do Backend já instalados.
)

:: 3. Instalação das dependências do Frontend se necessário
if not exist "frontend\node_modules" (
    echo.
    echo [3/3] Instalando pacotes do Frontend (npm install)... Aguarde...
    cd frontend && call npm.cmd install && cd ..
    echo       -> Frontend configurado com sucesso!
) else (
    echo [3/3] Módulos do Frontend já instalados.
)

echo.
echo ====================================================================
echo   🚀 INICIANDO SERVIÇOS (BACKEND + FRONTEND)...
echo ====================================================================
echo.
echo  - Backend API: http://localhost:3000
echo  - Frontend Web: http://localhost:5173
echo.

:: Inicia o backend em janela separada
start "Backend API - Clínica Ikigai" cmd /k "cd backend && npm.cmd run dev"

:: Inicia o frontend em janela separada
start "Frontend Web - Clínica Ikigai" cmd /k "cd frontend && npm.cmd run dev"

echo Serviços disparados com sucesso! Você pode fechar esta janela se desejar.
timeout /t 5 >nul
