#!/bin/bash

# 🔧 Script de Otimização Pós-Deploy - VPS
# Ajustes finais após primeiro deploy bem-sucedido

echo "🔧 Otimizações Pós-Deploy - Bot Multi-tenant WhatsApp"
echo "=================================================="

# Cores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"
}

info() {
    echo -e "${BLUE}[$(date '+%H:%M:%S')] INFO:${NC} $1"
}

# 1. Instalar Chrome se necessário
install_chrome_if_needed() {
    if ! command -v google-chrome &> /dev/null; then
        log "📦 Instalando Google Chrome..."
        
        wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
        echo 'deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main' | sudo tee /etc/apt/sources.list.d/google-chrome.list
        sudo apt update -qq
        sudo apt install -y google-chrome-stable
        
        log "✅ Google Chrome instalado com sucesso!"
    else
        log "✅ Google Chrome já instalado"
    fi
}

# 2. Otimizar configurações do sistema
optimize_system() {
    log "⚡ Otimizando configurações do sistema..."
    
    # Aumentar limites de arquivo
    echo "* soft nofile 65536" | sudo tee -a /etc/security/limits.conf
    echo "* hard nofile 65536" | sudo tee -a /etc/security/limits.conf
    
    # Otimizar SQLite
    echo "# SQLite otimizações" | sudo tee -a /etc/sysctl.conf
    echo "vm.dirty_ratio = 5" | sudo tee -a /etc/sysctl.conf
    echo "vm.dirty_background_ratio = 2" | sudo tee -a /etc/sysctl.conf
    
    log "✅ Sistema otimizado!"
}

# 3. Configurar logs estruturados
setup_logging() {
    log "📄 Configurando logs estruturados..."
    
    # Criar logrotate específico
    sudo tee /etc/logrotate.d/brutus-bot > /dev/null << 'EOF'
/opt/brutus-bot/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 www-data www-data
    postrotate
        systemctl reload brutus-boot >/dev/null 2>&1 || true
    endscript
}
EOF

    log "✅ Logs configurados!"
}

# 4. Configurar monitoramento
setup_monitoring() {
    log "📊 Configurando monitoramento básico..."
    
    # Script de monitoramento
    sudo tee /usr/local/bin/brutus-monitor.sh > /dev/null << 'EOF'
#!/bin/bash
# Monitor básico do Brutus Bot

APP_DIR="/opt/brutus-bot"
LOG_FILE="$APP_DIR/logs/monitor.log"

# Verificar se o serviço está rodando
if ! systemctl is-active --quiet brutus-bot; then
    echo "$(date): ALERTA - Serviço brutus-bot parado, reiniciando..." >> "$LOG_FILE"
    systemctl restart brutus-bot
fi

# Verificar uso de memória
MEM_USAGE=$(ps -o pid,ppid,cmd,%mem --sort=-%mem -C node | head -2 | tail -1 | awk '{print $4}')
if (( $(echo "$MEM_USAGE > 80" | bc -l) )); then
    echo "$(date): ALERTA - Alto uso de memória: $MEM_USAGE%" >> "$LOG_FILE"
fi

# Verificar espaço em disco
DISK_USAGE=$(df /opt/brutus-bot | awk 'NR==2 {print $5}' | sed 's/%//')
if [ "$DISK_USAGE" -gt 85 ]; then
    echo "$(date): ALERTA - Pouco espaço em disco: $DISK_USAGE%" >> "$LOG_FILE"
fi
EOF

    sudo chmod +x /usr/local/bin/brutus-monitor.sh
    
    # Adicionar ao cron para executar a cada 5 minutos
    (sudo crontab -l 2>/dev/null; echo "*/5 * * * * /usr/local/bin/brutus-monitor.sh") | sudo crontab -
    
    log "✅ Monitoramento configurado!"
}

# 5. Otimizar configurações de rede
optimize_network() {
    log "🌐 Otimizando configurações de rede..."
    
    # Configurações TCP para Node.js
    echo "# Otimizações TCP para Node.js" | sudo tee -a /etc/sysctl.conf
    echo "net.core.somaxconn = 65535" | sudo tee -a /etc/sysctl.conf
    echo "net.ipv4.tcp_max_syn_backlog = 65535" | sudo tee -a /etc/sysctl.conf
    echo "net.core.netdev_max_backlog = 65535" | sudo tee -a /etc/sysctl.conf
    
    # Aplicar configurações
    sudo sysctl -p
    
    log "✅ Rede otimizada!"
}

# 6. Configurar backup automático melhorado
setup_enhanced_backup() {
    log "💾 Configurando backup automático melhorado..."
    
    sudo tee /usr/local/bin/brutus-backup-enhanced.sh > /dev/null << 'EOF'
#!/bin/bash
APP_DIR="/opt/brutus-bot"
BACKUP_BASE="/opt/brutus-bot/backups"
DATE=$(date +%Y%m%d_%H%M%S)
DAILY_DIR="$BACKUP_BASE/daily"
WEEKLY_DIR="$BACKUP_BASE/weekly"
MONTHLY_DIR="$BACKUP_BASE/monthly"

mkdir -p "$DAILY_DIR" "$WEEKLY_DIR" "$MONTHLY_DIR"

# Backup diário
cd "$APP_DIR" || exit 1
tar -czf "$DAILY_DIR/backup_daily_$DATE.tar.gz" \
    data/ \
    .whatsapp-session/ \
    --exclude="*.log" \
    --exclude="node_modules" 2>/dev/null

if [[ $? -eq 0 ]]; then
    echo "$(date): ✅ Backup diário criado: backup_daily_$DATE.tar.gz"
    
    # Manter apenas 7 backups diários
    cd "$DAILY_DIR" || exit 1
    ls -t backup_daily_*.tar.gz | tail -n +8 | xargs -r rm
    
    # Backup semanal (domingos)
    if [[ $(date +%u) -eq 7 ]]; then
        cp "$DAILY_DIR/backup_daily_$DATE.tar.gz" "$WEEKLY_DIR/backup_weekly_$DATE.tar.gz"
        # Manter 4 backups semanais
        cd "$WEEKLY_DIR" || exit 1
        ls -t backup_weekly_*.tar.gz | tail -n +5 | xargs -r rm
    fi
    
    # Backup mensal (dia 1)
    if [[ $(date +%d) -eq 01 ]]; then
        cp "$DAILY_DIR/backup_daily_$DATE.tar.gz" "$MONTHLY_DIR/backup_monthly_$DATE.tar.gz"
        # Manter 12 backups mensais
        cd "$MONTHLY_DIR" || exit 1
        ls -t backup_monthly_*.tar.gz | tail -n +13 | xargs -r rm
    fi
    
else
    echo "$(date): ❌ Falha no backup diário!"
fi
EOF

    sudo chmod +x /usr/local/bin/brutus-backup-enhanced.sh
    
    # Atualizar cron para usar backup melhorado
    (sudo crontab -l 2>/dev/null | grep -v brutus-backup; echo "0 2 * * * /usr/local/bin/brutus-backup-enhanced.sh") | sudo crontab -
    
    log "✅ Backup melhorado configurado!"
}

# 7. Criar dashboard de status
create_status_dashboard() {
    log "📊 Criando dashboard de status..."
    
    sudo tee /usr/local/bin/brutus-status.sh > /dev/null << 'EOF'
#!/bin/bash
clear
echo "🤖 ================ BOT MULTI-TENANT WHATSAPP ================ 🤖"
echo ""

# Status do serviço
if systemctl is-active --quiet brutus-bot; then
    echo -e "Status: \033[0;32m🟢 RODANDO\033[0m"
    PID=$(systemctl show brutus-bot --property MainPID --value)
    if [ "$PID" != "0" ]; then
        MEM=$(ps -p $PID -o rss= | awk '{print int($1/1024)" MB"}')
        CPU=$(ps -p $PID -o %cpu= | awk '{print $1"%"}')
        echo "PID: $PID | Memória: $MEM | CPU: $CPU"
    fi
else
    echo -e "Status: \033[0;31m🔴 PARADO\033[0m"
fi

echo ""

# Estatísticas do sistema
echo "📊 Sistema:"
echo "   Memória: $(free -h | awk 'NR==2{printf "%.0f%% usado\n", $3*100/$2}')"
echo "   Disco: $(df /opt/brutus-bot | awk 'NR==2 {print $5" usado"}')"
echo "   Uptime: $(uptime -p)"

echo ""

# Últimos logs
echo "📄 Últimos logs:"
if [ -f "/opt/brutus-bot/logs/bot.log" ]; then
    tail -3 /opt/brutus-bot/logs/bot.log
else
    journalctl -u brutus-bot --no-pager -n 3
fi

echo ""
echo "================================================================="
EOF

    sudo chmod +x /usr/local/bin/brutus-status.sh
    
    log "✅ Dashboard de status criado! Use: brutus-status.sh"
}

# Função principal
main() {
    info "🚀 Iniciando otimizações pós-deploy..."
    
    install_chrome_if_needed
    optimize_system
    setup_logging
    setup_monitoring
    optimize_network
    setup_enhanced_backup
    create_status_dashboard
    
    echo ""
    echo "🎉 OTIMIZAÇÕES CONCLUÍDAS!"
    echo ""
    echo "📊 Comandos úteis:"
    echo "   brutus-status.sh          # Status completo"
    echo "   systemctl status brutus-bot # Status do serviço"
    echo "   journalctl -u brutus-bot -f # Logs em tempo real"
    echo ""
    echo "🌐 URLs de acesso:"
    IP=$(hostname -I | awk '{print $1}')
    echo "   http://$IP/pedidos-brutus-burger.html"
    echo "   http://$IP/qrcode.html"
    echo ""
}

main "$@"