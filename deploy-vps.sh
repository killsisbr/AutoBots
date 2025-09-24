#!/bin/bash

# 🚀 Script de Deploy Automatizado - Bot Multi-tenant WhatsApp
# Deploy completo em VPS Ubuntu/Debian com configuração otimizada

# Configurações
APP_NAME="brutus-bot"
APP_DIR="/opt/brutus-bot"
SERVICE_NAME="brutus-bot"
NODE_VERSION="18"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
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

success() {
    echo -e "${CYAN}[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS:${NC} $1"
}

# Banner de início
show_banner() {
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}              🤖 BOT MULTI-TENANT WHATSAPP 🤖               ${CYAN}║${NC}"
    echo -e "${CYAN}║${NC}                   Deploy Automatizado VPS                   ${CYAN}║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
}

# Verificar se está rodando como root
check_root() {
    if [[ $EUID -ne 0 ]]; then
        error "Este script deve ser executado como root (sudo)!"
        error "Execute: sudo ./deploy-vps.sh"
        exit 1
    fi
    success "Executando com privilégios administrativos"
}

# Atualizar sistema
update_system() {
    log "📦 Atualizando sistema Ubuntu/Debian..."
    
    export DEBIAN_FRONTEND=noninteractive
    apt update -qq
    apt upgrade -y -qq
    
    # Instalar dependências essenciais
    apt install -y -qq \
        curl \
        wget \
        git \
        build-essential \
        software-properties-common \
        apt-transport-https \
        ca-certificates \
        gnupg \
        lsb-release \
        unzip \
        htop \
        ufw \
        fail2ban
    
    success "Sistema atualizado com sucesso!"
}

# Instalar Node.js
install_nodejs() {
    log "🟢 Instalando Node.js ${NODE_VERSION}..."
    
    # Remover versões antigas
    apt remove -y nodejs npm node 2>/dev/null || true
    
    # Instalar Node.js via NodeSource
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt install -y nodejs
    
    # Verificar instalação
    NODE_VER=$(node -v 2>/dev/null || echo "não instalado")
    NPM_VER=$(npm -v 2>/dev/null || echo "não instalado")
    
    if [[ "$NODE_VER" == "não instalado" ]] || [[ "$NPM_VER" == "não instalado" ]]; then
        error "Falha ao instalar Node.js!"
        exit 1
    fi
    
    success "Node.js $NODE_VER e npm $NPM_VER instalados com sucesso!"
}

# Instalar Google Chrome
install_chrome() {
    log "🌐 Instalando Google Chrome..."
    
    # Adicionar repositório
    wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -
    echo 'deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list
    
    # Instalar Chrome
    apt update -qq
    apt install -y google-chrome-stable
    
    # Verificar instalação
    if command -v google-chrome &> /dev/null; then
        CHROME_VER=$(google-chrome --version 2>/dev/null || echo "erro")
        success "Google Chrome instalado: $CHROME_VER"
    else
        warning "Falha ao instalar Google Chrome (opcional para WhatsApp Web)"
    fi
}

# Configurar usuário do sistema
setup_user() {
    log "👤 Configurando usuário do sistema..."
    
    # Criar usuário se não existir
    if ! id "www-data" &>/dev/null; then
        useradd -r -s /bin/bash -d /var/www -m www-data
    fi
    
    # Criar diretório da aplicação
    mkdir -p "$APP_DIR"
    mkdir -p "$APP_DIR/logs"
    mkdir -p "$APP_DIR/data"
    mkdir -p "$APP_DIR/.whatsapp-session"
    mkdir -p "$APP_DIR/backups"
    
    # Definir permissões
    chown -R www-data:www-data "$APP_DIR"
    chmod 755 "$APP_DIR"
    chmod 755 "$APP_DIR/logs"
    chmod 777 "$APP_DIR/data"
    chmod 777 "$APP_DIR/.whatsapp-session"
    chmod 755 "$APP_DIR/backups"
    
    success "Usuário e diretórios configurados!"
}

# Instalar aplicação
install_app() {
    log "📱 Instalando Bot Multi-tenant WhatsApp..."
    
    # Verificar se os arquivos estão no diretório atual
    if [[ ! -f "bot.js" ]] || [[ ! -f "package.json" ]]; then
        error "Arquivos do projeto não encontrados!"
        error "Execute este script no diretório do projeto com bot.js e package.json"
        exit 1
    fi
    
    # Copiar arquivos para o diretório de produção
    log "📂 Copiando arquivos do projeto..."
    cp -r ./* "$APP_DIR/"
    
    # Navegar para o diretório da aplicação
    cd "$APP_DIR" || exit 1
    
    # Instalar dependências
    log "📦 Instalando dependências Node.js..."
    sudo -u www-data npm install --production --silent
    
    if [[ $? -ne 0 ]]; then
        error "Falha ao instalar dependências!"
        exit 1
    fi
    
    success "Dependências instaladas com sucesso!"
    
    # Configurar permissões dos arquivos
    log "🔧 Configurando permissões..."
    chmod 755 bot.js
    chmod +x start.sh
    chmod -R 755 src/ 2>/dev/null || true
    chmod -R 755 public/ 2>/dev/null || true
    
    # Criar arquivo .env se não existir
    if [[ ! -f ".env" ]]; then
        log "⚙️  Criando arquivo .env..."
        cat > .env << EOF
PORT=80
NODE_ENV=production
SESSION_SECRET=$(openssl rand -hex 32)
BOT_NAME=Bot Multi-tenant WhatsApp
LOG_LEVEL=info
EOF
        chown www-data:www-data .env
        chmod 600 .env
    fi
    
    success "Aplicação instalada com sucesso!"
}

# Configurar firewall
setup_firewall() {
    log "🔥 Configurando firewall UFW..."
    
    # Resetar firewall
    ufw --force reset
    
    # Configurar regras básicas
    ufw default deny incoming
    ufw default allow outgoing
    
    # Permitir conexões essenciais
    ufw allow 22/tcp     # SSH
    ufw allow 80/tcp     # HTTP
    ufw allow 443/tcp    # HTTPS
    
    # Habilitar firewall
    ufw --force enable
    
    success "Firewall configurado e ativado!"
}

# Instalar como serviço systemd
install_service() {
    log "⚙️  Instalando serviço systemd..."
    
    SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
    
    cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Bot Multi-tenant WhatsApp - Sistema de Atendimento Automatizado
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
Restart=always
RestartSec=10
User=www-data
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node bot.js
Environment=NODE_ENV=production
Environment=PORT=80
StandardOutput=journal
StandardError=journal
SyslogIdentifier=brutus-bot

# Limites de recursos
LimitNOFILE=65536
LimitNPROC=4096

# Segurança
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF

    # Recarregar systemd e habilitar serviço
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    
    success "Serviço systemd instalado e habilitado!"
}

# Configurar logrotate
setup_logrotate() {
    log "📄 Configurando rotação de logs..."
    
    cat > "/etc/logrotate.d/$SERVICE_NAME" << EOF
$APP_DIR/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 www-data www-data
    postrotate
        systemctl reload $SERVICE_NAME > /dev/null 2>&1 || true
    endscript
}
EOF

    success "Rotação de logs configurada!"
}

# Configurar backup automático
setup_backup() {
    log "💾 Configurando backup automático..."
    
    # Script de backup
    BACKUP_SCRIPT="/usr/local/bin/brutus-bot-backup.sh"
    
    cat > "$BACKUP_SCRIPT" << 'EOF'
#!/bin/bash
APP_DIR="/opt/brutus-bot"
BACKUP_DIR="$APP_DIR/backups"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="backup_$DATE.tar.gz"

mkdir -p "$BACKUP_DIR"
cd "$APP_DIR" || exit 1

tar -czf "$BACKUP_DIR/$BACKUP_FILE" \
    data/ \
    .whatsapp-session/ \
    --exclude="*.log" \
    --exclude="node_modules" \
    2>/dev/null

if [[ $? -eq 0 ]]; then
    echo "✅ Backup criado: $BACKUP_FILE"
    
    # Manter apenas os 10 backups mais recentes
    cd "$BACKUP_DIR" || exit 1
    ls -t backup_*.tar.gz | tail -n +11 | xargs -r rm
    
    echo "📁 Backups mantidos: $(ls -1 backup_*.tar.gz 2>/dev/null | wc -l)"
else
    echo "❌ Falha ao criar backup!"
fi
EOF

    chmod +x "$BACKUP_SCRIPT"
    
    # Configurar cron para backup diário às 2h
    (crontab -l 2>/dev/null; echo "0 2 * * * $BACKUP_SCRIPT") | crontab -
    
    success "Backup automático configurado (diário às 2h)!"
}

# Iniciar serviços
start_services() {
    log "🚀 Iniciando serviços..."
    
    # Parar qualquer instância em execução
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    pkill -f "node bot.js" 2>/dev/null || true
    
    sleep 2
    
    # Iniciar serviço
    systemctl start "$SERVICE_NAME"
    
    # Verificar status
    sleep 3
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        success "✅ Bot Multi-tenant WhatsApp iniciado com sucesso!"
    else
        error "❌ Falha ao iniciar o bot!"
        error "Verifique os logs: journalctl -u $SERVICE_NAME -f"
        exit 1
    fi
}

# Mostrar informações finais
show_final_info() {
    IP=$(hostname -I | awk '{print $1}')
    
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}                    🎉 DEPLOY CONCLUÍDO! 🎉                   ${CYAN}║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}📱 Bot Multi-tenant WhatsApp instalado e rodando!${NC}"
    echo ""
    echo -e "${BLUE}🌐 URLs de Acesso:${NC}"
    echo -e "   • Brutus Burger: ${YELLOW}http://$IP/pedidos-brutus-burger.html${NC}"
    echo -e "   • Killsis Pizza: ${YELLOW}http://$IP/pedidos-killsis-pizza.html${NC}"
    echo -e "   • Admin Geral:   ${YELLOW}http://$IP/admin-restaurantes.html${NC}"
    echo -e "   • QR Code:       ${YELLOW}http://$IP/qrcode.html${NC}"
    echo ""
    echo -e "${BLUE}⚙️  Comandos Úteis:${NC}"
    echo -e "   • Status:      ${YELLOW}systemctl status $SERVICE_NAME${NC}"
    echo -e "   • Logs:        ${YELLOW}journalctl -u $SERVICE_NAME -f${NC}"
    echo -e "   • Reiniciar:   ${YELLOW}systemctl restart $SERVICE_NAME${NC}"
    echo -e "   • Parar:       ${YELLOW}systemctl stop $SERVICE_NAME${NC}"
    echo -e "   • Menu Admin:  ${YELLOW}cd $APP_DIR && ./start.sh${NC}"
    echo ""
    echo -e "${BLUE}💾 Backup:${NC}"
    echo -e "   • Manual:      ${YELLOW}$APP_DIR/start.sh backup${NC}"
    echo -e "   • Automático:  ${YELLOW}Diário às 2h da manhã${NC}"
    echo -e "   • Local:       ${YELLOW}$APP_DIR/backups/${NC}"
    echo ""
    echo -e "${GREEN}✅ Sistema pronto para uso!${NC}"
    echo ""
}

# Função principal
main() {
    show_banner
    
    log "🚀 Iniciando deploy do Bot Multi-tenant WhatsApp..."
    
    check_root
    update_system
    install_nodejs
    install_chrome
    setup_user
    install_app
    setup_firewall
    install_service
    setup_logrotate
    setup_backup
    start_services
    
    show_final_info
}

# Executar se chamado diretamente
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi