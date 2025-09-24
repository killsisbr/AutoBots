@echo off
chcp 65001 >nul
title Bot Multi-tenant WhatsApp - Inicialização

echo.
echo 🤖 ================ BOT MULTI-TENANT WHATSAPP ================ 🤖
echo.
echo Iniciando verificações do sistema...
echo.

:: Verificar Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js não encontrado!
    echo 📥 Baixe em: https://nodejs.org/
    pause
    exit /b 1
)

echo ✅ Node.js: 
node -v

:: Verificar npm
npm -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm não encontrado!
    pause
    exit /b 1
)

echo ✅ npm: 
npm -v

:: Verificar bot.js
if not exist "bot.js" (
    echo ❌ bot.js não encontrado!
    echo 📂 Execute no diretório do projeto
    pause
    exit /b 1
)

echo ✅ bot.js encontrado

:: Verificar package.json
if not exist "package.json" (
    echo ❌ package.json não encontrado!
    pause
    exit /b 1
)

echo ✅ package.json encontrado

:: Criar diretórios
if not exist "data" mkdir data
if not exist "logs" mkdir logs
if not exist ".whatsapp-session" mkdir .whatsapp-session

echo ✅ Estrutura de diretórios criada

:: Verificar node_modules
if not exist "node_modules" (
    echo ⚠️  Dependências não encontradas. Instalando...
    npm install
    if %errorlevel% neq 0 (
        echo ❌ Falha ao instalar dependências!
        pause
        exit /b 1
    )
    echo ✅ Dependências instaladas
) else (
    echo ✅ Dependências encontradas
)

:: Configurar variáveis de ambiente
set NODE_ENV=production
if "%PORT%"=="" set PORT=80

echo.
echo ================================================================
echo 🚀 BRUTUS BOT - INICIANDO SISTEMA
echo ================================================================
echo 📊 Dashboard Brutus: http://localhost:%PORT%/pedidos-brutus-burger.html
echo 📊 Dashboard Killsis: http://localhost:%PORT%/pedidos-killsis-pizza.html
echo 📱 QR Code: http://localhost:%PORT%/qrcode.html
echo ⚙️  Admin: http://localhost:%PORT%/admin-restaurantes.html
echo ================================================================
echo.
echo 🤖 Bot Multi-tenant WhatsApp iniciando...
echo 📱 Para parar o bot, pressione Ctrl+C
echo.

:: Iniciar o bot
node bot.js

pause