#!/bin/bash

# 🤖 Bot Multi-tenant WhatsApp - Script de Inicialização VPS
# Sistema de atendimento automatizado para múltiplos restaurantes
# Desenvolvido para Ubuntu/Debian VPS

# Configurações
APP_NAME="brutus-bot"
APP_DIR="/opt/brutus-bot"
LOG_DIR="$APP_DIR/logs"
PID_FILE="$APP_DIR/bot.pid"
LOG_FILE="$LOG_DIR/bot.log"
ERROR_LOG="$LOG_DIR/error.log"
USER="www-data"
NODE_ENV="production"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Função para logs
log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" >&2
}

warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

info() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')] INFO:${NC} $1"
}

# Verificar se está rodando como root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        warning "Executando como root. Recomendado usar usuário dedicado."
    fi
}

# Criar estrutura de diretórios
setup_directories() {
    log "Criando estrutura de diretórios..."
    
    # Criar diretório de logs
    mkdir -p "$LOG_DIR"
    mkdir -p "$APP_DIR/data"
    mkdir -p "$APP_DIR/.whatsapp-session"
    
    # Definir permissões
    chmod 755 "$APP_DIR"
    chmod 755 "$LOG_DIR"
    chmod 777 "$APP_DIR/data"
    chmod 777 "$APP_DIR/.whatsapp-session"
    
    log "Estrutura de diretórios criada com sucesso!"
}

# Verificar dependências
check_dependencies() {
    log "Verificando dependências..."
    
    # Verificar Node.js
    if ! command -v node &> /dev/null; then
        error "Node.js não encontrado. Instalando..."
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    fi
    
    # Verificar versão do Node.js
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 16 ]; then
        error "Node.js versão 16+ necessária. Versão atual: $(node -v)"
        exit 1
    fi
    
    # Verificar npm
    if ! command -v npm &> /dev/null; then
        error "npm não encontrado!"
        exit 1
    fi
    
    log "Dependências verificadas com sucesso!"
}

# Instalar dependências do projeto
install_dependencies() {
    log "Instalando dependências do projeto..."
    
    cd "$APP_DIR" || exit 1
    
    # Instalar dependências
    npm install --production --silent
    
    if [ $? -eq 0 ]; then
        log "Dependências instaladas com sucesso!"
    else
        error "Falha ao instalar dependências!"
        exit 1
    fi
}

# Verificar se o bot está rodando
is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p "$PID" > /dev/null 2>&1; then
            return 0
        else
            rm -f "$PID_FILE"
            return 1
        fi
    fi
    return 1
}

# Iniciar o bot
start_bot() {
    if is_running; then
        warning "Bot já está rodando (PID: $(cat $PID_FILE))"
        return 1
    fi
    
    log "Iniciando Bot Multi-tenant WhatsApp..."
    
    cd "$APP_DIR" || exit 1
    
    # Configurar variáveis de ambiente
    export NODE_ENV="$NODE_ENV"
    export PORT="${PORT:-80}"
    
    # Iniciar o bot em background
    nohup node bot.js > "$LOG_FILE" 2> "$ERROR_LOG" &
    BOT_PID=$!
    
    # Salvar PID
    echo $BOT_PID > "$PID_FILE"
    
    # Aguardar alguns segundos para verificar se iniciou corretamente
    sleep 3
    
    if is_running; then
        log "✅ Bot iniciado com sucesso! PID: $BOT_PID"
        log "📊 Dashboard: http://$(hostname -I | awk '{print $1}')/pedidos-brutus-burger.html"
        log "📱 QR Code: http://$(hostname -I | awk '{print $1}')/qrcode.html"
        log "📄 Logs: tail -f $LOG_FILE"
        return 0
    else
        error "❌ Falha ao iniciar o bot!"
        if [ -f "$ERROR_LOG" ]; then
            error "Últimos erros:"
            tail -10 "$ERROR_LOG"
        fi
        return 1
    fi
}

# Parar o bot
stop_bot() {
    if ! is_running; then
        warning "Bot não está rodando"
        return 1
    fi
    
    PID=$(cat "$PID_FILE")
    log "Parando bot (PID: $PID)..."
    
    # Tentar parar graciosamente
    kill "$PID" 2>/dev/null
    
    # Aguardar até 10 segundos
    for i in {1..10}; do
        if ! is_running; then
            log "✅ Bot parado com sucesso!"
            rm -f "$PID_FILE"
            return 0
        fi
        sleep 1
    done
    
    # Se não parou, forçar
    warning "Forçando parada do bot..."
    kill -9 "$PID" 2>/dev/null
    rm -f "$PID_FILE"
    
    log "🛑 Bot parado à força!"
}

# Reiniciar o bot
restart_bot() {
    log "Reiniciando Bot Multi-tenant WhatsApp..."
    stop_bot
    sleep 2
    start_bot
}

# Status do bot
status_bot() {
    echo "==================== STATUS DO BOT ===================="
    
    if is_running; then
        PID=$(cat "$PID_FILE")
        echo -e "Status: ${GREEN}🟢 RODANDO${NC}"
        echo "PID: $PID"
        echo "Memória: $(ps -p $PID -o rss= | awk '{print int($1/1024)" MB"}')"
        echo "CPU: $(ps -p $PID -o %cpu= | awk '{print $1"%"}')"
        echo "Tempo: $(ps -p $PID -o etime= | awk '{print $1}')"
    else
        echo -e "Status: ${RED}🔴 PARADO${NC}"
    fi
    
    echo ""
    echo "Diretório: $APP_DIR"
    echo "Logs: $LOG_FILE"
    echo "Erros: $ERROR_LOG"
    echo ""
    
    # URLs de acesso
    IP=$(hostname -I | awk '{print $1}')
    echo "📊 Dashboards:"
    echo "   Brutus Burger: http://$IP/pedidos-brutus-burger.html"
    echo "   Killsis Pizza: http://$IP/pedidos-killsis-pizza.html"
    echo "   Admin: http://$IP/admin-restaurantes.html"
    echo "📱 QR Code: http://$IP/qrcode.html"
    
    echo "======================================================"
}

# Mostrar logs
show_logs() {
    if [ -f "$LOG_FILE" ]; then
        echo "==================== LOGS RECENTES ===================="
        tail -50 "$LOG_FILE"
        echo "========================================================"
    else
        warning "Arquivo de log não encontrado: $LOG_FILE"
    fi
}

# Mostrar erros
show_errors() {
    if [ -f "$ERROR_LOG" ]; then
        echo "==================== ERROS RECENTES ===================="
        tail -50 "$ERROR_LOG"
        echo "========================================================"
    else
        info "Nenhum erro encontrado!"
    fi
}

# Monitorar logs em tempo real
monitor_logs() {
    log "Monitorando logs em tempo real... (Ctrl+C para sair)"
    tail -f "$LOG_FILE" "$ERROR_LOG" 2>/dev/null
}

# Backup dos dados
backup_data() {
    BACKUP_DIR="$APP_DIR/backups"
    BACKUP_FILE="backup-$(date +%Y%m%d-%H%M%S).tar.gz"
    
    mkdir -p "$BACKUP_DIR"
    
    log "Criando backup: $BACKUP_FILE"
    
    cd "$APP_DIR" || exit 1
    tar -czf "$BACKUP_DIR/$BACKUP_FILE" data/ .whatsapp-session/ --exclude="*.log"
    
    if [ $? -eq 0 ]; then
        log "✅ Backup criado: $BACKUP_DIR/$BACKUP_FILE"
        
        # Manter apenas os 10 backups mais recentes
        cd "$BACKUP_DIR" || exit 1
        ls -t backup-*.tar.gz | tail -n +11 | xargs -r rm
        
        log "📁 Backups mantidos: $(ls -1 backup-*.tar.gz | wc -l)"
    else
        error "❌ Falha ao criar backup!"
    fi
}

# Verificar saúde do sistema
health_check() {
    echo "==================== VERIFICAÇÃO DE SAÚDE ===================="
    
    # Verificar se está rodando
    if is_running; then
        echo -e "✅ Bot: ${GREEN}RODANDO${NC}"
    else
        echo -e "❌ Bot: ${RED}PARADO${NC}"
    fi
    
    # Verificar porta
    if ss -tlnp | grep ":80 " > /dev/null; then
        echo -e "✅ Porta 80: ${GREEN}ABERTA${NC}"
    else
        echo -e "❌ Porta 80: ${RED}FECHADA${NC}"
    fi
    
    # Verificar espaço em disco
    DISK_USAGE=$(df "$APP_DIR" | awk 'NR==2 {print $5}' | sed 's/%//')
    if [ "$DISK_USAGE" -lt 80 ]; then
        echo -e "✅ Disco: ${GREEN}$DISK_USAGE% usado${NC}"
    else
        echo -e "⚠️  Disco: ${YELLOW}$DISK_USAGE% usado${NC}"
    fi
    
    # Verificar memória
    MEM_USAGE=$(free | awk 'NR==2{printf "%.0f", $3*100/$2}')
    if [ "$MEM_USAGE" -lt 80 ]; then
        echo -e "✅ Memória: ${GREEN}$MEM_USAGE% usada${NC}"
    else
        echo -e "⚠️  Memória: ${YELLOW}$MEM_USAGE% usada${NC}"
    fi
    
    # Verificar bancos de dados
    DB_COUNT=$(find "$APP_DIR/data" -name "*.sqlite" 2>/dev/null | wc -l)
    echo "📊 Bancos de dados: $DB_COUNT"
    
    echo "============================================================="
}

# Instalar como serviço systemd
install_service() {
    log "Instalando serviço systemd..."
    
    SERVICE_FILE="/etc/systemd/system/brutus-bot.service"
    
    sudo tee "$SERVICE_FILE" > /dev/null << EOF
[Unit]
Description=Bot Multi-tenant WhatsApp
After=network.target

[Service]
Type=forking
User=www-data
WorkingDirectory=$APP_DIR
ExecStart=$APP_DIR/start.sh start
ExecStop=$APP_DIR/start.sh stop
ExecReload=$APP_DIR/start.sh restart
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=brutus-bot
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable brutus-bot
    
    log "✅ Serviço instalado! Use: systemctl start brutus-bot"
}

# Menu principal
show_menu() {
    echo ""
    echo "🤖 ================ BOT MULTI-TENANT WHATSAPP ================ 🤖"
    echo ""
    echo "1)  🚀 Iniciar Bot"
    echo "2)  🛑 Parar Bot"
    echo "3)  🔄 Reiniciar Bot"
    echo "4)  📊 Status"
    echo "5)  📄 Ver Logs"
    echo "6)  ❌ Ver Erros"
    echo "7)  �️  Monitorar Logs"
    echo "8)  💾 Backup"
    echo "9)  🏥 Verificação de Saúde"
    echo "10) ⚙️  Instalar Serviço"
    echo "0)  🚪 Sair"
    echo ""
    echo "================================================================="
    echo ""
}

# Função principal
main() {
    # Verificar se está no diretório correto
    if [ ! -f "bot.js" ]; then
        error "bot.js não encontrado. Execute o script no diretório do projeto!"
        exit 1
    fi
    
    # Definir APP_DIR como diretório atual se não especificado
    if [ "$APP_DIR" = "/opt/brutus-bot" ] && [ "$(pwd)" != "/opt/brutus-bot" ]; then
        APP_DIR="$(pwd)"
        LOG_DIR="$APP_DIR/logs"
        PID_FILE="$APP_DIR/bot.pid"
        LOG_FILE="$LOG_DIR/bot.log"
        ERROR_LOG="$LOG_DIR/error.log"
    fi
    
    check_root
    setup_directories
    
    case "${1:-menu}" in
        "start")
            check_dependencies
            install_dependencies
            start_bot
            ;;
        "stop")
            stop_bot
            ;;
        "restart")
            restart_bot
            ;;
        "status")
            status_bot
            ;;
        "logs")
            show_logs
            ;;
        "errors")
            show_errors
            ;;
        "monitor")
            monitor_logs
            ;;
        "backup")
            backup_data
            ;;
        "health")
            health_check
            ;;
        "install-service")
            install_service
            ;;
        "menu"|*)
            while true; do
                show_menu
                read -p "Escolha uma opção: " choice
                echo ""
                
                case $choice in
                    1) check_dependencies && install_dependencies && start_bot ;;
                    2) stop_bot ;;
                    3) restart_bot ;;
                    4) status_bot ;;
                    5) show_logs ;;
                    6) show_errors ;;
                    7) monitor_logs ;;
                    8) backup_data ;;
                    9) health_check ;;
                    10) install_service ;;
                    0) 
                        log "👋 Saindo..."
                        exit 0
                        ;;
                    *)
                        error "Opção inválida!"
                        ;;
                esac
                
                echo ""
                read -p "Pressione Enter para continuar..."
            done
            ;;
    esac
}

# Executar função principal com todos os argumentos
main "$@"