# 🤖 Bot Multi-tenant WhatsApp - Sistema de Atendimento Automatizado

Sistema completo de atendimento por WhatsApp com suporte a múltiplos restaurantes, isolamento total de dados e dashboard web em tempo real.

## 🌟 Funcionalidades

### 🏪 Multi-tenant
- **Isolamento Completo**: Cada restaurante tem seus próprios dados, cardápio e configurações
- **Múltiplos WhatsApp**: Cada restaurante pode ter seu próprio número de WhatsApp
- **Dashboards Separados**: Interface única para cada restaurante
- **Controle Individual**: Cada dono pode ativar/desativar seu bot independentemente

### 🤖 Bot Inteligente
- **Reconhecimento de Itens**: IA para entender pedidos em linguagem natural
- **Cardápio Dinâmico**: Fácil adição/remoção de itens via dashboard
- **Coleta de Dados**: Nome, endereço, forma de pagamento automática
- **Gatilhos Personalizados**: Respostas automáticas configuráveis

### 📊 Dashboard Web
- **Tempo Real**: Atualizações instantâneas via Socket.IO
- **Gestão de Pedidos**: Finalizar, imprimir, gerenciar entregas
- **Estatísticas**: Vendas diárias, totais, relatórios
- **Multi-dispositivo**: Acesso simultâneo de múltiplos dispositivos

### 🔐 Controle de Bot
- **Ativar/Desativar**: Botão no dashboard para cada restaurante
- **Status Visual**: Indicador claro do status (ATIVO/INATIVO)
- **Controle Individual**: Cada restaurante controla seu próprio bot
- **Notificações**: Alertas quando o status muda

## 🚀 Instalação

### Pré-requisitos
- **Node.js** 16+
- **Ubuntu/Debian** VPS
- **Porta 80** disponível

### Instalação Manual
```bash
# 1. Instalar dependências
npm install

# 2. Configurar .env
cp .env.example .env
nano .env

# 3. Iniciar o bot
node bot.js
```

## 🔧 Configuração

### Arquivo .env
```env
PORT=80
NODE_ENV=production
SESSION_SECRET=sua_chave_super_secreta
BOT_NAME=Multi-tenant WhatsApp Bot
LOG_LEVEL=info
```

### Restaurantes Suportados
O sistema detecta automaticamente restaurantes pelos números de telefone mapeados em:
- `src/core/phoneRestaurantMapping.js`

## 🌐 URLs de Acesso

### Dashboards por Restaurante
- **Brutus Burger**: `http://seu-ip/pedidos-brutus-burger.html`
- **Killsis Pizza**: `http://seu-ip/pedidos-killsis-pizza.html`

### Administração
- **Admin Geral**: `http://seu-ip/admin-restaurantes.html`
- **QR Codes**: `http://seu-ip/qrcode.html`

## 📱 Como Usar

### Para Restaurantes
1. **Configurar WhatsApp**: Escanear QR Code no dashboard
2. **Adicionar Cardápio**: Via interface web
3. **Controlar Bot**: Botão 🤖 no dashboard para ATIVAR/DESATIVAR
4. **Gerenciar Pedidos**: Acompanhar e finalizar pedidos em tempo real

### Para Clientes
1. Enviar mensagem para o WhatsApp do restaurante
2. Bot responde automaticamente com cardápio (se ATIVO)
3. Cliente faz pedido em linguagem natural
4. Bot coleta dados de entrega
5. Pedido aparece no dashboard do restaurante

## 💾 Estrutura de Dados

### Banco de Dados (SQLite)
```
data/
├── {restaurante}_main.sqlite      # Clientes e pedidos
├── {restaurante}_cardapio.sqlite  # Itens e mapeamentos
├── {restaurante}_mensagens.sqlite # Mensagens personalizadas
└── gatilhos.json                  # Gatilhos globais
```

### Isolamento Multi-tenant
- Cada restaurante = banco separado
- Zero contaminação entre dados
- Backup independente por restaurante

## 🛠️ Manutenção

### Comandos Úteis
```bash
# Ver logs em tempo real
tail -f *.log

# Verificar processos
ps aux | grep node

# Parar bot
pkill -f "node bot.js"

# Iniciar bot
nohup node bot.js > bot.log 2>&1 &
```

### Backup
```bash
# Backup dos dados
tar -czf backup-$(date +%Y%m%d).tar.gz data/

# Backup completo
tar -czf backup-completo-$(date +%Y%m%d).tar.gz . --exclude=node_modules
```

## 🔒 Segurança

- **Sessões Seguras**: Cada dashboard isolado por sessão
- **Validação de Dados**: Sanitização de todas as entradas
- **Logs Auditáveis**: Rastreamento completo de ações
- **HTTPS Ready**: Compatível com certificados SSL

## 📈 Performance

- **SQLite WAL Mode**: Otimizado para múltiplas leituras
- **Cache Inteligente**: Dados frequentes em memória
- **Socket.IO Rooms**: Comunicação otimizada por restaurante
- **Processamento Assíncrono**: Não-bloqueante

## 🐛 Resolução de Problemas

### Bot não responde
1. Verificar se o bot está ATIVO no dashboard (botão verde 🤖)
2. Verificar logs: `tail -f *.log`
3. Verificar se o processo está rodando: `ps aux | grep node`

### Dashboard não carrega
1. Verificar porta 80: `lsof -i :80`
2. Verificar se o servidor está rodando
3. Verificar permissões: `ls -la public/`

### Dados não aparecem
1. Verificar banco: `ls -la data/`
2. Verificar mapeamento de telefone em `phoneRestaurantMapping.js`
3. Verificar logs de erro no dashboard (F12)

## 🔄 Atualizações

Para atualizar o sistema:
1. Parar o bot: `pkill -f "node bot.js"`
2. Fazer backup: `tar -czf backup.tar.gz data/`
3. Substituir arquivos
4. Reinstalar dependências: `npm install`
5. Iniciar: `node bot.js`

## 📞 Suporte

Sistema desenvolvido para atendimento automatizado via WhatsApp com foco em restaurantes e estabelecimentos alimentícios.

**Recursos Principais:**
- ✅ Multi-tenant completo
- ✅ Zero contaminação de dados
- ✅ Interface web responsiva
- ✅ IA para reconhecimento de pedidos
- ✅ Controle individual de bot por restaurante
- ✅ Sistema de backup automático
- ✅ Monitoramento em tempo real

---

🚀 **Sistema pronto para produção em VPS!**