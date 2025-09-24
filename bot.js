const { Client, LocalAuth, MessageMedia, LegacySessionAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const path = require('path');
const fs = require('fs');
const carrinhoService = require('./src/services/carrinhoService');
// Real-time dashboard server
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const session = require('express-session');
const crypto = require('crypto');
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const clientService = require('./src/services/clienteService');
const mensagensService = require('./src/services/mensagensService');
const multiTenantService = require('./src/services/multiTenantService');
const RestaurantMiddleware = require('./src/middleware/restaurantMiddleware');
const atualizarEstadoDoCarrinho = carrinhoService.atualizarEstadoDoCarrinho;
const mensagens = require('./src/utils/mensagens');
const core = require('./src/core/analisePalavras');
const carrinhoView = carrinhoService.carrinhoView;
const atualizarEnderecoCliente = carrinhoService.atualizarEnderecoCliente;
const atualizarNomeCliente = clientService.atualizarNomeCliente;
const printarClientes = clientService.printarClientes;
const obterInformacoesCliente = clientService.obterInformacoesCliente;
const analisarPalavras = core.analisarPalavras;
const separarMensagem = core.separarMensagem;
const resp = mensagens.mensagem;
// REMOVIDO: const carrinhos = carrinhoService.carrinhos; - usando getCarrinhos() por restaurante
const events = carrinhoService.events; // EventEmitter para atualizações
const cardapioService = require('./src/services/cardapioService');
// Sanitiza um objeto de carrinho removendo propriedades internas, timers, funções
function sanitizeCarrinho(input) {
  if (!input || typeof input !== 'object') return input;
  const seen = new WeakSet();
  function _san(v) {
    if (v === null) return null;
    if (typeof v !== 'object') return v;
    if (seen.has(v)) return undefined;
    seen.add(v);
    if (Array.isArray(v)) return v.map(_san).filter(x => typeof x !== 'undefined');
    const out = {};
    for (const k of Object.keys(v)) {
      // remove propriedades internas/privadas
      if (k && typeof k === 'string' && k.startsWith('_')) continue;
      const val = v[k];
      if (typeof val === 'function') continue;
      // Timeout objects and other native handles can cause circular serialization; skip common ones
      try {
        const ctorName = val && val.constructor && val.constructor.name;
        if (ctorName === 'Timeout' || ctorName === 'Immediate') continue;
      } catch (e) {}
      if (val instanceof Date) { out[k] = val.toISOString(); continue; }
      const sanitized = _san(val);
      if (typeof sanitized !== 'undefined') out[k] = sanitized;
    }
    return out;
  }
  return _san(input);
}
const analisePorStatus = require('./src/core/analisePorStatus');
const menuInicial = require('./src/core/fluxo/menuGlobal');
const { error } = require('console');
const resetCarrinho = carrinhoService.resetCarrinho;
let obterUnidade = require('./src/utils/obterUnidade').obterUnidade;

// Estado do cliente WhatsApp
let isReady = false;

// Gatilhos personalizados (declaração antecipada para evitar acessos antes da inicialização)
let gatilhosPersonalizados = {};

// Middleware para parsing JSON
app.use(express.json());

// Configuração de sessão
app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: false, // true apenas em HTTPS
    maxAge: 24 * 60 * 60 * 1000 // 24 horas
  }
}));

// Sistema de clientes/restaurantes
const clientesDB = new Map(); // Em produção, usar banco de dados
const configuracoesPorCliente = new Map();

// Inicializar clientes padrão
const clientePadrao = {
  id: 'brutus-burger',
  nome: 'Brutus Burger',
  email: 'admin@brutus.com',
  senha: 'admin123', // Em produção, usar hash
  ativo: true,
  dataCriacao: new Date()
};
clientesDB.set(clientePadrao.id, clientePadrao);

const clienteKillsis = {
  id: 'killsis-pizza',
  nome: 'Killsis Pizza',
  email: 'admin@killsis.com',
  senha: 'admin123', // Em produção, usar hash
  ativo: true,
  dataCriacao: new Date()
};
clientesDB.set(clienteKillsis.id, clienteKillsis);

const clienteDegust = {
  id: 'degust-175863158714o',
  nome: 'Degust Restaurante',
  email: 'admin@degust.com',
  senha: '123456', // Em produção, usar hash
  ativo: true,
  dataCriacao: new Date()
};
clientesDB.set(clienteDegust.id, clienteDegust);

// Adicionar outros clientes conforme necessário
const clienteDegust2 = {
  id: 'degust-1758631587140',
  nome: 'Degust Restaurante Alt',
  email: 'admin2@degust.com',
  senha: '123456', // Em produção, usar hash
  ativo: true,
  dataCriacao: new Date()
};
clientesDB.set(clienteDegust2.id, clienteDegust2);

// ===== MAPEAMENTO TELEFONE/RESTAURANTE =====
// Carrega mapeamento de números de telefone para restaurantes a partir de
// data/phone-mappings.json para permitir alteração sem editar o código.
const phoneToRestaurantMap = new Map();
const phoneMappingsPath = path.join(__dirname, 'data', 'phone-mappings.json');

function loadPhoneMappings() {
  try {
    if (fs.existsSync(phoneMappingsPath)) {
      const raw = fs.readFileSync(phoneMappingsPath, 'utf8');
      const obj = JSON.parse(raw);
      for (const [phone, rest] of Object.entries(obj)) {
        phoneToRestaurantMap.set(String(phone), String(rest));
      }
      console.log(`📱 [PHONE-MAPPING] Loaded ${phoneToRestaurantMap.size} mappings from data/phone-mappings.json`);
      // Persist mappings into each restaurant DB (create cliente entries)
      try {
        for (const [phone, rest] of Object.entries(obj)) {
          try {
            const clienteId = String(rest || 'brutus-burger');
            const cleanPhone = String(phone).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
            const mainDb = multiTenantService.getClientDatabase(clienteId, 'main');
            // Ensure clientes table exists and insert contact if not present
            try {
              const insert = mainDb.prepare('INSERT OR IGNORE INTO clientes (numero, nome) VALUES (?, ?)');
              insert.run(cleanPhone, `Contato mapeado ${cleanPhone}`);
            } catch(e) {
              // Fall back if schema differs
              try { mainDb.prepare('INSERT OR IGNORE INTO clientes (numero, nome) VALUES (?, ?)').run(cleanPhone, `Contato ${cleanPhone}`); } catch(_e) {}
            }
          } catch(e) {
            console.warn('[PHONE-MAPPING] Falha ao persistir mapping para', phone, e && e.message ? e.message : e);
          }
        }
        console.log('📱 [PHONE-MAPPING] Mapeamentos persistidos nos bancos dos restaurantes (clientes table).');
      } catch(e) {
        console.warn('📱 [PHONE-MAPPING] Erro ao persistir mapeamentos nos DBs:', e && e.message ? e.message : e);
      }
      return;
    }
  } catch (e) {
    console.error('📱 [PHONE-MAPPING] Erro ao carregar data/phone-mappings.json:', e.message);
  }

  // Se não houver arquivo, criar mapeamento padrão em memória e persistir para facilitar edição.
  const defaults = {
    // Ajuste aqui: se você quer que 554191798537 aponte para killsis-pizza, mantenha como abaixo.
    "554191798537": "killsis-pizza",
    // outro exemplo de número do Killsis (se você souber, adicione/atualize)
    "5541999887766": "killsis-pizza",
    // Degust exemplos
    "5541888776655": "degust-175863158714o",
    "5541777665544": "degust-1758631587140"
  };

  for (const [phone, rest] of Object.entries(defaults)) {
    phoneToRestaurantMap.set(String(phone), String(rest));
  }

  try {
    const dataDir = path.dirname(phoneMappingsPath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(phoneMappingsPath, JSON.stringify(defaults, null, 2), 'utf8');
    console.log('📱 [PHONE-MAPPING] Arquivo data/phone-mappings.json criado com os defaults (edite para ajustar).');
      // Persist defaults into the restaurants' DBs (best-effort)
      try {
        for (const [phone, rest] of Object.entries(defaults)) {
          try {
            const clienteId = String(rest || 'brutus-burger');
            const cleanPhone = String(phone).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
            const mainDb = multiTenantService.getClientDatabase(clienteId, 'main');
            try {
              mainDb.prepare('INSERT OR IGNORE INTO clientes (numero, nome) VALUES (?, ?)').run(cleanPhone, `Contato mapeado ${cleanPhone}`);
            } catch (e) { /* best-effort */ }
          } catch (e) {
            console.warn('[PHONE-MAPPING] Falha ao persistir default mapping para', phone, e && e.message ? e.message : e);
          }
        }
        console.log('📱 [PHONE-MAPPING] Defaults persistidos nos bancos dos restaurantes (clientes table).');
      } catch (e) {
        console.warn('📱 [PHONE-MAPPING] Erro ao persistir defaults nos DBs:', e && e.message ? e.message : e);
      }
  } catch (e) {
    console.error('📱 [PHONE-MAPPING] Falha ao gravar data/phone-mappings.json:', e.message);
  }
}

loadPhoneMappings();

// Watch the phone-mappings file and reload into memory when it changes so updates take effect without restart
try {
  if (fs.existsSync(phoneMappingsPath)) {
    fs.watch(phoneMappingsPath, { persistent: false }, (eventType, filename) => {
      if (!filename) return;
      if (eventType === 'change' || eventType === 'rename') {
        try {
          const raw = fs.readFileSync(phoneMappingsPath, 'utf8');
          const obj = JSON.parse(raw || '{}');
          phoneToRestaurantMap.clear();
          for (const [phone, rest] of Object.entries(obj)) phoneToRestaurantMap.set(String(phone), String(rest));
          console.log(`📱 [PHONE-MAPPING] Reloaded ${phoneToRestaurantMap.size} mappings from ${phoneMappingsPath}`);
          // Persist reloaded mappings into the restaurants' DBs (best-effort)
          try {
            for (const [phone, rest] of Object.entries(obj)) {
              try {
                const clienteId = String(rest || 'brutus-burger');
                const cleanPhone = String(phone).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
                const mainDb = multiTenantService.getClientDatabase(clienteId, 'main');
                try {
                  mainDb.prepare('INSERT OR IGNORE INTO clientes (numero, nome) VALUES (?, ?)').run(cleanPhone, `Contato mapeado ${cleanPhone}`);
                } catch (e) { /* best-effort */ }
              } catch (e) {
                console.warn('[PHONE-MAPPING] Falha ao persistir reloaded mapping para', phone, e && e.message ? e.message : e);
              }
            }
            console.log('📱 [PHONE-MAPPING] Reloaded mappings também persistidos nos DBs dos restaurantes (clientes table).');
          } catch (e) {
            console.warn('📱 [PHONE-MAPPING] Erro ao persistir reloaded mappings nos DBs:', e && e.message ? e.message : e);
          }
        } catch (e) {
          console.warn('📱 [PHONE-MAPPING] Failed to reload phone-mappings.json after change:', e && e.message ? e.message : e);
        }
      }
    });
  }
} catch (e) {
  console.warn('📱 [PHONE-MAPPING] fs.watch unavailable or failed:', e && e.message ? e.message : e);
}

// Carrega arquivos de cardápio JSON presentes em data/cardapios/*.json ou data/cardapio.json
function loadCardapioFiles() {
  try {
    const cardapiosDir = path.join(__dirname, 'data', 'cardapios');
    // 1) per-client files in data/cardapios/<cliente>.json
    if (fs.existsSync(cardapiosDir)) {
      const files = fs.readdirSync(cardapiosDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const full = path.join(cardapiosDir, file);
          const raw = fs.readFileSync(full, 'utf8');
          const obj = JSON.parse(raw);
          const clienteId = path.basename(file, '.json');
          if (!obj || !obj.items || !Array.isArray(obj.items)) {
            console.warn(`[CARDAPIO] Arquivo ${file} não contém campo items[]. Pulando.`);
            continue;
          }
          console.log(`[CARDAPIO] Restaurando cardápio de ${file} para cliente ${clienteId}: ${obj.items.length} itens`);
          // limpar e restaurar
          try { cardapioService.clearAllItems(clienteId); } catch(e) { console.warn('[CARDAPIO] clearAllItems falhou para', clienteId); }
          for (const item of obj.items) {
            try { cardapioService.addItem(clienteId, item); } catch(e) { console.warn('[CARDAPIO] addItem falhou para', clienteId, item && item.nome); }
          }
        } catch(e) { console.warn('[CARDAPIO] Erro ao processar arquivo', file, e && e.message ? e.message : e); }
      }
    }

    // 2) fallback single file data/cardapio.json -> default to brutus-burger
    const fallback = path.join(__dirname, 'data', 'cardapio.json');
    if (fs.existsSync(fallback)) {
      try {
        const raw = fs.readFileSync(fallback, 'utf8');
        const obj = JSON.parse(raw);
        if (obj && obj.items && Array.isArray(obj.items)) {
          const clienteId = 'brutus-burger';
          console.log(`[CARDAPIO] Restaurando cardapio.json para ${clienteId}: ${obj.items.length} itens`);
          try { cardapioService.clearAllItems(clienteId); } catch(e) { console.warn('[CARDAPIO] clearAllItems falhou para', clienteId); }
          for (const item of obj.items) {
            try { cardapioService.addItem(clienteId, item); } catch(e) { console.warn('[CARDAPIO] addItem falhou para', clienteId, item && item.nome); }
          }
        }
      } catch(e) { console.warn('[CARDAPIO] Erro ao ler data/cardapio.json:', e && e.message ? e.message : e); }
    }
  } catch (e) {
    console.error('[CARDAPIO] Erro em loadCardapioFiles:', e && e.message ? e.message : e);
  }
}

// Executar carregamento de cardápios no startup
try { loadCardapioFiles(); } catch(e) { console.warn('[CARDAPIO] loadCardapioFiles error', e && e.message ? e.message : e); }

// Função para determinar qual restaurante baseado no número do cliente
function getRestaurantByPhoneNumber(phoneNumber) {
  // Normalizar número (remover @c.us, @s.whatsapp.net, etc)
  const cleanPhone = String(phoneNumber).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
  
  // Verificar mapeamento direto
  const directMatch = phoneToRestaurantMap.get(cleanPhone);
  if (directMatch) {
    console.log(`📱 [PHONE-MAPPING] Número ${cleanPhone} mapeado para restaurante: ${directMatch}`);
    return directMatch;
  }
  
  // Fallback: usar brutus-burger como padrão
  console.log(`📱 [PHONE-MAPPING] Número ${cleanPhone} não mapeado, usando padrão: brutus-burger`);
  return 'brutus-burger';
}

// Função para extrair o restaurante do referer URL
function extractRestaurantFromReferer(referer) {
  try {
    if (!referer) return 'brutus-burger';
    
    // Padrões possíveis:
    // http://localhost/pedidos-killsis-pizza.html
    // http://localhost/pedidos-brutus-burger.html
    // http://localhost/pedidos-killsis-pizza.html?restaurant=killsis-pizza
    
    // Primeiro tentar extrair do parâmetro restaurant
    const url = new URL(referer);
    const restaurantParam = url.searchParams.get('restaurant');
    if (restaurantParam) {
      console.log(`🔗 [SOCKET] Restaurante extraído do parâmetro: ${restaurantParam}`);
      return restaurantParam;
    }
    
    // Se não houver parâmetro, extrair do nome do arquivo
    const pathname = url.pathname;
    const match = pathname.match(/pedidos-(.+)\.html$/);
    if (match) {
      const restaurant = match[1];
      console.log(`🔗 [SOCKET] Restaurante extraído do pathname: ${restaurant}`);
      return restaurant;
    }

    // Tentar inferir pelo hostname (ex: killsis.com -> procurar clientId que contenha 'killsis')
    const hostname = url.hostname.replace(/^www\./i, '').split('.')[0];
    if (hostname) {
      // Procurar um cliente cujo id contenha o hostname (case-insensitive)
      for (const [id] of clientesDB) {
        if (String(id).toLowerCase().includes(hostname.toLowerCase())) {
          console.log(`🔗 [SOCKET] Restaurante inferido pelo hostname '${hostname}' -> ${id}`);
          return id;
        }
      }
      // Caso não encontre, tentar usar o hostname direto se existir como id
      if (clientesDB.has(hostname)) {
        console.log(`🔗 [SOCKET] Restaurante igual ao hostname: ${hostname}`);
        return hostname;
      }
    }

    console.log(`🔗 [SOCKET] Não foi possível extrair restaurante do referer: ${referer}`);
    return 'brutus-burger';
  } catch (e) {
    console.error(`🔗 [SOCKET] Erro ao extrair restaurante do referer: ${e.message}`);
    return 'brutus-burger';
  }
}

// Middleware de autenticação
function requireAuth(req, res, next) {
  console.log('[DEBUG] requireAuth - session:', req.session);
  console.log('[DEBUG] requireAuth - query:', req.query);
  let clienteId = null;
  
  // Tentar obter clienteId da sessão primeiro
  if (req.session && req.session.clienteId) {
    clienteId = req.session.clienteId;
    console.log('[DEBUG] requireAuth - clienteId from session:', clienteId);
  }
  // Se não houver sessão, tentar obter do query parameter (compatibilidade: aceitar clienteId, restaurantId ou restaurant)
  else {
    if (req.query.clienteId) {
      clienteId = req.query.clienteId;
      console.log('[DEBUG] requireAuth - clienteId from query (clienteId):', clienteId);
    } else if (req.query.restaurantId) {
      clienteId = req.query.restaurantId;
      console.log('[DEBUG] requireAuth - clienteId from query (restaurantId):', clienteId);
    } else if (req.query.restaurant) {
      clienteId = req.query.restaurant;
      console.log('[DEBUG] requireAuth - clienteId from query (restaurant):', clienteId);
    }
  }
  
  if (clienteId) {
    const cliente = clientesDB.get(clienteId);
    console.log('[DEBUG] requireAuth - cliente found:', !!cliente);
    if (cliente && cliente.ativo) {
      req.cliente = cliente;
      req.clienteId = clienteId;
      req.clienteConfig = getClienteConfig(clienteId);
      console.log('[DEBUG] requireAuth - success, proceeding');
      return next();
    }
  }
  
  console.log('[DEBUG] requireAuth - access denied');
  return res.status(401).json({ error: 'Acesso negado. Faça login.' });
}

// Middleware para adicionar configuração do cliente às requisições
function addClientConfig(req, res, next) {
  if (req.session && req.session.clienteId) {
    req.clienteId = req.session.clienteId;
    req.clienteConfig = getClienteConfig(req.clienteId);
  }
  next();
}

// Inicializar middleware de restaurante
const restaurantMiddleware = new RestaurantMiddleware(multiTenantService);

// Função para obter configuração específica do cliente
function getClienteConfig(clienteId) {
  if (!configuracoesPorCliente.has(clienteId)) {
    // Configuração padrão para novo cliente
    configuracoesPorCliente.set(clienteId, {
      databases: {
        main: multiTenantService.getClientDatabase(clienteId, 'main'),
        cardapio: multiTenantService.getClientDatabase(clienteId, 'cardapio'),
        mensagens: multiTenantService.getClientDatabase(clienteId, 'mensagens')
      },
      configuracoes: {
        nomeRestaurante: clientesDB.get(clienteId)?.nome || 'Restaurante',
        telefone: '',
        endereco: '',
        horarioFuncionamento: '18:00-23:00'
      }
    });
    
    // Migrar dados existentes para o primeiro cliente (Brutus Burger)
    if (clienteId === 'brutus-burger') {
      multiTenantService.migrateExistingData(clienteId);
    }
  }
  return configuracoesPorCliente.get(clienteId);
}

// Funções auxiliares para persistência - mensagens agora são salvas automaticamente no banco de dados

function salvarGatilhos() {
  try {
    const gatilhosPath = path.join(__dirname, 'data', 'gatilhos.json');
    
    // Criar diretório data se não existir
    const dataDir = path.dirname(gatilhosPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    fs.writeFileSync(gatilhosPath, JSON.stringify(gatilhosPersonalizados, null, 2), 'utf8');
    console.log('✅ Gatilhos salvos com sucesso');
  } catch (error) {
    console.error('❌ Erro ao salvar gatilhos:', error);
  }
}

function carregarGatilhos() {
  try {
    const gatilhosPath = path.join(__dirname, 'data', 'gatilhos.json');
    if (fs.existsSync(gatilhosPath)) {
      const dados = fs.readFileSync(gatilhosPath, 'utf8');
      gatilhosPersonalizados = JSON.parse(dados);
      console.log('✅ Gatilhos carregados com sucesso');
    }
  } catch (error) {
    console.error('❌ Erro ao carregar gatilhos:', error);
    gatilhosPersonalizados = {};
  }
}

// Helper: tenta obter info do cliente de forma compatível (sync ou callback)
async function obterInformacoesClienteAsync(id, clienteId = 'brutus-burger') {
  try {
    // Tenta retorno síncrono
    const maybe = obterInformacoesCliente(id, null, clienteId);
    if (maybe && typeof maybe === 'object') return maybe;

    // Tenta a versão callback
    return await new Promise((resolve) => {
      let finished = false;
      try {
        obterInformacoesCliente(id, (err, info) => {
          if (finished) return;
          finished = true;
          if (err) return resolve(null);
          return resolve(info || null);
        }, clienteId);
      } catch (e) {
        // Se lançar, não quebra
        finished = true;
        return resolve(null);
      }

      // Fallback timeout rápido
      setTimeout(() => { if (!finished) { finished = true; resolve(null); } }, 300);
    });
  } catch (e) {
    return null;
  }
}

// Função para verificar gatilhos personalizados
async function verificarGatilhosPersonalizados(mensagem, msg, idAtual) {
  // Normaliza texto: minusculas, remove acentos, pontuação e colapsa espaços
  const normalize = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacríticos
    .replace(/[^\w\s]/g, ' ') // substitui pontuação por espaço
    .replace(/\s+/g, ' ')
    .trim();

  const escapeRegex = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const normalizedMsg = normalize(mensagem);
  const messageTokens = normalizedMsg.split(/\s+/).filter(Boolean);

  for (const [id, gatilho] of Object.entries(gatilhosPersonalizados)) {
    let encontrou = false;

    for (const palavraRaw of (gatilho.palavras || [])) {
      const palavra = normalize(palavraRaw);
      if (!palavra) continue;

      if (/\s+/.test(palavra)) {
        // frase composta: busca a frase inteira com limites de palavra
        const phrasePattern = '\\b' + palavra.split(/\s+/).map(p => escapeRegex(p)).join('\\s+') + '\\b';
        const re = new RegExp(phrasePattern, 'i');
        if (re.test(normalizedMsg)) { encontrou = true; break; }
      } else {
        // palavra simples: exige igualdade com um token da mensagem (evita includes)
        if (messageTokens.includes(palavra)) { encontrou = true; break; }
      }
    }

    if (!encontrou) continue;

    // Incrementar contador de usos
    gatilho.usos = (gatilho.usos || 0) + 1;
    salvarGatilhos();

    console.log(`[GATILHO] encontrado para ${idAtual} -> palavras=${JSON.stringify(gatilho.palavras)} acao=${gatilho.acao} mensagem=${gatilho.mensagem}`);

    // Resolver a resposta do gatilho (suporte a string ou objeto {conteudo})
    let resposta = null;
    if (mensagens.mensagem && Object.prototype.hasOwnProperty.call(mensagens.mensagem, gatilho.mensagem)) {
      const entry = mensagens.mensagem[gatilho.mensagem];
      if (typeof entry === 'string') resposta = entry;
      else if (entry && typeof entry === 'object' && entry.conteudo) resposta = entry.conteudo;
    }

    // Se não encontramos uma key, talvez o gatilho.mensagem já seja o texto literal
    if (!resposta && typeof gatilho.mensagem === 'string') resposta = gatilho.mensagem;

    // Enviar resposta, substituindo placeholders (tentativa async de obter nome)
    if (resposta) {
      try {
        let nomeCliente = '';
        try {
          const info = await obterInformacoesClienteAsync(idAtual);
          if (info && info.nome) nomeCliente = info.nome;
        } catch (e) { /* ignore se DB não estiver pronto */ }

        const textoFinal = (resposta || '').replace(/@nome/ig, nomeCliente || '');
        try { msg.reply(textoFinal); } catch (e) { console.error('Erro ao enviar resposta de gatilho:', e); }
      } catch (e) {
        console.error('Erro ao preparar resposta de gatilho:', e);
      }
    }

    // Executar ação do gatilho se existir
    if (gatilho.acao) {
      executarAcaoGatilho(gatilho.acao, msg, idAtual);
    }

    return true; // Gatilho encontrado e tratado
  }

  return false; // Nenhum gatilho encontrado
}

// Função para executar ações específicas dos gatilhos
function executarAcaoGatilho(acao, msg, idAtual) {
  switch (acao) {
    case 'transferir_humano':
      console.log('🤝 Transferindo para atendente humano...');
      // Implementar lógica de transferência
      break;
      
    case 'resetar_conversa':
    case 'resetar_carrinho':
    case 'resetar-carrinho':
    case 'resetarCarrinho':
    case 'reset':
      try {
        // Tenta resetar o carrinho do cliente usando o serviço
        if (typeof resetCarrinho === 'function') {
          const restaurantId = getRestaurantByPhoneNumber(idAtual);
          const carrinhos = carrinhoService.getCarrinhos(restaurantId);
          resetCarrinho(idAtual, carrinhos[idAtual], restaurantId);
          try { msg.reply('🔄 Carrinho reiniciado. Como posso ajudá-lo?'); } catch (e) {}
          console.log(`[ACAO] reset acionado para ${idAtual}`);
        } else {
          console.warn('[ACAO] reset requisitado, mas resetCarrinho não está disponível');
        }
      } catch (e) {
        console.error('Erro ao executar ação de reset:', e);
      }
      break;
    
    case 'mostrar_cardapio':
      try {
        // evita envios duplicados muito próximos (quando gatilho e análise disparam juntos)
        try {
          const idCheck = msg.from.replace('@c.us','');
          if (!carrinhos[idCheck]) { if (carrinhoService && typeof carrinhoService.initCarrinho === 'function') carrinhoService.initCarrinho(idCheck); }
          const last = (carrinhos[idCheck] && carrinhos[idCheck].la5stCardapioSent) || 0;
          const now = Date.now();
          const COOLDOWN = 3000; // ms
          if (now - last < COOLDOWN) {
            console.log(`[ACAO] mostrar_cardapio ignorado (cooldown) para ${idCheck}`);
            break;
          }
          carrinhos[idCheck].lastCardapioSent = now;
        } catch(e) { /* não bloqueia */ }
        // Envia as imagens do cardápio como na análise de palavras
        const cardapioMedia = MessageMedia.fromFilePath('./cardapio.jpg');
        const cardapioMedia2 = MessageMedia.fromFilePath('./cardapio2.jpg');
        // terceiro arquivo opcional
        let cardapioMedia3 = null;
        try { cardapioMedia3 = MessageMedia.fromFilePath('./cardapio3.jpg'); } catch (e) { /* opcional */ }

        // Envia com legenda na primeira imagem
        if (typeof client !== 'undefined' && client) {
          const caption = `Olá! Aqui está o nosso cardápio. Para pedir, basta me dizer o que você gostaria! 🍔`;
          client.sendMessage(msg.from, cardapioMedia, { caption }).then((sent)=>{
            try {
              const id = msg.from.replace('@c.us','');
              if (!carrinhos[id]) { if (carrinhoService && typeof carrinhoService.initCarrinho === 'function') carrinhoService.initCarrinho(id); }
                if (carrinhos[id]) {
                if (!carrinhos[id].messages) carrinhos[id].messages = [];
                carrinhos[id].messages.push({ fromMe: true, text: caption, timestamp: Date.now() });
                if (carrinhos[id].messages.length > 200) carrinhos[id].messages.shift();
                try { events.emit('update', { type: 'message', id, message: { fromMe: true, text: caption, timestamp: Date.now() }, carrinho: sanitizeCarrinho(carrinhos[id]) }); } catch(e){}
              }
            } catch(e){}
          }).catch(()=>{});

          client.sendMessage(msg.from, cardapioMedia2).then((sent)=>{
            try {
              const id = msg.from.replace('@c.us','');
                if (carrinhos[id]) {
                if (!carrinhos[id].messages) carrinhos[id].messages = [];
                carrinhos[id].messages.push({ fromMe: true, text: 'Imagem do cardápio (parte 2)', timestamp: Date.now() });
                if (carrinhos[id].messages.length > 200) carrinhos[id].messages.shift();
                try { events.emit('update', { type: 'message', id, message: { fromMe: true, text: 'Imagem do cardápio (parte 2)', timestamp: Date.now() }, carrinho: sanitizeCarrinho(carrinhos[id]) }); } catch(e){}
              }
            } catch(e){}
          }).catch(()=>{});
          if (cardapioMedia3) client.sendMessage(msg.from, cardapioMedia3).then((sent)=>{
            try {
              const id = msg.from.replace('@c.us','');
                if (carrinhos[id]) {
                if (!carrinhos[id].messages) carrinhos[id].messages = [];
                carrinhos[id].messages.push({ fromMe: true, text: 'Imagem do cardápio (parte 3)', timestamp: Date.now() });
                if (carrinhos[id].messages.length > 200) carrinhos[id].messages.shift();
                try { events.emit('update', { type: 'message', id, message: { fromMe: true, text: 'Imagem do cardápio (parte 3)', timestamp: Date.now() }, carrinho: sanitizeCarrinho(carrinhos[id]) }); } catch(e){}
              }
            } catch(e){}
          }).catch(()=>{});
        } else {
          // Fallback: responde texto caso client não esteja disponível
          msg.reply('Aqui está o cardápio: (imagens indisponíveis no momento).');
        }

        if (carrinhos[idAtual]) carrinhos[idAtual].aprt = true;
      } catch (e) {
        console.error('Erro ao executar ação mostrar_cardapio:', e);
      }
      break;
  }
}

clientService.createBanco('brutus-burger');

// Inicializar serviço de mensagens de forma assíncrona
(async () => {
    try {
        await mensagensService.init();
        console.log('[SISTEMA] MensagensService inicializado com sucesso');
    } catch (error) {
        console.error('[SISTEMA] Erro ao inicializar MensagensService:', error);
    }
})();

// Importar sistema de mensagens para invalidar cache
const { refreshMensagens } = require('./src/utils/mensagens');

// Carregar gatilhos personalizados
carregarGatilhos();

// --- Configura servidor de dashboard (admin) ---
const publicDir = path.join(process.cwd(), 'public');

// === ROTAS DE AUTENTICAÇÃO ===

// Login
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, senha } = req.body;
    
    if (!email || !senha) {
      return res.status(400).json({ error: 'Email e senha são obrigatórios' });
    }
    
    // Buscar cliente por email
    let clienteEncontrado = null;
    for (const [id, cliente] of clientesDB) {
      if (cliente.email === email && cliente.senha === senha && cliente.ativo) {
        clienteEncontrado = cliente;
        break;
      }
    }
    
    if (!clienteEncontrado) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }
    
    // Criar sessão
    console.log('[DEBUG] Login - cliente encontrado:', clienteEncontrado.id);
    req.session.clienteId = clienteEncontrado.id;
    console.log('[DEBUG] Login - sessão antes do save:', req.session);
    req.session.save((err) => {
      if (err) {
        console.error('[DEBUG] Login - erro ao salvar sessão:', err);
      } else {
        console.log('[DEBUG] Login - sessão salva com sucesso');
      }
    });
    
    console.log('[DEBUG] Login - sessão após definir clienteId:', req.session);
    
    res.json({ 
      success: true, 
      cliente: {
        id: clienteEncontrado.id,
        nome: clienteEncontrado.nome,
        email: clienteEncontrado.email
      },
      redirectUrl: `/pedidos-${clienteEncontrado.id}.html?restaurant=${clienteEncontrado.id}`
    });
  } catch (err) {
    console.error('Erro no login:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// Logout
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Erro ao fazer logout' });
    }
    res.json({ success: true });
  });
});

// Verificar sessão
app.get('/api/auth/me', (req, res) => {
  if (req.session && req.session.clienteId) {
    const cliente = clientesDB.get(req.session.clienteId);
    if (cliente && cliente.ativo) {
      return res.json({
        id: cliente.id,
        nome: cliente.nome,
        email: cliente.email
      });
    }
  }
  res.status(401).json({ error: 'Não autenticado' });
});

// Registro de novo cliente/restaurante
app.post('/api/auth/register', (req, res) => {
  try {
    const { nome, email, senha } = req.body;
    
    if (!nome || !email || !senha) {
      return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
    }
    
    // Verificar se email já existe
    for (const [id, cliente] of clientesDB) {
      if (cliente.email === email) {
        return res.status(400).json({ error: 'Email já cadastrado' });
      }
    }
    
    // Criar ID único para o cliente
    const clienteId = nome.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
    
    const novoCliente = {
      id: clienteId,
      nome,
      email,
      senha, // Em produção, usar hash
      ativo: true,
      dataCriacao: new Date()
    };
    
    clientesDB.set(clienteId, novoCliente);
    
    // Criar configuração inicial para o cliente
    getClienteConfig(clienteId);
    
    res.json({ 
      success: true, 
      cliente: {
        id: novoCliente.id,
        nome: novoCliente.nome,
        email: novoCliente.email
      }
    });
  } catch (err) {
    console.error('Erro no registro:', err);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// === FIM ROTAS DE AUTENTICAÇÃO ===

// API simples para recuperar o estado atual dos carrinhos (útil para o dashboard)
// Rota com restaurante no path
app.get('/api/:restaurantId/carrinhos', requireAuth, restaurantMiddleware.validateRestaurant(), (req, res) => {
  try {
    const restaurantId = req.params.restaurantId || req.restaurantId;
    console.log('[API] /api/:restaurantId/carrinhos -> restaurantId:', restaurantId);
    const carrinhos = carrinhoService.getCarrinhos(restaurantId);
    res.json({ carrinhos });
  } catch (err) {
    res.status(500).json({ error: 'failed to read carrinhos' });
  }
});

// Rota alternativa via query parameter
app.get('/api/carrinhos', requireAuth, (req, res) => {
  try {
    const restaurantId = req.query.restaurant || 'brutus-burger';
    console.log('[API] /api/carrinhos -> restaurantId:', restaurantId);
    const carrinhos = carrinhoService.getCarrinhos(restaurantId);
    res.json({ carrinhos });
  } catch (err) {
    res.status(500).json({ error: 'failed to read carrinhos' });
  }
});

// APIs para gerenciar mensagens
// Rota com restaurante no path
app.get('/api/:restaurantId/mensagens', requireAuth, restaurantMiddleware.validateRestaurant(), (req, res) => {
  console.log('[API] /api/:restaurantId/mensagens -> chamada recebida para cliente:', req.restaurantId);
  try {
    const db = req.clienteConfig.databases.mensagens;
    const mensagens = db.prepare('SELECT * FROM mensagens ORDER BY id DESC').all();
    console.log('[API] /api/:restaurantId/mensagens -> mensagens encontradas:', mensagens.length);
    res.json(mensagens);
  } catch (err) {
    console.error('[API] /api/:restaurantId/mensagens -> erro:', err);
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

// Rota alternativa via query parameter
app.get('/api/mensagens', requireAuth, (req, res) => {
  const restaurantId = req.query.restaurant || 'brutus-burger';
  console.log('[API] /api/mensagens -> chamada recebida para restaurant:', restaurantId);
  try {
    // Usar multiTenantService para obter mensagens
    const multiTenantService = require('./src/services/multiTenantService');
    const db = multiTenantService.getClientDatabase(restaurantId, 'mensagens');
    const mensagens = db.prepare('SELECT * FROM mensagens ORDER BY id DESC').all();
    console.log('[API] /api/mensagens -> mensagens encontradas:', mensagens.length);
    res.json(mensagens);
  } catch (err) {
    console.error('[API] /api/mensagens -> erro:', err);
    res.status(500).json({ error: 'Erro ao buscar mensagens' });
  }
});

app.post('/api/mensagens', requireAuth, restaurantMiddleware.validateRestaurant(), (req, res) => {
  try {
    const { titulo, conteudo, categoria } = req.body;
    if (!titulo || !conteudo) {
      return res.status(400).json({ error: 'Título e conteúdo são obrigatórios' });
    }
    
    const db = req.clienteConfig.databases.mensagens;
    const stmt = db.prepare(`
      INSERT INTO mensagens (titulo, conteudo, categoria, ativo, data_criacao, data_atualizacao)
      VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `);
    const result = stmt.run(titulo, conteudo, categoria || 'geral');
    
    io.to(req.restaurantId).emit('mensagem-atualizada', { id: result.lastInsertRowid, acao: 'criada', clienteId: req.clienteId });
    
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('Erro ao salvar mensagem:', err);
    res.status(500).json({ error: 'Erro ao salvar mensagem' });
  }
});

app.put('/api/mensagens/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { titulo, conteudo, tipo, ativo } = req.body;
    
    if (!titulo || !conteudo) {
      return res.status(400).json({ error: 'Título e conteúdo são obrigatórios' });
    }
    
    const result = mensagensService.updateMensagem(id, { titulo, conteudo, tipo, ativo });
    
    if (result.changes > 0) {
      refreshMensagens(); // Invalidar cache de mensagens
      io.to(req.restaurantId).emit('mensagem-atualizada', { id, acao: 'atualizada' });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Mensagem não encontrada' });
    }
  } catch (err) {
    console.error('Erro ao atualizar mensagem:', err);
    res.status(500).json({ error: 'Erro ao atualizar mensagem' });
  }
});

app.delete('/api/mensagens/:id', (req, res) => {
  try {
    const { id } = req.params;
    const result = mensagensService.deleteMensagem(id);
    
    if (result.changes > 0) {
      refreshMensagens(); // Invalidar cache de mensagens
      io.to(req.restaurantId).emit('mensagem-atualizada', { id, acao: 'excluida' });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Mensagem não encontrada' });
    }
  } catch (err) {
    console.error('Erro ao excluir mensagem:', err);
    res.status(500).json({ error: 'Erro ao excluir mensagem' });
  }
});

// APIs para gerenciar gatilhos

app.get('/api/gatilhos', requireAuth, restaurantMiddleware.validateRestaurant(), (req, res) => {
  try {
    const gatilhos = mensagensService.getAllGatilhos();
    res.json(gatilhos);
  } catch (err) {
    console.error('Erro ao buscar gatilhos:', err);
    res.status(500).json({ error: 'Erro ao buscar gatilhos' });
  }
});

app.post('/api/gatilhos', requireAuth, restaurantMiddleware.validateRestaurant(), (req, res) => {
  try {
    const { palavra, mensagem_id, categoria } = req.body;
    if (!palavra || !mensagem_id) {
      return res.status(400).json({ error: 'Palavra e mensagem são obrigatórios' });
    }
    
    const result = mensagensService.addGatilho({ palavra, mensagem_id, categoria });
    io.to(req.restaurantId).emit('gatilho-atualizado', { id: result.lastInsertRowid, acao: 'criado' });
    
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (err) {
    console.error('Erro ao salvar gatilho:', err);
    res.status(500).json({ error: 'Erro ao salvar gatilho' });
  }
});

app.put('/api/gatilhos/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const { palavra, mensagem_id, categoria, ativo } = req.body;
    
    if (!palavra || !mensagem_id) {
      return res.status(400).json({ error: 'Palavra e mensagem são obrigatórios' });
    }
    
    const result = mensagensService.updateGatilho(id, { palavra, mensagem_id, categoria, ativo });
    
    if (result.changes > 0) {
      io.to(req.restaurantId).emit('gatilho-atualizado', { id, acao: 'atualizado' });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Gatilho não encontrado' });
    }
  } catch (err) {
    console.error('Erro ao atualizar gatilho:', err);
    res.status(500).json({ error: 'Erro ao atualizar gatilho' });
  }
});

app.delete('/api/gatilhos/:id', requireAuth, (req, res) => {
  try {
    const { id } = req.params;
    const result = mensagensService.deleteGatilho(id);
    
    if (result.changes > 0) {
      io.to(req.restaurantId).emit('gatilho-atualizado', { id, acao: 'excluido' });
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Gatilho não encontrado' });
    }
  } catch (err) {
    console.error('Erro ao excluir gatilho:', err);
    res.status(500).json({ error: 'Erro ao excluir gatilho' });
  }
});

// API para estatísticas
app.get('/api/estatisticas', requireAuth, restaurantMiddleware.validateRestaurant(), (req, res) => {
  try {
    const hoje = new Date().toDateString();
    const totalCarrinhos = Object.keys(carrinhos).length;
    
    res.json({
      totalMensagens: Object.keys(mensagens.mensagem || {}).length,
      totalGatilhos: Object.keys(gatilhosPersonalizados).length,
      mensagensHoje: 0, // Implementar contador de mensagens por dia
      usuariosAtivos: totalCarrinhos
    });
  } catch (err) {
    res.status(500).json({ error: 'failed to read estatisticas' });
  }
});

// Endpoint temporário para debug (sem autenticação)
app.get('/api/cardapio/debug', async (req, res) => {
  try {
    console.log('[DEBUG] Endpoint debug chamado');
    await cardapioService.init();
    const clienteId = 'brutus-burger';
    console.log('[DEBUG] Debug endpoint - clienteId:', clienteId);
    const items = await cardapioService.getItems(clienteId);
    console.log('[DEBUG] Debug endpoint - items found:', items?.length || 0);
    console.log('[DEBUG] Debug endpoint - items:', JSON.stringify(items, null, 2));
    res.json({ ok: true, items, debug: true });
  } catch (e) { 
    console.error('/api/cardapio/debug error', e); 
    res.status(500).json({ ok: false, error: String(e), debug: true }); 
  }
});

// Cardapio REST API
app.get('/api/cardapio', restaurantMiddleware.identifyRestaurant(), restaurantMiddleware.validateRestaurant(), async (req, res) => {
  console.log('[DEBUG] GET /api/cardapio - ENDPOINT CHAMADO');
  try {
    await cardapioService.init();
    const clienteId = req.restaurantId || 'brutus-burger';
    console.log('[DEBUG] GET /api/cardapio - clienteId:', clienteId);
    const items = await cardapioService.getItems(clienteId);
    console.log('[DEBUG] GET /api/cardapio - items found:', items?.length || 0);
    res.json({ ok: true, items });
  } catch (e) { console.error('/api/cardapio GET error', e); 
    res.status(500).json({ ok: false, error: String(e) }); 
  }
});

app.post('/api/cardapio', restaurantMiddleware.identifyRestaurant(), restaurantMiddleware.validateRestaurant(), async (req, res) => {
  try {
    const { nome, descricao, preco, tipo } = req.body || {};
    if (!nome) return res.status(400).json({ ok: false, error: 'missing_nome' });
    
    const clienteId = req.restaurantId || 'brutus-burger';
    const id = await cardapioService.addItem(clienteId, { nome, descricao, preco, tipo });
    if (!id) return res.status(500).json({ ok: false, error: 'insert_failed' });
    
    // broadcast items update
    try { 
      const items = await cardapioService.getItems(clienteId); 
      io.to(req.restaurantId).emit('admin:cardapio', { ok: true, items, clienteId }); 
    } catch(e){}
    
    res.json({ ok: true, id });
  } catch (e) { console.error('/api/cardapio POST error', e); res.status(500).json({ ok: false, error: String(e) }); }
});

app.put('/api/cardapio/:id', restaurantMiddleware.identifyRestaurant(), restaurantMiddleware.validateRestaurant(), async (req, res) => {
  try {
    const id = req.params.id;
    const { nome, descricao, preco, tipo } = req.body || {};
    if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });
    if (!nome) return res.status(400).json({ ok: false, error: 'missing_nome' });
    
    const clienteId = req.restaurantId || 'brutus-burger';
    const ok = await cardapioService.updateItem(clienteId, id, { nome, descricao, preco, tipo });
    
    if (ok) {
      // broadcast items update
      try { 
        const items = await cardapioService.getItems(clienteId); 
        io.to(req.restaurantId).emit('admin:cardapio', { ok: true, items, clienteId }); 
      } catch(e){}
      res.json({ ok: true });
    } else {
      res.status(500).json({ ok: false, error: 'update_failed' });
    }
  } catch (e) { console.error('/api/cardapio PUT error', e); res.status(500).json({ ok: false, error: String(e) }); }
});

app.delete('/api/cardapio/:id', restaurantMiddleware.identifyRestaurant(), restaurantMiddleware.validateRestaurant(), async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });
    
    const clienteId = req.restaurantId || 'brutus-burger';
    const ok = await cardapioService.removeItem(clienteId, id);
    
    if (ok) {
      // broadcast items update
      try { 
        const items = await cardapioService.getItems(clienteId); 
        io.to(req.restaurantId).emit('admin:cardapio', { ok: true, items, clienteId }); 
      } catch(e){}
    }
    res.json({ ok });
  } catch (e) { console.error('/api/cardapio DELETE error', e); res.status(500).json({ ok: false, error: String(e) }); }
});

// mappings REST
app.get('/api/cardapio/mappings', restaurantMiddleware.identifyRestaurant(), restaurantMiddleware.validateRestaurant(), async (req, res) => {
  try {
    await cardapioService.init();
    const clienteId = req.restaurantId || 'brutus-burger';
    const mappings = await cardapioService.getMappings(clienteId);
    res.json({ ok: true, mappings });
  } catch (e) { console.error('/api/cardapio/mappings GET error', e); res.status(500).json({ ok: false, error: String(e) }); }
});

app.post('/api/cardapio/mappings', restaurantMiddleware.identifyRestaurant(), restaurantMiddleware.validateRestaurant(), async (req, res) => {
  try {
    const { nome, itemId } = req.body || {};
    if (!nome || !itemId) return res.status(400).json({ ok: false, error: 'missing_fields' });
    await cardapioService.init();
    const clienteId = req.restaurantId || 'brutus-burger';
    const ok = await cardapioService.addMapping(clienteId, nome, Number(itemId));
    // broadcast
    try { const mappings = await cardapioService.getMappings(clienteId); io.to(req.restaurantId).emit('admin:mappings', { ok: true, mappings }); } catch(e){}
    res.json({ ok: !!ok });
  } catch (e) { console.error('/api/cardapio/mappings POST error', e); res.status(500).json({ ok: false, error: String(e) }); }
});

// API para adicionar múltiplos gatilhos de uma vez
app.post('/api/cardapio/mappings/multiple', restaurantMiddleware.identifyRestaurant(), restaurantMiddleware.validateRestaurant(), async (req, res) => {
  try {
    const { gatilhos, itemId } = req.body || {};
    if (!Array.isArray(gatilhos) || !itemId) return res.status(400).json({ ok: false, error: 'missing_fields' });
    await cardapioService.init();
    const clienteId = req.restaurantId || 'brutus-burger';
    const ok = cardapioService.addMultipleMappings(clienteId, gatilhos, Number(itemId));
    // broadcast
    try { const mappings = cardapioService.getMappings(clienteId); io.to(req.restaurantId).emit('admin:mappings', { ok: true, mappings }); } catch(e){}
    res.json({ ok: !!ok });
  } catch (e) { console.error('/api/cardapio/mappings/multiple POST error', e); res.status(500).json({ ok: false, error: String(e) }); }
});

// API para obter gatilhos de um item específico
app.get('/api/cardapio/mappings/item/:id', restaurantMiddleware.identifyRestaurant(), restaurantMiddleware.validateRestaurant(), async (req, res) => {
  try {
    const itemId = req.params.id;
    if (!itemId) return res.status(400).json({ ok: false, error: 'missing_id' });
    await cardapioService.init();
    const clienteId = req.restaurantId || 'brutus-burger';
    const gatilhos = cardapioService.getMappingsByItemId(clienteId, Number(itemId));
    res.json({ ok: true, gatilhos });
  } catch (e) { console.error('/api/cardapio/mappings/item GET error', e); res.status(500).json({ ok: false, error: String(e) }); }
});

app.delete('/api/cardapio/mappings/:nome', restaurantMiddleware.identifyRestaurant(), restaurantMiddleware.validateRestaurant(), async (req, res) => {
  try {
    const nome = req.params.nome;
    if (!nome) return res.status(400).json({ ok: false, error: 'missing_nome' });
    await cardapioService.init();
    const clienteId = req.restaurantId || 'brutus-burger';
    const ok = cardapioService.removeMapping(clienteId, nome);
    try { const mappings = cardapioService.getMappings(clienteId); io.to(req.restaurantId).emit('admin:mappings', { ok: true, mappings }); } catch(e){}
    res.json({ ok: !!ok });
  } catch (e) { console.error('/api/cardapio/mappings DELETE error', e); res.status(500).json({ ok: false, error: String(e) }); }
});

// === ROTAS PARA SISTEMA MULTI-TENANT ===

// API para gerenciar restaurantes
app.get('/api/restaurants', async (req, res) => {
  try {
    const restaurants = await restaurantMiddleware.getAllRestaurants();
    res.json({ ok: true, restaurants });
  } catch (error) {
    console.error('Erro ao buscar restaurantes:', error);
    res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
  }
});

// API: obter informações do restaurante atual
app.get('/api/restaurant/current', async (req, res) => {
  try {
    console.log('[DEBUG] /api/restaurant/current chamado');
    console.log('[DEBUG] Query params:', req.query);
    console.log('[DEBUG] Session:', req.session);
    const clienteId = req.query.clienteId || req.session.clienteId;
    
    if (!clienteId) {
      return res.status(400).json({ error: 'Cliente ID é obrigatório' });
    }

    // Buscar informações do cliente no banco de dados
    const cliente = clientesDB.get(clienteId);
    
    if (!cliente) {
      return res.status(404).json({ error: 'Restaurante não encontrado' });
    }

    // Retornar informações básicas do restaurante (sem dados sensíveis)
    const restaurantInfo = {
      id: cliente.id,
      nome: cliente.nome,
      email: cliente.email,
      ativo: cliente.ativo,
      dataCriacao: cliente.dataCriacao,
      configuracoes: configuracoesPorCliente.get(clienteId) || {}
    };

    res.json(restaurantInfo);
  } catch (error) {
    console.error('Erro ao obter informações do restaurante:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.get('/api/restaurant/:id', async (req, res) => {
  try {
    const restaurant = await restaurantMiddleware.getRestaurant(req.params.id);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurante não encontrado' });
    }
    res.json(restaurant);
  } catch (error) {
    console.error('Erro ao buscar restaurante:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

app.post('/api/restaurants', async (req, res) => {
  try {
    const restaurant = await restaurantMiddleware.addRestaurant(req.body);
    res.status(201).json(restaurant);
  } catch (error) {
    console.error('Erro ao criar restaurante:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
});

app.put('/api/restaurants/:id', async (req, res) => {
  try {
    const restaurant = await restaurantMiddleware.updateRestaurant(req.params.id, req.body);
    if (!restaurant) {
      return res.status(404).json({ error: 'Restaurante não encontrado' });
    }
    res.json(restaurant);
  } catch (error) {
    console.error('Erro ao atualizar restaurante:', error);
    res.status(500).json({ error: error.message || 'Erro interno do servidor' });
  }
});

app.delete('/api/restaurants/:id', async (req, res) => {
  try {
    const success = await restaurantMiddleware.deactivateRestaurant(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Restaurante não encontrado' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao desativar restaurante:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==== BOT CONTROL ENDPOINTS ====

// Endpoint para obter status do bot de um restaurante
app.get('/api/admin/bot-status', (req, res) => {
  try {
    const restaurantId = req.query.restaurantId || 'brutus-burger';
    const status = carrinhoService.getBotStatus(restaurantId);
    
    console.log(`[API] Status do bot para ${restaurantId}: ${status ? 'ATIVO' : 'INATIVO'}`);
    
    res.json({
      ok: true,
      restaurantId,
      status
    });
  } catch (error) {
    console.error('Erro ao obter status do bot:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// Endpoint para alterar status do bot de um restaurante
app.post('/api/admin/bot-toggle', (req, res) => {
  try {
    const { restaurantId = 'brutus-burger', status } = req.body;
    
    if (typeof status !== 'boolean') {
      return res.status(400).json({
        ok: false,
        error: 'Status deve ser um valor booleano'
      });
    }
    
    const newStatus = carrinhoService.setBotStatus(restaurantId, status);
    
    console.log(`[API] Bot ${newStatus ? 'ATIVADO' : 'DESATIVADO'} para ${restaurantId}`);
    
    res.json({
      ok: true,
      restaurantId,
      status: newStatus,
      message: `Bot ${newStatus ? 'ativado' : 'desativado'} com sucesso!`
    });
  } catch (error) {
    console.error('Erro ao alterar status do bot:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Erro interno do servidor' 
    });
  }
});

// ==== BACKUP & RESTORE ENDPOINTS ====

// Endpoint para backup do cardápio
app.get('/api/admin/backup-cardapio', async (req, res) => {
  try {
    const restaurantId = req.query.restaurantId || 'brutus-burger';
    console.log(`[BACKUP] Fazendo backup do cardápio para ${restaurantId}`);
    
    const items = await cardapioService.getAllItems(restaurantId);
    
    const backupData = {
      restaurantId,
      timestamp: new Date().toISOString(),
      version: '1.0',
      type: 'cardapio',
      items: items || []
    };
    
    console.log(`[BACKUP] Backup do cardápio concluído: ${items ? items.length : 0} itens`);
    
    res.json({
      ok: true,
      data: backupData
    });
  } catch (error) {
    console.error('Erro ao fazer backup do cardápio:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Erro ao fazer backup do cardápio' 
    });
  }
});

// Endpoint para backup dos mapeamentos IA (retorna array de objetos no mesmo padrão de backup do cardápio)
app.get('/api/admin/backup-mapeamentos', async (req, res) => {
  try {
    const restaurantId = req.query.restaurantId || 'brutus-burger';
    console.log(`[BACKUP] Fazendo backup dos mapeamentos para ${restaurantId}`);

    // Usar a nova função que retorna um array de objetos { item_id, palavra_chave }
    const mappings = await cardapioService.getMappingsArray(restaurantId);

    const backupData = {
      restaurantId,
      timestamp: new Date().toISOString(),
      version: '1.0',
      type: 'mapeamentos',
      mappings: mappings || []
    };

    console.log(`[BACKUP] Backup dos mapeamentos concluído: ${mappings ? mappings.length : 0} mapeamentos`);

    res.json({
      ok: true,
      data: backupData
    });
  } catch (error) {
    console.error('Erro ao fazer backup dos mapeamentos:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Erro ao fazer backup dos mapeamentos' 
    });
  }
});

// Admin: visualizar mapeamentos de telefone
app.get('/api/admin/phone-mappings', (req, res) => {
  try {
    const out = {};
    for (const [k, v] of phoneToRestaurantMap) out[k] = v;
    res.json({ ok: true, mappings: out });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// Admin: atualizar/definir mapeamentos (substitui o objeto inteiro)
app.post('/api/admin/phone-mappings', (req, res) => {
  try {
    const obj = req.body;
    if (!obj || typeof obj !== 'object') return res.status(400).json({ ok: false, error: 'invalid_payload' });
    phoneToRestaurantMap.clear();
    for (const [k, v] of Object.entries(obj)) phoneToRestaurantMap.set(String(k), String(v));
    // Persistir no arquivo
    try { fs.writeFileSync(phoneMappingsPath, JSON.stringify(Object.fromEntries(phoneToRestaurantMap), null, 2), 'utf8'); } catch (e) { console.error('📱 [PHONE-MAPPING] erro ao salvar arquivo:', e); }

    // Persistir também nos bancos dos restaurantes (inserir na tabela clientes para referência)
    try {
      for (const [phone, rest] of Object.entries(Object.fromEntries(phoneToRestaurantMap))) {
        try {
          const clienteId = String(rest || 'brutus-burger');
          const cleanPhone = String(phone).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
          const mainDb = multiTenantService.getClientDatabase(clienteId, 'main');
          try {
            mainDb.prepare('INSERT OR IGNORE INTO clientes (numero, nome) VALUES (?, ?)').run(cleanPhone, `Contato mapeado ${cleanPhone}`);
          } catch (e) { /* best-effort */ }
        } catch (e) {
          console.warn('[PHONE-MAPPING] Falha ao persistir mapping via API para', phone, e && e.message ? e.message : e);
        }
      }
      console.log('📱 [PHONE-MAPPING] Mapeamentos persistidos via API nos DBs dos restaurantes');
    } catch (e) {
      console.warn('📱 [PHONE-MAPPING] Erro ao persistir mappings via API:', e && e.message ? e.message : e);
    }
    res.json({ ok: true, mappings: Object.fromEntries(phoneToRestaurantMap) });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// Admin: definir um único mapeamento (phone -> restaurant)
app.post('/api/admin/phone-mappings/set', (req, res) => {
  try {
    const { phone, restaurantId } = req.body || {};
    if (!phone || !restaurantId) return res.status(400).json({ ok: false, error: 'missing_phone_or_restaurantId' });
    const cleanPhone = String(phone).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
    phoneToRestaurantMap.set(cleanPhone, String(restaurantId));
    // Persist to file
    try { fs.writeFileSync(phoneMappingsPath, JSON.stringify(Object.fromEntries(phoneToRestaurantMap), null, 2), 'utf8'); } catch (e) { console.error('📱 [PHONE-MAPPING] erro ao salvar arquivo:', e); }

    // Persist into restaurant DB if possible
    try {
      const mainDb = multiTenantService.getClientDatabase(String(restaurantId), 'main');
      try { mainDb.prepare('INSERT OR IGNORE INTO clientes (numero, nome) VALUES (?, ?)').run(cleanPhone, `Contato mapeado ${cleanPhone}`); } catch (e) { /* best-effort */ }
    } catch (e) {
      console.warn('[PHONE-MAPPING] Falha ao persistir mapping single-set API for', cleanPhone, e && e.message ? e.message : e);
    }

    res.json({ ok: true, mapping: { [cleanPhone]: String(restaurantId) } });
  } catch (e) { res.status(500).json({ ok: false, error: String(e) }); }
});

// Endpoint para restaurar cardápio
app.post('/api/admin/restore-cardapio', async (req, res) => {
  try {
    const { restaurantId, data } = req.body;
    
    if (!data || !data.items) {
      return res.status(400).json({
        ok: false,
        error: 'Dados de backup inválidos'
      });
    }
    
    console.log(`[RESTORE] Restaurando cardápio para ${restaurantId}: ${data.items.length} itens`);
    
    // Limpar cardápio atual
    await cardapioService.clearAllItems(restaurantId);
    
    // Restaurar itens
    for (const item of data.items) {
      await cardapioService.addItem(restaurantId, item);
    }
    
    console.log(`[RESTORE] Cardápio restaurado com sucesso para ${restaurantId}`);
    
    res.json({
      ok: true,
      message: 'Cardápio restaurado com sucesso',
      itemsRestored: data.items.length
    });
  } catch (error) {
    console.error('Erro ao restaurar cardápio:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Erro ao restaurar cardápio' 
    });
  }
});

// Endpoint para restaurar mapeamentos
app.post('/api/admin/restore-mapeamentos', async (req, res) => {
  try {
    const { restaurantId, data } = req.body;
    
    // Validar e extrair mapeamentos de diferentes estruturas
    let mappings = null;
    
    if (!data) {
      return res.status(400).json({
        ok: false,
        error: 'Dados de backup não fornecidos'
      });
    }
    
    // Estrutura 1: { mappings: [...] }
    if (data.mappings && Array.isArray(data.mappings)) {
      mappings = data.mappings;
    }
    // Estrutura 2: { data: { mappings: [...] } }
    else if (data.data && data.data.mappings && Array.isArray(data.data.mappings)) {
      mappings = data.data.mappings;
    }
    // Estrutura 3: Array direto
    else if (Array.isArray(data)) {
      mappings = data;
    }
    
    if (!mappings || !Array.isArray(mappings) || mappings.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Dados de backup inválidos - nenhum mapeamento encontrado'
      });
    }
    
    console.log(`[RESTORE] Restaurando mapeamentos para ${restaurantId}: ${mappings.length} mapeamentos`);
    
    // Limpar mapeamentos atuais (comentar esta linha se quiser manter os existentes)
    await cardapioService.clearAllMappings(restaurantId);
    
    // Restaurar mapeamentos
    let addedCount = 0;
    let errorCount = 0;
    
    for (const mapping of mappings) {
      try {
        // Validar estrutura do mapeamento
        if (!mapping.item_id || !mapping.palavra_chave) {
          console.warn(`[RESTORE] Mapeamento inválido ignorado:`, mapping);
          errorCount++;
          continue;
        }

        // addMapping(clienteId, nome, itemId)
        await cardapioService.addMapping(restaurantId, mapping.palavra_chave, mapping.item_id);
        addedCount++;
      } catch (error) {
        console.warn(`[RESTORE] Erro ao restaurar mapeamento: ${mapping.palavra_chave} -> ${mapping.item_id}`, error.message);
        errorCount++;
      }
    }
    
    console.log(`[RESTORE] Mapeamentos restaurados para ${restaurantId}: ${addedCount} sucesso, ${errorCount} erros`);
    
    res.json({
      ok: true,
      message: 'Mapeamentos restaurados com sucesso',
      mappingsRestored: addedCount,
      totalMappings: mappings.length,
      errors: errorCount
    });
  } catch (error) {
    console.error('Erro ao restaurar mapeamentos:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Erro interno ao restaurar mapeamentos: ' + error.message
    });
  }
});

// Endpoint para resetar cardápio (limpar tudo)
app.post('/api/admin/reset-cardapio', async (req, res) => {
  try {
    const { restaurantId } = req.body;
    
    console.log(`[RESET] Resetando cardápio para ${restaurantId}`);
    
    // Limpar cardápio
    await cardapioService.clearAllItems(restaurantId);
    
    // Limpar mapeamentos também
    await cardapioService.clearAllMappings(restaurantId);
    
    console.log(`[RESET] Cardápio resetado com sucesso para ${restaurantId}`);
    
    res.json({
      ok: true,
      message: 'Cardápio resetado com sucesso'
    });
  } catch (error) {
    console.error('Erro ao resetar cardápio:', error);
    res.status(500).json({ 
      ok: false, 
      error: 'Erro ao resetar cardápio' 
    });
  }
});

// Conveniência: rota específica para "entregues" (saiu_para_entrega)
app.get('/api/pedidos/entregues', restaurantMiddleware.identifyRestaurant(), restaurantMiddleware.validateRestaurant(), async (req, res) => {
  try {
    // Buscar de forma mais tolerante: se houver estado query, use ele; caso contrário, retorna pedidos
    // cujo estado contenha 'saiu' ou 'entreg' (cobre variações como 'saiu_para_entrega' ou 'entregue')
    const qEstado = req.query.estado || null;
    const clienteId = req.restaurantId || 'brutus-burger';
    let pedidos = [];
    if (qEstado && clientService.obterPedidosPorEstado) {
      pedidos = clientService.obterPedidosPorEstado(qEstado, clienteId);
    } else if (clientService.obterPedidosPorEstado) {
      // busca todos e filtra localmente para ser mais permissivo
      const all = clientService.obterPedidosPorEstado(null, clienteId);
      pedidos = (all || []).filter(p => {
        if (!p || !p.estado) return false;
        const e = String(p.estado).toLowerCase();
        return e.includes('saiu') || e.includes('entreg');
      });
    }

    // NOVO: Filtrar apenas pedidos de hoje
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const todayEnd = todayStart + (24 * 60 * 60 * 1000) - 1;
    
    pedidos = pedidos.filter(p => {
      if (!p || !p.ts) return false;
      const pedidoTime = new Date(p.ts).getTime();
      return pedidoTime >= todayStart && pedidoTime <= todayEnd;
    });
    try {
      // Debug: log how many pedidos were found for entregues and the first few ids
      const ids = (pedidos || []).slice(0, 10).map(p => p && (p.id || p.numero || p.idpedido || '(unknown)'));
      console.log(`[API] /api/pedidos/entregues -> encontrados ${ (pedidos || []).length } pedidos. amostra ids: ${JSON.stringify(ids)}`);
    } catch (e) { console.error('[API] erro logando entregues debug', e); }
    // If DB returned empty, try in-memory fallback from carrinhos to avoid UI races
    if ((!pedidos || pedidos.length === 0) && carrinhoService) {
      try {
        const fallback = [];
        // Obter carrinhos específicos do restaurante
        const carrinhos = carrinhoService.getCarrinhos ? carrinhoService.getCarrinhos(clienteId) : {};
        for (const k of Object.keys(carrinhos)) {
          try {
            const c = carrinhos[k];
            const estado = (c && c.estado) ? String(c.estado).toLowerCase() : '';
            if (estado.includes('saiu') || estado.includes('entreg')) {
              const carrinhoTime = (c && c.ts) || Date.now();
              // Filtrar apenas carrinhos de hoje
              if (carrinhoTime >= todayStart && carrinhoTime <= todayEnd) {
                fallback.push({ id: c._pedidoId || `${k}_${carrinhoTime}`, cliente: k.replace(/@s\.whatsapp\.net$/,'').replace(/@c\.us$/,''), ts: carrinhoTime, total: Number(c.valorTotal||0), endereco: c.endereco || null, estado: c.estado, items: c.carrinho || [] });
              }
            }
          } catch (e) { /* per-item ignore */ }
        }
        if (fallback.length > 0) {
          try { console.log('[API] /api/pedidos/entregues -> usando fallback em-mem com', fallback.length, 'itens'); } catch(e){}
          return res.json({ ok: true, pedidos: fallback });
        }
      } catch (e) { console.error('[API] entregues fallback error', e); }
    }
    res.json({ ok: true, pedidos });
  } catch (err) {
    console.error('Erro /api/pedidos/entregues', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});







// API: totais do dia para o dashboard (total em produtos e total de entregas finalizadas hoje)
app.get('/api/pedidos/totais-dia', restaurantMiddleware.identifyRestaurant(), (req, res) => {
  try {
    console.log('[API] /api/pedidos/totais-dia -> chamada recebida');
    const clienteId = req.restaurantId || 'brutus-burger';
    const all = (clientService && typeof clientService.obterPedidosPorEstado === 'function') ? clientService.obterPedidosPorEstado(null, clienteId) : [];
    console.log('[API] /api/pedidos/totais-dia -> pedidos encontrados:', all.length);
    const today = new Date();
    const todayKey = today.toDateString();
    let totalProdutos = 0;
    let totalEntregues = 0;
    let countProdutos = 0;
    let countEntregues = 0;

    // Processar pedidos do banco de dados
    for (const p of all) {
      try {
        if (!p || !p.ts) continue;
        const pDate = new Date(p.ts);
        if (pDate.toDateString() !== todayKey) continue;
        
        const valorTotal = parseFloat(p.total) || 0;
        const temEntrega = p.entrega === 1;
        
        if (p.estado === 'saiu_para_entrega' || p.estado === 'entregue' || p.estado === 'finalizado') {
          // Para pedidos finalizados/entregues, separar valor de produtos e entrega
          if (temEntrega) {
            // Estimar taxa de entrega (assumindo R$ 7,00 como padrão se não especificado)
            const taxaEntrega = 7.00; // Pode ser ajustado conforme necessário
            const valorProdutos = Math.max(0, valorTotal - taxaEntrega);
            totalProdutos += valorProdutos;
            totalEntregues += taxaEntrega;
            countEntregues++;
          } else {
            // Pedido sem entrega (retirada), todo valor vai para produtos
            totalProdutos += valorTotal;
            countProdutos++;
          }
        } else {
          // Pedidos em outros estados - todo valor conta como produtos
          totalProdutos += valorTotal;
          countProdutos++;
        }
      } catch (e) {
        console.error('[API] Erro ao processar pedido:', e);
      }
    }

    let payload = {
      ok: true,
      totalProdutos: parseFloat(totalProdutos.toFixed(2)),
      totalEntregues: parseFloat(totalEntregues.toFixed(2)),
      countProdutos,
      countEntregues
    };

    // Fallback para dados em memória se o banco retornar zeros
    if (totalProdutos === 0 && totalEntregues === 0 && carrinhoService) {
      console.log('[API] Usando fallback para dados em memória');
      let memTotalProdutos = 0;
      let memTotalEntregues = 0;
      let memCountProdutos = 0;
      let memCountEntregues = 0;

      // Obter carrinhos específicos do restaurante
      const carrinhos = carrinhoService.getCarrinhos ? carrinhoService.getCarrinhos(clienteId) : {};
      for (const [key, carrinho] of Object.entries(carrinhos)) {
        try {
          if (!carrinho || !carrinho.ts) continue;
          const cDate = new Date(carrinho.ts);
          if (cDate.toDateString() !== todayKey) continue;

          const valorTotal = parseFloat(carrinho.valorTotal) || 0;
          const valorEntrega = parseFloat(carrinho.valorEntrega) || 0;
          const temEntrega = carrinho.entrega || valorEntrega > 0;
          
          if (carrinho.estado === 'saiu_para_entrega' || carrinho.estado === 'entregue' || carrinho.estado === 'finalizado') {
            // Para pedidos finalizados/entregues, separar valor de produtos e entrega
            if (temEntrega) {
              const taxaEntrega = valorEntrega > 0 ? valorEntrega : 7.00;
              const valorProdutos = Math.max(0, valorTotal - taxaEntrega);
              memTotalProdutos += valorProdutos;
              memTotalEntregues += taxaEntrega;
              memCountEntregues++;
            } else {
              // Pedido sem entrega (retirada), todo valor vai para produtos
              memTotalProdutos += valorTotal;
              memCountProdutos++;
            }
          } else {
            // Pedidos em outros estados - todo valor conta como produtos
            memTotalProdutos += valorTotal;
            memCountProdutos++;
          }
        } catch (e) {
          console.error('[API] Erro ao processar carrinho em memória:', e);
        }
      }

      payload = {
        ok: true,
        totalProdutos: parseFloat(memTotalProdutos.toFixed(2)),
        totalEntregues: parseFloat(memTotalEntregues.toFixed(2)),
        countProdutos: memCountProdutos,
        countEntregues: memCountEntregues
      };
    }

    console.log('[API] /api/pedidos/totais-dia -> resposta:', payload);
    res.json(payload);
  } catch (err) {
    console.error('[API] Erro em /api/pedidos/totais-dia:', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// API: obter pedido por id (tenta DB, senão fallback em memória)
app.get('/api/pedidos/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ ok: false, error: 'missing_id' });
    let pedido = null;
    try {
      if (clientService && typeof clientService.obterPedidoPorId === 'function') {
        pedido = clientService.obterPedidoPorId(id);
      }
    } catch (e) { pedido = null; }
    // fallback: try in-memory carrinhos looking for matching _pedidoId or id pattern
    if (!pedido && carrinhos) {
      for (const k of Object.keys(carrinhos)) {
        try {
          const c = carrinhos[k];
          if (!c) continue;
          if (c._pedidoId && String(c._pedidoId) === String(id)) { pedido = { id: c._pedidoId, cliente: k.replace(/@s\.whatsapp\.net$/,'').replace(/@c\.us$/,''), ts: c.ts || Date.now(), total: c.valorTotal || 0, endereco: c.endereco || null, estado: c.estado, items: c.carrinho || [] }; break; }
          // also match composed ids like "{numero}_{ts}"
          if (String(id).startsWith(String(k))) {
            pedido = { id: id, cliente: k.replace(/@s\.whatsapp\.net$/,'').replace(/@c\.us$/,''), ts: c.ts || Date.now(), total: c.valorTotal || 0, endereco: c.endereco || null, estado: c.estado, items: c.carrinho || [] };
            break;
          }
        } catch (e) {}
      }
    }
    if (!pedido) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, pedido });
  } catch (err) { console.error('/api/pedidos/:id error', err); res.status(500).json({ ok: false, error: String(err) }); }
});

// API: obter informacoes basicas de um cliente (nome, endereco) por numero
app.get('/api/cliente/:numero', async (req, res) => {
  try {
    const numero = req.params.numero;
    if (!numero) return res.status(400).json({ ok: false, error: 'missing_numero' });
    let info = null;
    try { info = await obterInformacoesClienteAsync(numero); } catch (e) { info = null; }
    res.json({ ok: true, cliente: info });
  } catch (err) {
    console.error('Erro /api/cliente/:numero', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// API alternativa: listar clientes (para resolver erro 404 em /api/cliente/)
app.get('/api/cliente', async (req, res) => {
  try {
    // Retornar informações básicas dos clientes ou um cliente específico via query
    const numero = req.query.numero;
    if (numero) {
      let info = null;
      try { info = await obterInformacoesClienteAsync(numero); } catch (e) { info = null; }
      res.json({ ok: true, cliente: info });
    } else {
      // Retornar lista vazia ou clientes básicos
      res.json({ ok: true, clientes: [] });
    }
  } catch (err) {
    console.error('Erro /api/cliente', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// APIs para Estatísticas e Análises

// API: Estatísticas gerais de vendas
app.get('/api/estatisticas/vendas', async (req, res) => {
  try {
    const periodo = req.query.periodo || 'hoje'; // hoje, semana, mes, todos
    let dataInicio, dataFim;
    const agora = new Date();
    
    switch (periodo) {
      case 'hoje':
        dataInicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
        dataFim = dataInicio + (24 * 60 * 60 * 1000) - 1;
        break;
      case 'semana':
        const inicioSemana = new Date(agora);
        inicioSemana.setDate(agora.getDate() - agora.getDay());
        dataInicio = new Date(inicioSemana.getFullYear(), inicioSemana.getMonth(), inicioSemana.getDate()).getTime();
        dataFim = dataInicio + (7 * 24 * 60 * 60 * 1000) - 1;
        break;
      case 'mes':
        dataInicio = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
        dataFim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59).getTime();
        break;
      default:
        dataInicio = 0;
        dataFim = Date.now();
    }

    const clienteId = 'brutus-burger'; // ID padrão do cliente
    let pedidos = [];
    try {
      if (clientService && typeof clientService.obterPedidosPorEstado === 'function') {
        pedidos = clientService.obterPedidosPorEstado(null, clienteId); // todos os pedidos
      }
    } catch (e) {
      console.error('Erro ao obter pedidos:', e);
    }

    // Filtrar por período
    pedidos = pedidos.filter(p => p.ts >= dataInicio && p.ts <= dataFim);

    // Calcular estatísticas
    const totalVendas = pedidos.length;
    const receitaTotal = pedidos.reduce((sum, p) => sum + (Number(p.total) || 0), 0);
    const ticketMedio = totalVendas > 0 ? receitaTotal / totalVendas : 0;

    // Análise de itens vendidos
    const itensVendidos = {};
    let totalItens = 0;

    pedidos.forEach(pedido => {
      try {
        const items = typeof pedido.items === 'string' ? JSON.parse(pedido.items) : pedido.items;
        if (Array.isArray(items)) {
          items.forEach(item => {
            const nome = item.nome || item.title || 'Item desconhecido';
            const quantidade = Number(item.quantidade) || 1;
            const preco = Number(item.preco) || 0;
            
            if (!itensVendidos[nome]) {
              itensVendidos[nome] = { quantidade: 0, receita: 0 };
            }
            itensVendidos[nome].quantidade += quantidade;
            itensVendidos[nome].receita += preco * quantidade;
            totalItens += quantidade;
          });
        }
      } catch (e) {
        console.error('Erro ao processar items do pedido:', e);
      }
    });

    // Top 10 itens mais vendidos
    const topItens = Object.entries(itensVendidos)
      .map(([nome, dados]) => ({ nome, ...dados }))
      .sort((a, b) => b.quantidade - a.quantidade)
      .slice(0, 10);

    const estatisticas = {
      periodo,
      dataInicio,
      dataFim,
      totalVendas,
      receitaTotal: Math.round(receitaTotal * 100) / 100,
      ticketMedio: Math.round(ticketMedio * 100) / 100,
      totalItens,
      topItens,
      pedidosPorEstado: {}
    };

    // Contar pedidos por estado
    pedidos.forEach(p => {
      const estado = p.estado || 'indefinido';
      estatisticas.pedidosPorEstado[estado] = (estatisticas.pedidosPorEstado[estado] || 0) + 1;
    });

    res.json({ ok: true, estatisticas });
  } catch (err) {
    console.error('Erro /api/estatisticas/vendas', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// API: Análise de entregas
app.get('/api/estatisticas/entregas', async (req, res) => {
  try {
    const periodo = req.query.periodo || 'hoje';
    let dataInicio, dataFim;
    const agora = new Date();
    
    switch (periodo) {
      case 'hoje':
        dataInicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
        dataFim = dataInicio + (24 * 60 * 60 * 1000) - 1;
        break;
      case 'semana':
        const inicioSemana = new Date(agora);
        inicioSemana.setDate(agora.getDate() - agora.getDay());
        dataInicio = new Date(inicioSemana.getFullYear(), inicioSemana.getMonth(), inicioSemana.getDate()).getTime();
        dataFim = dataInicio + (7 * 24 * 60 * 60 * 1000) - 1;
        break;
      case 'mes':
        dataInicio = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
        dataFim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59).getTime();
        break;
      default:
        dataInicio = 0;
        dataFim = Date.now();
    }

    const clienteId = 'brutus-burger'; // ID padrão do cliente
    let pedidos = [];
    try {
      if (clientService && typeof clientService.obterPedidosPorEstado === 'function') {
        pedidos = clientService.obterPedidosPorEstado(null, clienteId);
      }
    } catch (e) {
      console.error('Erro ao obter pedidos:', e);
    }

    // Filtrar por período
    pedidos = pedidos.filter(p => p.ts >= dataInicio && p.ts <= dataFim);

    // Separar entregas e retiradas
    const entregas = pedidos.filter(p => p.entrega === 1 || p.entrega === true);
    const retiradas = pedidos.filter(p => p.entrega === 0 || p.entrega === false);

    // Análise de regiões (baseado no endereço)
    const regioes = {};
    entregas.forEach(pedido => {
      if (pedido.endereco) {
        const endereco = String(pedido.endereco).toLowerCase();
        let regiao = 'Outros';
        
        // Identificar bairros/regiões comuns (pode ser customizado)
        if (endereco.includes('centro')) regiao = 'Centro';
        else if (endereco.includes('jardim')) regiao = 'Jardim';
        else if (endereco.includes('vila')) regiao = 'Vila';
        else if (endereco.includes('bairro')) regiao = 'Bairro';
        
        if (!regioes[regiao]) {
          regioes[regiao] = { quantidade: 0, receita: 0 };
        }
        regioes[regiao].quantidade += 1;
        regioes[regiao].receita += Number(pedido.total) || 0;
      }
    });

    const analiseEntregas = {
      periodo,
      dataInicio,
      dataFim,
      totalPedidos: pedidos.length,
      totalEntregas: entregas.length,
      totalRetiradas: retiradas.length,
      percentualEntregas: pedidos.length > 0 ? Math.round((entregas.length / pedidos.length) * 100) : 0,
      receitaEntregas: Math.round(entregas.reduce((sum, p) => sum + (Number(p.total) || 0), 0) * 100) / 100,
      receitaRetiradas: Math.round(retiradas.reduce((sum, p) => sum + (Number(p.total) || 0), 0) * 100) / 100,
      ticketMedioEntregas: entregas.length > 0 ? Math.round((entregas.reduce((sum, p) => sum + (Number(p.total) || 0), 0) / entregas.length) * 100) / 100 : 0,
      ticketMedioRetiradas: retiradas.length > 0 ? Math.round((retiradas.reduce((sum, p) => sum + (Number(p.total) || 0), 0) / retiradas.length) * 100) / 100 : 0,
      regioes: Object.entries(regioes).map(([nome, dados]) => ({ nome, ...dados })).sort((a, b) => b.quantidade - a.quantidade)
    };

    res.json({ ok: true, analise: analiseEntregas });
  } catch (err) {
    console.error('Erro /api/estatisticas/entregas', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// API: Dashboard consolidado
app.get('/api/estatisticas/dashboard', async (req, res) => {
  try {
    const periodo = req.query.periodo || 'hoje';
    
    // Fazer chamadas para as outras APIs
    const vendasResponse = await fetch(`http://localhost:${PORT}/api/estatisticas/vendas?periodo=${periodo}`);
    const entregasResponse = await fetch(`http://localhost:${PORT}/api/estatisticas/entregas?periodo=${periodo}`);
    
    const vendas = await vendasResponse.json();
    const entregas = await entregasResponse.json();
    
    const dashboard = {
      periodo,
      timestamp: Date.now(),
      vendas: vendas.ok ? vendas.estatisticas : null,
      entregas: entregas.ok ? entregas.analise : null
    };
    
    res.json({ ok: true, dashboard });
  } catch (err) {
    console.error('Erro /api/estatisticas/dashboard', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// API específica para valor do motoboy
app.get('/api/motoboy/valor', async (req, res) => {
  try {
    const periodo = req.query.periodo || 'hoje';
    let dataInicio, dataFim;
    const agora = new Date();
    
    switch (periodo) {
      case 'hoje':
        dataInicio = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
        dataFim = dataInicio + (24 * 60 * 60 * 1000) - 1;
        break;
      case 'semana':
        const inicioSemana = new Date(agora);
        inicioSemana.setDate(agora.getDate() - agora.getDay());
        dataInicio = new Date(inicioSemana.getFullYear(), inicioSemana.getMonth(), inicioSemana.getDate()).getTime();
        dataFim = dataInicio + (7 * 24 * 60 * 60 * 1000) - 1;
        break;
      case 'mes':
        dataInicio = new Date(agora.getFullYear(), agora.getMonth(), 1).getTime();
        dataFim = new Date(agora.getFullYear(), agora.getMonth() + 1, 0, 23, 59, 59).getTime();
        break;
      default:
        dataInicio = 0;
        dataFim = Date.now();
    }

    const clienteId = 'brutus-burger'; // ID padrão do cliente
    let pedidos = [];
    try {
      if (clientService && typeof clientService.obterPedidosPorEstado === 'function') {
        pedidos = clientService.obterPedidosPorEstado(null, clienteId);
      }
    } catch (e) {
      console.error('Erro ao obter pedidos:', e);
    }

    // Filtrar por período e apenas entregas
    const entregas = pedidos.filter(p => 
      (p.entrega === 1 || p.entrega === true) && 
      p.ts >= dataInicio && 
      p.ts <= dataFim
    );

    // Função para extrair valor real de entrega de cada pedido
    function extrairValorEntrega(pedido) {
      try {
        // Usar campo valorEntrega do banco se disponível
        if (pedido.valorEntrega && typeof pedido.valorEntrega === 'number' && pedido.valorEntrega > 0) {
          return pedido.valorEntrega;
        }
        
        // Tentar extrair do raw_json
        if (pedido.raw_json) {
          const raw = typeof pedido.raw_json === 'string' ? JSON.parse(pedido.raw_json) : pedido.raw_json;
          if (raw.valorEntrega && typeof raw.valorEntrega === 'number' && raw.valorEntrega > 0) {
            return raw.valorEntrega;
          }
        }
        
        // Calcular baseado nos itens vs total
        if (pedido.items && pedido.total) {
          const items = typeof pedido.items === 'string' ? JSON.parse(pedido.items) : pedido.items;
          let totalItens = 0;
          if (Array.isArray(items)) {
            for (const item of items) {
              totalItens += (Number(item.preco) || 0) * (Number(item.quantidade) || 1);
            }
          }
          const valorEntrega = Number(pedido.total) - totalItens;
          if (valorEntrega > 0 && valorEntrega <= 100) { // Validação: entre 0 e 100 reais
            return valorEntrega;
          }
        }
        
        // Fallback para valor mínimo
        return 7.00;
      } catch (e) {
        console.error('Erro ao extrair valor de entrega do pedido:', pedido.id, e);
        return 7.00;
      }
    }

    // Calcular valores reais de entrega
    let valorTotalMotoboy = 0;
    const valoresEntrega = [];
    
    entregas.forEach(pedido => {
      const valorEntrega = extrairValorEntrega(pedido);
      valorTotalMotoboy += valorEntrega;
      valoresEntrega.push(valorEntrega);
    });

    const quantidadeEntregas = entregas.length;
    const valorMedio = quantidadeEntregas > 0 ? valorTotalMotoboy / quantidadeEntregas : 0;

    // Análise por horário (para identificar picos)
    const entregasPorHora = {};
    entregas.forEach(pedido => {
      const hora = new Date(pedido.ts).getHours();
      const valorEntrega = extrairValorEntrega(pedido);
      if (!entregasPorHora[hora]) {
        entregasPorHora[hora] = { quantidade: 0, valor: 0 };
      }
      entregasPorHora[hora].quantidade += 1;
      entregasPorHora[hora].valor += valorEntrega;
    });

    // Últimas entregas (para acompanhamento em tempo real)
    const ultimasEntregas = entregas
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 10)
      .map(p => ({
        id: p.id,
        cliente: p.cliente || 'Cliente',
        valor: extrairValorEntrega(p),
        endereco: p.endereco || 'Endereço não informado',
        horario: new Date(p.ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      }));

    const resultado = {
      periodo,
      dataInicio,
      dataFim,
      valorTotalMotoboy: Math.round(valorTotalMotoboy * 100) / 100,
      quantidadeEntregas,
      valorMedioEntrega: Math.round(valorMedio * 100) / 100,
      entregasPorHora: Object.entries(entregasPorHora).map(([hora, dados]) => ({
        hora: parseInt(hora),
        quantidade: dados.quantidade,
        valor: Math.round(dados.valor * 100) / 100
      })).sort((a, b) => a.hora - b.hora),
      ultimasEntregas,
      ultimaAtualizacao: new Date().toLocaleString('pt-BR')
    };

    console.log(`[API] /api/motoboy/valor -> ${quantidadeEntregas} entregas, valor total: R$ ${resultado.valorTotalMotoboy}`);
    res.json({ ok: true, dados: resultado });
  } catch (err) {
    console.error('Erro /api/motoboy/valor', err);
    res.status(500).json({ ok: false, error: 'Erro interno do servidor' });
  }
});

// Sistema de múltiplos clientes WhatsApp (um por restaurante)
const whatsappClients = new Map(); // clientId -> { client, qrCode, isReady, lastActivity }
const clientQRCodes = new Map(); // clientId -> qrCode string

// Função para obter ou criar cliente WhatsApp para um restaurante
function getWhatsAppClient(restaurantId) {
  if (!restaurantId || restaurantId === 'undefined' || restaurantId === 'null') {
    restaurantId = 'brutus-burger'; // padrão
  }
  
  if (!whatsappClients.has(restaurantId)) {
    console.log(`[WhatsApp] Criando novo cliente para restaurante: ${restaurantId}`);
    createWhatsAppClient(restaurantId);
  }
  
  return whatsappClients.get(restaurantId);
}

// Função para criar um novo cliente WhatsApp
function createWhatsAppClient(restaurantId) {
  if (!restaurantId || restaurantId === 'undefined' || restaurantId === 'null') {
    restaurantId = 'brutus-burger';
  }
  
  const chromeExecutablePath = getChromePath();
  
  const clientConfig = {
    puppeteer: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding'
      ],
      headless: true,
      executablePath: chromeExecutablePath || undefined,
      timeout: 90000,
      defaultViewport: null
    },
    webVersionCache: {
      type: 'remote',
      remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2412.54.html',
    },
    // Use a dedicated dataPath per restaurant to guarantee isolation of session files
    authStrategy: new LocalAuth({
      clientId: `bot-${restaurantId}`, // ID único por restaurante
      dataPath: path.join(path.dirname(clientService.caminhoBanco), 'whatsapp-sessions', String(restaurantId))
    }),
    // By default avoid automatic takeover when another session connects. Set to true only if you
    // explicitly want the new login to take control of existing sessions.
    takeoverOnConflict: false,
    takeoverTimeoutMs: 15000,
    qrMaxRetries: 5
  };

  const client = new Client(clientConfig);
  
  const clientData = {
    client: client,
    qrCode: null,
    isReady: false,
    lastActivity: Date.now(),
    restaurantId: restaurantId
  };

  // Eventos do cliente
  client.on('qr', (qr) => {
    console.log(`[WhatsApp-${restaurantId}] QR Code gerado`);
    clientData.qrCode = qr;
    clientQRCodes.set(restaurantId, qr);
  });

  client.on('ready', () => {
    console.log(`[WhatsApp-${restaurantId}] Cliente conectado e pronto!`);
    clientData.isReady = true;
    clientData.qrCode = null;
    clientQRCodes.delete(restaurantId);
  });

  client.on('authenticated', () => {
    try {
      // tentar descobrir o caminho usado pelo LocalAuth (pode não estar exposto, então é best-effort)
      const authStrategy = client.options && client.options.authStrategy;
      const sessionPath = authStrategy && authStrategy.dataPath ? authStrategy.dataPath : 'unknown';
      console.log(`[WhatsApp-${restaurantId}] Autenticado com sucesso (sessionPath=${sessionPath})`);
    } catch (e) {
      console.log(`[WhatsApp-${restaurantId}] Autenticado com sucesso`);
    }
  });

  client.on('auth_failure', msg => {
    console.error(`[WhatsApp-${restaurantId}] Falha na autenticação:`, msg);
    clientData.isReady = false;
  });

  client.on('disconnected', (reason) => {
    console.log(`[WhatsApp-${restaurantId}] Desconectado:`, reason);
    clientData.isReady = false;
    clientData.qrCode = null;
  });

  // Adicionar eventos de mensagem específicos para este restaurante
  client.on('message', async (msg) => {
    if (clientData.isReady && !msg.fromMe) {
      // Filtrar grupos e broadcasts
      if (msg.from.includes('@g.us') || msg.from.includes('@broadcast')) {
        console.log(`🚫 [${restaurantId}] Mensagem ignorada - Grupo/Broadcast: ${msg.from}`);
        return;
      }
      
      clientData.lastActivity = Date.now();
      // Processar mensagem - deixar função determinar restaurante pelo telefone
      // Importante: passar restaurantId do client para garantir que a mensagem
      // seja processada no contexto do cliente/conta que a recebeu.
      await processMessageForRestaurant(msg, restaurantId);
    }
  });

  whatsappClients.set(restaurantId, clientData);
  client.initialize();
  
  return clientData;
}

// API: obter QR Code para restaurante específico
app.get('/api/whatsapp/qrcode/:restaurantId?', async (req, res) => {
  try {
    const restaurantId = req.params.restaurantId || 'brutus-burger';
    const clientData = getWhatsAppClient(restaurantId);
    
    if (!clientData.qrCode) {
      return res.status(404).json({ ok: false, error: 'QR Code não disponível para este restaurante' });
    }
    
    // Converter QR Code string para base64
    const qrCodeBase64 = await qrcode.toDataURL(clientData.qrCode, {
      type: 'image/png',
      quality: 0.92,
      margin: 1,
      color: {
        dark: '#000000',
        light: '#FFFFFF'
      }
    });
    
    // Remover o prefixo data:image/png;base64,
    const base64Data = qrCodeBase64.replace(/^data:image\/png;base64,/, '');
    
    res.json({ ok: true, qrcode: base64Data, restaurantId });
  } catch (err) {
    console.error('Erro /api/whatsapp/qrcode', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// API: obter status de conexão para restaurante específico
app.get('/api/whatsapp/status/:restaurantId?', (req, res) => {
  try {
    const restaurantId = req.params.restaurantId || 'brutus-burger';
    const clientData = getWhatsAppClient(restaurantId);
    
    const status = {
      connected: clientData.isReady,
      needsQR: !clientData.isReady && !clientData.qrCode,
      hasQR: !!clientData.qrCode,
      timestamp: Date.now(),
      restaurantId: restaurantId,
      lastActivity: clientData.lastActivity
    };
    res.json({ ok: true, status });
  } catch (err) {
    console.error('Erro /api/whatsapp/status', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// API: forçar nova geração de QR Code para restaurante específico
app.post('/api/whatsapp/restart/:restaurantId?', (req, res) => {
  try {
    const restaurantId = req.params.restaurantId || 'brutus-burger';
    const clientData = whatsappClients.get(restaurantId);
    
    if (clientData && clientData.client) {
      clientData.qrCode = null;
      clientData.isReady = false;
      clientQRCodes.delete(restaurantId);
      
      clientData.client.destroy().then(() => {
        setTimeout(() => {
          clientData.client.initialize();
        }, 2000);
      }).catch(err => {
        console.error(`Erro ao reinicializar cliente ${restaurantId}:`, err);
      });
    }
    res.json({ ok: true, message: `Cliente ${restaurantId} reiniciando...` });
  } catch (err) {
    console.error('Erro /api/whatsapp/restart', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// APIs compatíveis com versão anterior (sem restaurantId)
app.get('/api/whatsapp/qrcode', async (req, res) => {
  return app._router.handle({ ...req, params: { restaurantId: 'brutus-burger' } }, res);
});

app.get('/api/whatsapp/status', (req, res) => {
  return app._router.handle({ ...req, params: { restaurantId: 'brutus-burger' } }, res);
});

app.post('/api/whatsapp/restart', (req, res) => {
  return app._router.handle({ ...req, params: { restaurantId: 'brutus-burger' } }, res);
});

// API: listar sessões WhatsApp (sessões em disco + estado do cliente em memória)
app.get('/api/whatsapp/sessions', (req, res) => {
  try {
    const baseDir = path.join(path.dirname(clientService.caminhoBanco), 'whatsapp-sessions');
    const sessions = [];

    let diskEntries = [];
    try {
      if (fs.existsSync(baseDir)) {
        diskEntries = fs.readdirSync(baseDir, { withFileTypes: true })
          .filter(d => d.isDirectory())
          .map(d => d.name);
      }
    } catch (e) {
      console.warn('[SESSIONS] Falha ao listar pasta de sessões:', e && e.message ? e.message : e);
    }

    // Combine on-disk folders and in-memory clients
    const allIds = new Set([...diskEntries, ...Array.from(whatsappClients.keys())]);

    for (const id of allIds) {
      const folderPath = path.join(baseDir, String(id));
      const existsOnDisk = fs.existsSync(folderPath);
      let stats = null;
      try { stats = existsOnDisk ? fs.statSync(folderPath) : null; } catch(e) { stats = null; }

      const clientData = whatsappClients.get(id);

      sessions.push({
        restaurantId: id,
        sessionPath: folderPath,
        existsOnDisk: !!existsOnDisk,
        diskMTime: stats ? stats.mtimeMs : null,
        isReady: clientData ? !!clientData.isReady : false,
        hasQR: clientData ? !!clientData.qrCode : false,
        lastActivity: clientData ? clientData.lastActivity : null
      });
    }

    res.json({ ok: true, sessions });
  } catch (err) {
    console.error('Erro /api/whatsapp/sessions', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// API: obter info de uma sessão específica
app.get('/api/whatsapp/sessions/:restaurantId', (req, res) => {
  try {
    const restaurantId = req.params.restaurantId || 'brutus-burger';
    const baseDir = path.join(path.dirname(clientService.caminhoBanco), 'whatsapp-sessions');
    const folderPath = path.join(baseDir, String(restaurantId));
    const existsOnDisk = fs.existsSync(folderPath);
    let stats = null;
    try { stats = existsOnDisk ? fs.statSync(folderPath) : null; } catch(e) { stats = null; }
    const clientData = whatsappClients.get(restaurantId);

    const info = {
      restaurantId,
      sessionPath: folderPath,
      existsOnDisk: !!existsOnDisk,
      diskMTime: stats ? stats.mtimeMs : null,
      isReady: clientData ? !!clientData.isReady : false,
      hasQR: clientData ? !!clientData.qrCode : false,
      lastActivity: clientData ? clientData.lastActivity : null
    };

    res.json({ ok: true, info });
  } catch (err) {
    console.error('Erro /api/whatsapp/sessions/:id', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});


// Rota para servir o PDF/HTML do pedido gerado (visualizar/baixar)
app.get('/pedidos/:id', (req, res) => {
  try {
    const id = req.params.id;
    // Segurança: não permita caminhos com ../
    if (id.includes('..') || id.includes('/')) return res.status(400).send('invalid id');
    const ordersDir = path.join(process.cwd(), 'Pedidos');
    const pdfPath = path.join(ordersDir, `${id}.pdf`);
    const htmlPath = path.join(ordersDir, `${id}.html`);
    if (fs.existsSync(pdfPath)) return res.sendFile(pdfPath);
    if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
    // fallback: tentar obter registro do pedido no DB e gerar HTML on-the-fly com o mesmo formato usado para PDF
    try {
      const clienteService = require('./src/services/clienteService');
      const carrinhoService = require('./src/services/carrinhoService');
      if (clienteService && typeof clienteService.obterPedidoPorId === 'function') {
        const pedido = clienteService.obterPedidoPorId(id);
        if (pedido) {
          if (carrinhoService && typeof carrinhoService.imprimirPedidoFromRecord === 'function') {
            const html = carrinhoService.imprimirPedidoFromRecord(pedido);
            return res.send(html);
          }
          // fallback simple html if helper missing
          let html = `<!doctype html><html><head><meta charset="utf-8"><title>Pedido ${id}</title></head><body>`;
          html += `<h1>Pedido ${id}</h1>`;
          html += `<p><strong>Cliente:</strong> ${pedido.numero || id}</p>`;
          html += `<p><strong>Data:</strong> ${new Date(Number(pedido.ts)||Date.now()).toLocaleString()}</p>`;
          html += `<p><strong>Total:</strong> R$ ${Number(pedido.total||0).toFixed(2)}</p>`;
          if (pedido.items && Array.isArray(pedido.items)) {
            html += '<ul>';
            for (const it of pedido.items) html += `<li>${(it.quantidade||1)}x ${it.nome || it.id} - R$ ${(Number(it.preco)||0).toFixed(2)}</li>`;
            html += '</ul>';
          }
          html += '</body></html>';
          return res.send(html);
        }
      }
    } catch (e) { /* ignore and fallthrough */ }
    return res.status(404).send('Pedido não encontrado');
  } catch (err) {
    console.error('Erro ao servir pedido:', err);
    return res.status(500).send('erro interno');
  }
});

// Rota para o painel de mensagens
app.get('/painel-mensagens', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'painel-mensagens.html'));
});

// Rota para seleção de restaurante
app.get('/pedidos', (req, res) => {
  // Se tem parâmetro restaurant, vai direto para pedidos.html
  if (req.query.restaurant) {
    res.sendFile(path.join(__dirname, 'public', 'pedidos.html'));
  } else {
    // Verifica se há sessão ativa com clienteId
    if (req.session && req.session.clienteId) {
      // Redireciona para painel personalizado
      res.redirect(`/pedidos-${req.session.clienteId}.html?restaurant=${req.session.clienteId}`);
    } else {
      // Redireciona para login se não estiver autenticado
      res.redirect('/login');
    }
  }
});

// Rota direta para painel de pedidos (quando já tem restaurante selecionado)
app.get('/pedidos.html', (req, res) => {
  try {
    // Se veio com query restaurant, servir diretamente
    if (req.query && req.query.restaurant) {
      return res.sendFile(path.join(__dirname, 'public', 'pedidos.html'));
    }

    // Tentar inferir pelo hostname (ex: killsis.com -> killsis-pizza)
    const host = (req.hostname || req.headers.host || '').toString();
    const hostname = host.replace(/:\d+$/, '').replace(/^www\./i, '').split('.')[0];
    if (hostname) {
      for (const [id] of clientesDB) {
        if (String(id).toLowerCase().includes(hostname.toLowerCase())) {
          // Redirecionar para a rota personalizada
          const target = `/pedidos-${id}.html?restaurant=${id}`;
          console.log(`[ROTA] Host '${host}' mapeado para cliente '${id}', redirecionando para ${target}`);
          return res.redirect(target);
        }
      }
    }

    // Fallback: apenas servir a página padrão
    return res.sendFile(path.join(__dirname, 'public', 'pedidos.html'));
  } catch (e) {
    console.error('[ROTA] Erro ao servir /pedidos.html:', e);
    return res.sendFile(path.join(__dirname, 'public', 'pedidos.html'));
  }
});

// Rota personalizada para cada cliente: pedidos-(ID).html
app.get('/pedidos-:clienteId.html', (req, res) => {
  console.log(`[ROTA PERSONALIZADA] Acesso ao painel do cliente: ${req.params.clienteId}`);
  
  // Verificar se o cliente existe
  const cliente = clientesDB.get(req.params.clienteId);
  if (!cliente || !cliente.ativo) {
    console.log(`[ROTA PERSONALIZADA] Cliente ${req.params.clienteId} não encontrado ou inativo`);
    return res.status(404).send('Cliente não encontrado');
  }
  
  // Servir a página de pedidos (será automaticamente configurada com o restaurante correto)
  console.log(`[ROTA PERSONALIZADA] Servindo pedidos.html para cliente: ${req.params.clienteId}`);
  res.sendFile(path.join(__dirname, 'public', 'pedidos.html'));
});

// Rota para página de login
app.get('/login', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Rota para página do QR Code WhatsApp
app.get('/qrcode', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'qrcode.html'));
});

// Rota para página de estatísticas do restaurante
app.get('/estatisticas', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'estatisticas.html'));
});

// Rota para página do dashboard do motoboy
app.get('/motoboy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'motoboy.html'));
});

// Rotas para páginas personalizadas por restaurante
app.get('/restaurant/:id/cardapio', restaurantMiddleware.validateRestaurant(), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cardapio-personalizado.html'));
});

app.get('/restaurant/:id/mensagens', restaurantMiddleware.validateRestaurant(), (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'mensagens-personalizado.html'));
});

// Rota para painel administrativo de restaurantes
app.get('/admin/restaurantes', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin-restaurantes.html'));
});

// API: listar pedidos por estado (genérico). Útil para painel admin (ex: entregues)
app.get('/api/pedidos', restaurantMiddleware.identifyRestaurant(), restaurantMiddleware.validateRestaurant(), async (req, res) => {
  try {
    const estado = req.query.estado || null;
    const clienteId = req.query.clienteId || req.restaurant?.id || 'brutus-burger';
    const pedidos = clientService.obterPedidosPorEstado ? clientService.obterPedidosPorEstado(estado, clienteId) : [];
    res.json({ ok: true, pedidos });
  } catch (err) {
    console.error('Erro /api/pedidos', err);
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// Rota dinâmica para pedidos específicos por cliente: /cliente-id/pedidos.html
app.get('/:clienteId/pedidos.html', (req, res) => {
  const { clienteId } = req.params;
  
  // Verificar se o cliente existe usando o middleware de restaurante
  const restaurant = restaurantMiddleware.getRestaurant(clienteId);
  if (!restaurant) {
    return res.status(404).send(`
      <html>
        <head><title>Cliente não encontrado</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h1>Cliente não encontrado</h1>
          <p>O cliente "${clienteId}" não foi encontrado no sistema.</p>
          <a href="/" style="color: #3498db;">← Voltar ao início</a>
        </body>
      </html>
    `);
  }
  
  // Servir a página de pedidos personalizada
  res.sendFile(path.join(__dirname, 'public', 'cliente-pedidos.html'));
});

// Middleware para servir arquivos estáticos (deve vir após as rotas da API)
app.use(express.static(publicDir));

io.on('connection', async (socket) => {
  // Identificar o restaurante do cliente conectado através do referer
  const clientRestaurant = socket.handshake.headers.referer ? 
    extractRestaurantFromReferer(socket.handshake.headers.referer) : 'brutus-burger';
  
  // Juntar o socket à sala do restaurante específico
  socket.join(clientRestaurant);
  console.log(`[SOCKET] Cliente ${socket.id} conectado à sala: ${clientRestaurant}`);

  // Helper to detect group ids
  const isGroupId = (x) => /@g\.us$/i.test(String(x || ''));
  // Finalizar carrinho (simula cliente digitando 'F')
  // Handler para admin:finalizar (redireciona para admin:finalizarCarrinho)
  socket.on('admin:finalizar', (data) => {
    console.log('[ADMIN] finalizar recebido, redirecionando para finalizarCarrinho:', data);
    // Simplesmente redireciona para o handler correto
    socket.emit('admin:finalizarCarrinho', data);
  });

  socket.on('admin:finalizarCarrinho', (data) => {
    try {
      const { id } = data || {};
      if (!id) return;
      const idNorm = String(id).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
      
      console.log(`[ADMIN] finalizarCarrinho recebido para: ${idNorm}`);
      
      // Obter carrinho usando carrinhoService para garantir consistência
      const carrinho = carrinhoService.getCarrinho(idNorm);
      console.log(`[ADMIN] Carrinho obtido:`, carrinho ? `${carrinho.carrinho.length} itens, estado: ${carrinho.estado}` : 'null');
      
      // If the cart is already in the finalizado state, ignore this admin action
      try {
        const menuFinalizadoStat = (carrinhoService && carrinhoService.stats && carrinhoService.stats.menuFinalizado) || 'finalizado';
        const estadoAtual = carrinho && carrinho.estado;
        console.log(`[ADMIN] Estado atual do carrinho ${idNorm}: ${estadoAtual}`);
        
        if (estadoAtual && String(estadoAtual) === String(menuFinalizadoStat)) {
          console.log(`[ADMIN] Pedido ${idNorm} já está finalizado; ignorando ação de finalizar.`);
          socket.emit('admin:ack', { ok: false, error: 'already_finalized', id: idNorm });
          return;
        }
      } catch (e) { 
        console.error('[ADMIN] Erro ao verificar estado:', e);
      }
      
      // Verificar se o carrinho tem itens
      if (carrinho && (!carrinho.carrinho || carrinho.carrinho.length === 0)) {
        console.log(`[ADMIN] Carrinho ${idNorm} está vazio, não pode finalizar.`);
        socket.emit('admin:ack', { ok: false, error: 'empty_cart', id: idNorm });
        return;
      }
      
      // Em vez de finalizar diretamente, simula o cliente digitando 'finalizar'
      if (carrinho) {
        try {
          // atualiza campos que o fluxo espera
          carrinho.lastMsg = 'finalizar';
          carrinho.respUser = 'finalizar';

          // Obter a instância correta do cliente WhatsApp
          const clientData = getWhatsAppClient('brutus-burger');
          const whatsappClient = clientData ? clientData.client : null;

          // Cria um objeto msg mínimo com reply() que usa o client para enviar mensagens
          const fakeMsg = {
            from: idNorm + '@c.us',
            body: 'finalizar',
            reply: async (text) => {
              try { 
                if (whatsappClient && whatsappClient.sendMessage) {
                  await whatsappClient.sendMessage(idNorm + '@c.us', text); 
                } else {
                  console.log('[ADMIN] WhatsApp client não disponível, simulando envio:', text);
                }
              } catch (e) { console.error('[ADMIN] erro ao enviar reply simulado:', e); }
            }
          };

          // Chama o mesmo fluxo que o cliente acionaria ao digitar 'finalizar'
          try { 
            menuInicial(idNorm, carrinho, fakeMsg, whatsappClient, MessageMedia); 
          } catch (e) { 
            console.error('[ADMIN] erro ao executar menuInicial:', e); 
          }

          // Notifica painel sobre a ação do admin
          try { events.emit('update', { type: 'admin_action', action: 'finalizar_trigger', id: idNorm, carrinho: sanitizeCarrinho(carrinho) }); } catch (e) {}
          
          // Confirma sucesso para o painel
          socket.emit('admin:ack', { ok: true, id: idNorm });
          
        } catch (e) { 
          console.error('[ADMIN] erro ao processar finalizar por admin:', e);
          socket.emit('admin:ack', { ok: false, error: 'process_error', id: idNorm });
        }
      } else {
        console.log(`[ADMIN] Carrinho ${idNorm} não encontrado.`);
        socket.emit('admin:ack', { ok: false, error: 'cart_not_found', id: idNorm });
      }
    } catch (e) { console.log('[ADMIN] erro ao finalizar carrinho', e); }
  });
  console.log('[dashboard] cliente conectado', socket.id);
  // CORREÇÃO CRÍTICA: Usar carrinhos específicos do restaurante - NÃO MAIS CONTAMINAÇÃO!
  const carrinhos = carrinhoService.getCarrinhos(clientRestaurant);
  const filteredCarrinhos = {};
  for (const k of Object.keys(carrinhos)) {
    if (isGroupId(k)) continue;
    // If the cart is already marked as delivered / saiu_para_entrega, don't include it
    // in the initial dashboard snapshot so a page refresh doesn't bring it back to the main panel.
    try {
      const estado = (carrinhos[k] && carrinhos[k].estado) ? String(carrinhos[k].estado).toLowerCase() : '';
      if (estado.includes('saiu') || estado.includes('entreg')) continue;
    } catch (e) {
      // ignore and include the cart by default
    }
    // Shallow copy so we can augment without mutating original
    filteredCarrinhos[k] = Object.assign({}, carrinhos[k]);
  }
  // Attempt to enrich with client name from DB where available
  try {
    const ids = Object.keys(filteredCarrinhos);
    await Promise.all(ids.map(async (cid) => {
      try {
        const info = await obterInformacoesClienteAsync(cid);
        if (info) {
          if (info.nome) filteredCarrinhos[cid].nome = info.nome;
          if (info.endereco) filteredCarrinhos[cid].endereco = info.endereco;
          if (typeof info.lat !== 'undefined') filteredCarrinhos[cid].lat = info.lat;
          if (typeof info.lng !== 'undefined') filteredCarrinhos[cid].lng = info.lng;
        }
      } catch (e) { /* ignore per-id errors */ }
    }));
  } catch (e) { /* ignore enrichment errors */ }
  // Emit sanitized snapshot to avoid sending internal timers/handles
  const sanitizedSnapshot = {};
  for (const k of Object.keys(filteredCarrinhos)) sanitizedSnapshot[k] = sanitizeCarrinho(filteredCarrinhos[k]);
  socket.emit('initial', { carrinhos: sanitizedSnapshot });

  // Comandos do dashboard: alterar estado de um carrinho
  socket.on('admin:setState', (data) => {
    try {
      const { id, state } = data || {};
  if (isGroupId(id)) return socket.emit('admin:ack', { ok: false, error: 'group_ignored' });
      if (id && state && carrinhoService && typeof carrinhoService.atualizarEstadoDoCarrinho === 'function') {
        const clientRestaurant = getRestaurantByPhoneNumber(id + '@c.us');
        carrinhoService.atualizarEstadoDoCarrinho(id, state, clientRestaurant);
        socket.emit('admin:ack', { ok: true, id, state });
      } else {
        socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
      }
    } catch (err) {
      socket.emit('admin:ack', { ok: false, error: String(err) });
    }
  });

  // Comando do dashboard: resetar carrinho
  socket.on('admin:reset', (data) => {
    try {
      const { id } = data || {};
  if (isGroupId(id)) return socket.emit('admin:ack', { ok: false, error: 'group_ignored' });
      if (id && carrinhoService && typeof carrinhoService.resetCarrinho === 'function') {
        const restaurantId = getRestaurantByPhoneNumber(id + '@c.us');
        const carrinhos = carrinhoService.getCarrinhos(restaurantId);
        carrinhoService.resetCarrinho(id, carrinhos[id], restaurantId);
        socket.emit('admin:ack', { ok: true, id });
      } else {
        socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
      }
    } catch (err) {
      socket.emit('admin:ack', { ok: false, error: String(err) });
    }
  });

  // Comando do dashboard: imprimir pedido (gera PDF e envia URL) - só se finalizado
  socket.on('admin:imprimirPedido', async (data) => {
    try {
      const { id } = data || {};
      if (!id) return socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
      const idNorm = String(id).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
      if (isGroupId(idNorm)) return socket.emit('admin:ack', { ok: false, error: 'group_ignored' });
      const restaurantId = getRestaurantByPhoneNumber(id + '@c.us');
      const carrinhos = carrinhoService.getCarrinhos(restaurantId);
      const carrinho = carrinhos[idNorm];
      if (!carrinho) return socket.emit('admin:ack', { ok: false, error: 'not_found' });
      // If a PDF or fallback HTML already exists for this order, return it regardless of state
      const ordersDir = path.join(process.cwd(), 'Pedidos');
      const pdfPath = path.join(ordersDir, `${idNorm}.pdf`);
      const htmlPath = path.join(ordersDir, `${idNorm}.html`);
      try {
        const pdfExists = fs.existsSync(pdfPath);
        const htmlExists = fs.existsSync(htmlPath);
        // If a PDF/HTML exists and forcePrint is NOT set, return it without regenerating/printing
        if ((pdfExists || htmlExists) && !data.forcePrint) {
          console.log(`[ADMIN] PDF/HTML existente para ${idNorm}, retornando URL sem checar estado.`);
          const url = `/pedidos/${encodeURIComponent(idNorm)}`;
          return socket.emit('admin:ack', { ok: true, url });
        }
      } catch (e) { /* ignore fs errors and continue to state check */ }

      const finalState = (carrinhoService && carrinhoService.stats && carrinhoService.stats.menuFinalizado) || 'finalizado';
      const saiuState = (carrinhoService && carrinhoService.stats && carrinhoService.stats.saiuParaEntrega) || 'saiu_para_entrega';
      if (!carrinho.estado || (String(carrinho.estado) !== String(finalState) && String(carrinho.estado) !== String(saiuState))) {
        // allow printing when already marked as saiu_para_entrega as well
        return socket.emit('admin:ack', { ok: false, error: 'not_finalized' });
      }
      // Attempt to save/generate the PDF (salvarPedido returns after trying to create PDF)
      try {
        if (carrinhoService && typeof carrinhoService.salvarPedido === 'function') {
          // salvarPedido will generate the PDF and try to print; pass state so file annotates it
          const clienteId = 'brutus-burger'; // ID padrão do cliente
          await carrinhoService.salvarPedido(idNorm, carrinho.estado || finalState, clienteId);
        }
      } catch (err) {
        console.error('[ADMIN] Erro ao gerar o PDF:', err);
        return socket.emit('admin:ack', { ok: false, error: 'pdf_error' });
      }
      // On success, reply with URL where the file can be downloaded/printed
      const url = `/pedidos/${encodeURIComponent(idNorm)}`;
      socket.emit('admin:ack', { ok: true, url });
    } catch (err) {
      console.error('Erro em admin:imprimirPedido', err);
      socket.emit('admin:ack', { ok: false, error: String(err) });
    }
  });

  // Comando do dashboard: adicionar item manualmente
  socket.on('admin:addItem', async (data) => {
    try {
      console.log('[ADMIN] addItem recebido:', data);
      const { id } = data || {};
  if (!id) return socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
  if (isGroupId(id)) return socket.emit('admin:ack', { ok: false, error: 'group_ignored' });
      // Normaliza id (remove sufixos @c.us / @s.whatsapp.net se presentes)
      const idNorm = String(id).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
      
      // Determinar clienteId - usar 'brutus-burger' como padrão
      const clienteId = 'brutus-burger';

      // If actions array is provided, accept that pattern directly
      if (Array.isArray(data.actions) && data.actions.length > 0) {
        for (const act of data.actions) {
          try {
            const itemId = act.idSelect || act.id || act.itemId;
            const quantidade = act.quantidade || 1;
            const preparo = Array.isArray(act.descricao) ? act.descricao.join(' ').trim() : (act.preparo || '');
            const nome = act.tamanho || act.nome || '';
            if (!itemId) {
              console.log('[ADMIN] ação sem idSelect, pulando:', act);
              continue;
            }
            console.log(`[ADMIN] adicionando (action) item ${itemId} ao carrinho ${idNorm} q=${quantidade} preparo=${preparo}`);
            carrinhoService.adicionarItemAoCarrinho(idNorm, itemId, quantidade, preparo, act.tipo || 'Lanche', (act.nome || nome || String(itemId)), clienteId);
          } catch (e) { console.log('[ADMIN] erro ao processar action', e); }
        }
        return socket.emit('admin:ack', { ok: true, id: idNorm });
      }

      // backward compat: single itemName/itemId payload
      const { itemId, itemName, quantidade, preparo, tipo } = data || {};
      let resolvedId = itemId;
      let nomeParaExibir = itemName || '';
      let preparoFinal = preparo || '';
      if (!resolvedId && itemName) {
        try {
          const analise = require('./src/core/analisePalavras');
          const parsed = analise.parseItemInput(itemName);
          if (parsed) {
            nomeParaExibir = parsed.itemName;
            if (!preparoFinal && parsed.preparo) preparoFinal = parsed.preparo;
            resolvedId = await analise.getItemIdByName(parsed.itemName, clienteId) || null;
          }
        } catch (e) { 
          console.error('[ADMIN] erro ao resolver itemName:', e);
          resolvedId = null; 
        }
      }

      if (!resolvedId) {
        console.log('[ADMIN] item não encontrado para nome:', itemName);
        return socket.emit('admin:ack', { ok: false, error: 'item_not_found' });
      }

  if (carrinhoService && typeof carrinhoService.adicionarItemAoCarrinho === 'function') {
  console.log(`[ADMIN] adicionando item ${resolvedId} ao carrinho ${idNorm}`);
    // parâmetros: (clienteId, itemId, quantidade, AnotarPreparo, tipagem, displayName, restaurantId)
    carrinhoService.adicionarItemAoCarrinho(idNorm, resolvedId, quantidade || 1, (preparoFinal || ''), tipo || 'Lanche', nomeParaExibir || '', clienteId);
  // schedule follow-up in case client stops responding after adding
  try { scheduleFollowupForClient(idNorm); } catch(e) {}
  socket.emit('admin:ack', { ok: true, id: idNorm, itemId: resolvedId });
      } else {
        socket.emit('admin:ack', { ok: false, error: 'service_unavailable' });
      }
    } catch (err) { socket.emit('admin:ack', { ok: false, error: String(err) }); }
  });

  // Cardápio: obter lista de itens
  socket.on('admin:getCardapio', async (data) => {
    try {
      const { clienteId } = data || {};
      const finalClienteId = clienteId || 'brutus-burger';
      await cardapioService.init();
      const items = cardapioService.getItems(finalClienteId);
      socket.emit('admin:cardapio', { ok: true, items, clienteId: finalClienteId });
    } catch (e) { console.error('[ADMIN] getCardapio error', e); socket.emit('admin:cardapio', { ok: false, error: String(e) }); }
  });

  socket.on('admin:addCardapioItem', async (data) => {
    try {
      const { nome, descricao, preco, tipo, id, clienteId } = data || {};
      if (!nome) return socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
      const finalClienteId = clienteId || 'brutus-burger';
      await cardapioService.init();
      const insertedId = cardapioService.addItem(finalClienteId, { nome, descricao, preco, tipo, id });
      socket.emit('admin:ack', { ok: !!insertedId, id: insertedId });
    } catch (e) { console.error('[ADMIN] addCardapioItem error', e); socket.emit('admin:ack', { ok: false, error: String(e) }); }
  });

  socket.on('admin:removeCardapioItem', async (data) => {
    try {
      const { itemId, clienteId } = data || {};
      if (!itemId) return socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
      const finalClienteId = clienteId || 'brutus-burger';
      await cardapioService.init();
      const ok = cardapioService.removeItem(finalClienteId, itemId);
      socket.emit('admin:ack', { ok: !!ok });
    } catch (e) { console.error('[ADMIN] removeCardapioItem error', e); socket.emit('admin:ack', { ok: false, error: String(e) }); }
  });

  // Mappings (gatilhos)
  socket.on('admin:getMappings', async () => {
    try {
      await cardapioService.init();
      const mappings = cardapioService.getMappings('brutus-burger');
      socket.emit('admin:mappings', { ok: true, mappings });
    } catch (e) { console.error('[ADMIN] getMappings Error:', e); socket.emit('admin:mappings', { ok: false, error: String(e) }); }
  });

  socket.on('admin:addMapping', async (data) => {
    try {
      const { nome, itemId } = data || {};
      if (!nome || !itemId) return socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
      await cardapioService.init();
      const ok = cardapioService.addMapping('brutus-burger', nome, itemId);
      socket.emit('admin:ack', { ok: !!ok });
      // broadcast updated mappings to all clients
      const mappings = cardapioService.getMappings('brutus-burger');
      io.emit('admin:mappings', { ok: true, mappings });
    } catch (e) { console.error('[ADMIN] addMapping', e); socket.emit('admin:ack', { ok: false, error: String(e) }); }
  });

  socket.on('admin:removeMapping', async (data) => {
    try {
      const { nome } = data || {};
      if (!nome) return socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
      await cardapioService.init();
      const ok = cardapioService.removeMapping('brutus-burger', nome);
      socket.emit('admin:ack', { ok: !!ok });
      const mappings = cardapioService.getMappings('brutus-burger');
      io.emit('admin:mappings', { ok: true, mappings });
    } catch (e) { console.error('[ADMIN] removeMapping', e); socket.emit('admin:ack', { ok: false, error: String(e) }); }
  });

  // Comando: informar que o pedido saiu para entrega
  socket.on('admin:saiuEntrega', async (data) => {
    try {
      const { id, message } = data || {};
      if (!id) return socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
      if (isGroupId(id)) return socket.emit('admin:ack', { ok: false, error: 'group_ignored' });
      const idNorm = String(id).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
      const restaurantId = getRestaurantByPhoneNumber(id + '@c.us');
      const carrinhos = carrinhoService.getCarrinhos(restaurantId);
      const carrinho = carrinhos[idNorm];
      if (!carrinho) return socket.emit('admin:ack', { ok: false, error: 'not_found' });
      // Só permite notificar que 'saiu para entrega' se o pedido estiver finalizado
      try {
        const finalState = (carrinhoService && carrinhoService.stats && carrinhoService.stats.menuFinalizado) || 'finalizado';
        if (!carrinho.estado || String(carrinho.estado) !== String(finalState)) {
          return socket.emit('admin:ack', { ok: false, error: 'not_finalized' });
        }
      } catch (e) { /* se falhar na checagem, não bloqueia por segurança */ }

      // update state para 'saiu_para_entrega'
      try { 
        const pedidoRestaurant = getRestaurantByPhoneNumber(idNorm + '@c.us');
        atualizarEstadoDoCarrinho(idNorm, (carrinhoService && carrinhoService.stats && carrinhoService.stats.saiuParaEntrega) || 'saiu_para_entrega', pedidoRestaurant); 
      } catch (e) {}
      
      // Aguardar o banco estar pronto antes de persistir
      if (clientService && clientService.dbReady && typeof clientService.dbReady.then === 'function') {
        try {
          await clientService.dbReady;
          console.log('[ADMIN] Banco de dados pronto para salvar pedido');
        } catch (e) {
          console.error('[ADMIN] Erro ao aguardar banco estar pronto:', e);
        }
      }
      
      // Persistir pedido no banco com estado 'saiu_para_entrega' para histórico / lista de entregues
      let ackPedido = null;
      try {
        if (clientService && typeof clientService.adicionarPedido === 'function') {
          // If we've already saved a pedido for this cart, update its state instead of creating duplicate
          if (carrinho._pedidoSalvo && carrinho._pedidoId) {
            // Update the existing pedido state to 'saiu_para_entrega'
            try {
              if (clientService && typeof clientService.atualizarEstadoPedido === 'function') {
                const pedidoRestaurant = getRestaurantByPhoneNumber(idNorm + '@c.us');
                clientService.atualizarEstadoPedido(carrinho._pedidoId, 'saiu_para_entrega', pedidoRestaurant);
                console.log('[ADMIN] Estado do pedido atualizado para saiu_para_entrega:', carrinho._pedidoId, 'for restaurant:', pedidoRestaurant);
              }
            } catch (e) { console.error('[ADMIN] Erro ao atualizar estado do pedido:', e); }
            
            // Obter o restaurante correto baseado no número de telefone
            const pedidoRestaurant = getRestaurantByPhoneNumber(idNorm + '@c.us');
            let saved = null;
            try { saved = clientService.obterPedidoPorId(carrinho._pedidoId, pedidoRestaurant); } catch (e) { saved = null; }
            if (!saved) saved = { id: carrinho._pedidoId, ts: Date.now(), total: carrinho.valorTotal || 0, endereco: carrinho.endereco || null, estado: 'saiu_para_entrega', items: carrinho.carrinho || [] };
            // Emitir apenas para a sala do restaurante correto
            try { io.to(pedidoRestaurant).emit('pedido:salvo', { ok:true, pedido: saved, cliente: idNorm }); } catch(e) { console.error('[ADMIN] erro emitindo pedido:salvo (reused)', e); }
            ackPedido = saved;
          } else {
            // montar objeto de pedido simplificado
            const items = Array.isArray(carrinho.carrinho) ? carrinho.carrinho.map(it => ({ id: it.id, nome: it.nome, quantidade: it.quantidade, preco: it.preco, preparo: it.preparo })) : [];
            let totalCalc = 0;
            for (const it of items) totalCalc += (Number(it.preco)||0) * (Number(it.quantidade)||1);
            // considerar valorEntrega se presente
            const entregaVal = (typeof carrinho.valorEntrega !== 'undefined' && carrinho.valorEntrega) ? Number(carrinho.valorEntrega) : (carrinho.entrega && Number(carrinho.entrega) ? Number(carrinho.entrega) : 0);
            totalCalc = totalCalc + (Number(entregaVal) || 0);
            const pedidoRecord = {
              id: `${idNorm}_${Date.now()}`,
              ts: Date.now(),
              total: totalCalc,
              entrega: entregaVal ? 1 : 0,
              endereco: carrinho.endereco || null,
              estado: (carrinhoService && carrinhoService.stats && carrinhoService.stats.saiuParaEntrega) || 'saiu_para_entrega',
              items,
              valorEntrega: entregaVal || 0
            };
            // Obter o restaurante correto baseado no número de telefone
            const pedidoRestaurant = getRestaurantByPhoneNumber(idNorm + '@c.us');
            const savedId = clientService.adicionarPedido(idNorm, pedidoRecord, pedidoRestaurant);
            console.log('[ADMIN] adicionarPedido returned id =', savedId, 'for restaurant:', pedidoRestaurant);
            // mark as saved on the in-memory cart
            try { carrinho._pedidoSalvo = true; carrinho._pedidoId = savedId || pedidoRecord.id; } catch (e) {}
            try {
              let saved = null;
              try { if (clientService && typeof clientService.obterPedidoPorId === 'function') saved = clientService.obterPedidoPorId(savedId || pedidoRecord.id, pedidoRestaurant); } catch(e) { saved = null; }
              if (!saved) saved = Object.assign({}, pedidoRecord, { id: savedId || pedidoRecord.id });
              // Emitir apenas para a sala do restaurante correto
              try { io.to(pedidoRestaurant).emit('pedido:salvo', { ok:true, pedido: saved, cliente: idNorm }); } catch(e) { console.error('[ADMIN] erro emitindo pedido:salvo', e); }
              ackPedido = saved;
            } catch (e) { console.error('[ADMIN] Erro ao persistir/emitir pedido como saiu_para_entrega:', e); }
          }
        }
      } catch (e) { console.error('[ADMIN] Erro ao persistir pedido como saiu_para_entrega:', e); }
      // send message to client via WhatsApp client
      try {
        const texto = message || 'Seu pedido saiu para entrega! Em breve chegará.';
        
        // Determinar qual cliente usar (padrão: brutus-burger)
        const targetRestaurant = 'brutus-burger'; // ou extrair do contexto se necessário
        const clientData = whatsappClients.get(targetRestaurant);
        
        if (clientData && clientData.client && clientData.isReady) {
          await clientData.client.sendMessage(`${idNorm}@s.whatsapp.net`, texto);
          console.log(`[ADMIN] Mensagem "saiu para entrega" enviada com sucesso para ${idNorm} via ${targetRestaurant}`);
        } else {
          console.error(`[ADMIN] Cliente WhatsApp não disponível para ${targetRestaurant}`);
        }
      } catch (e) { console.error('[ADMIN] erro ao enviar mensagem saiuEntrega:', e); }
      // include saved pedido in the ack when available to avoid races on the client-side
      socket.emit('admin:ack', { ok: true, id: idNorm, pedido: ackPedido });
    } catch (err) { socket.emit('admin:ack', { ok: false, error: String(err) }); }
  });

  // Comando do dashboard: enviar mensagem para cliente como admin
  socket.on('admin:sendMessage', async (data) => {
    try {
      const { id, text, restaurantId } = data || {};
      if (!id || !text) return socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
  if (isGroupId(id)) return socket.emit('admin:ack', { ok: false, error: 'group_ignored' });
      const idNorm = String(id).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
      
      // Determinar qual cliente usar (padrão: brutus-burger)
      const targetRestaurant = restaurantId || 'brutus-burger';
      const clientData = whatsappClients.get(targetRestaurant);
      
      // envia via WhatsApp client
      try {
        if (clientData && clientData.client && clientData.isReady) {
          await clientData.client.sendMessage(`${idNorm}@s.whatsapp.net`, text);
          console.log(`[ADMIN] Mensagem enviada com sucesso para ${idNorm} via ${targetRestaurant}`);
        } else {
          console.log(`[ADMIN] Cliente WhatsApp não disponível para ${targetRestaurant} (ready: ${clientData?.isReady})`);
        }
      } catch (e) { console.error('[ADMIN] erro ao enviar mensagem via client:', e); }

         // Note: do not add message to carrinhos here -- the whatsapp client will emit message_create
         // which is already handled elsewhere and will emit the update once.

      socket.emit('admin:ack', { ok: true, id: idNorm });
    } catch (err) { socket.emit('admin:ack', { ok: false, error: String(err) }); }
  });

  // Comando do dashboard: remover item por nome/id/index
  socket.on('admin:removeItem', (data) => {
    try {
      const { id, index, nome, itemId } = data || {};
      console.log('[ADMIN] removeItem recebido:', data);
      if (!id) return socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
  if (isGroupId(id)) return socket.emit('admin:ack', { ok: false, error: 'group_ignored' });
  const idNorm = String(id).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
      
      // Debug: listar carrinhos existentes (agora específicos do restaurante)
      const restaurantId = getRestaurantByPhoneNumber(id + '@c.us');
      const carrinhos = carrinhoService.getCarrinhos(restaurantId);
      console.log('[ADMIN DEBUG] Carrinhos existentes para', restaurantId, ':', Object.keys(carrinhos));
      console.log('[ADMIN DEBUG] ID original:', id, 'ID normalizado:', idNorm);
      console.log('[ADMIN DEBUG] Carrinho existe para ID normalizado?', !!carrinhos[idNorm]);
      console.log('[ADMIN DEBUG] Carrinho existe para ID original?', !!carrinhos[id]);
      
      if (carrinhoService && typeof carrinhoService.removerItemDoCarrinho === 'function') {
        const ok = carrinhoService.removerItemDoCarrinho(idNorm, { index, nome, id: itemId });
        socket.emit('admin:ack', { ok: !!ok, id: idNorm });
      } else {
        socket.emit('admin:ack', { ok: false, error: 'service_unavailable' });
      }
    } catch (err) { socket.emit('admin:ack', { ok: false, error: String(err) }); }
  });

  // Comando do dashboard: atualizar/definir nome do cliente
  socket.on('admin:updateName', (data) => {
    try {
      const { id, nome } = data || {};
      if (!id || typeof nome === 'undefined') return socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
      if (isGroupId(id)) return socket.emit('admin:ack', { ok: false, error: 'group_ignored' });
      const idNorm = String(id).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
      // Atualiza DB (se disponível)
      try {
        if (clientService && typeof clientService.atualizarNomeCliente === 'function') {
          const clientRestaurant = getRestaurantByPhoneNumber(idNorm + '@c.us');
          clientService.atualizarNomeCliente(idNorm, String(nome).trim(), clientRestaurant);
          console.log(`[ADMIN] Nome do cliente atualizado: ${idNorm} -> ${String(nome).trim()} for restaurant: ${clientRestaurant}`);
        }
      } catch (e) { console.error('[ADMIN] Erro ao atualizar nome no DB:', e); }
      // Atualiza carrinho em memória (agora específico do restaurante) e notifica painel
      try {
        const restaurantId = getRestaurantByPhoneNumber(idNorm + '@c.us');
        const carrinhos = carrinhoService.getCarrinhos(restaurantId);
        if (!carrinhos[idNorm]) carrinhos[idNorm] = { carrinho: [], estado: 'menu-inicial' };
        carrinhos[idNorm].nome = String(nome).trim();
  try { events.emit('update', { type: 'admin_action', action: 'update_name', id: idNorm, carrinho: sanitizeCarrinho(carrinhos[idNorm]), restaurantId }); } catch (e) {}
      } catch (e) { console.error('[ADMIN] erro ao setar nome em memória:', e); }

      socket.emit('admin:ack', { ok: true, id: idNorm });
    } catch (err) { socket.emit('admin:ack', { ok: false, error: String(err) }); }
  });

  // Comando do dashboard: atualizar/definir endereço do cliente
  socket.on('admin:updateEndereco', (data) => {
    try {
      const { id, endereco } = data || {};
      if (!id || typeof endereco === 'undefined') return socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
      if (isGroupId(id)) return socket.emit('admin:ack', { ok: false, error: 'group_ignored' });
      const idNorm = String(id).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
      // Persistir no DB
      try { 
        if (clientService && typeof clientService.atualizarEnderecoCliente === 'function') {
          const clientRestaurant = getRestaurantByPhoneNumber(idNorm + '@c.us');
          clientService.atualizarEnderecoCliente(idNorm, String(endereco).trim(), clientRestaurant);
          console.log(`[ADMIN] Endereço do cliente atualizado: ${idNorm} -> ${String(endereco).trim()} for restaurant: ${clientRestaurant}`);
        }
      } catch (e) { console.error('[ADMIN] Erro ao atualizar endereco no DB:', e); }
      // Atualizar carrinho em memória (agora específico do restaurante) e notificar painel
      try {
        const restaurantId = getRestaurantByPhoneNumber(idNorm + '@c.us');
        const carrinhos = carrinhoService.getCarrinhos(restaurantId);
        if (!carrinhos[idNorm]) carrinhos[idNorm] = { carrinho: [], estado: 'menu-inicial' };
        carrinhos[idNorm].endereco = String(endereco).trim();
  try { events.emit('update', { type: 'admin_action', action: 'update_endereco', id: idNorm, carrinho: sanitizeCarrinho(carrinhos[idNorm]), restaurantId }); } catch (e) {}
      } catch (e) { console.error('[ADMIN] erro ao setar endereco em memória:', e); }

      socket.emit('admin:ack', { ok: true, id: idNorm });
    } catch (err) { socket.emit('admin:ack', { ok: false, error: String(err) }); }
  });

  // Comando do dashboard: atualizar quantidade de item (index, delta)
  socket.on('admin:updateQuantity', (data) => {
    try {
      const { id, index, delta } = data || {};
      if (!id || typeof index === 'undefined' || typeof delta === 'undefined') return socket.emit('admin:ack', { ok: false, error: 'invalid_payload' });
  if (isGroupId(id)) return socket.emit('admin:ack', { ok: false, error: 'group_ignored' });
  const idNorm = String(id).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
      
      if (carrinhoService && typeof carrinhoService.atualizarQuantidadeDoItem === 'function') {
        const ok = carrinhoService.atualizarQuantidadeDoItem(idNorm, Number(index), Number(delta));
        return socket.emit('admin:ack', { ok: !!ok, id: idNorm });
      }
      socket.emit('admin:ack', { ok: false, error: 'service_unavailable' });
    } catch (err) { socket.emit('admin:ack', { ok: false, error: String(err) }); }
  });
});

// Escuta eventos do carrinhoService e retransmite por socket.io
if (events && typeof events.on === 'function') {
  events.on('update', (payload) => {
    try {
      // Se payload.id é um group id (@g.us), ignore para não renderizar no dashboard
      const id = payload && payload.id ? String(payload.id) : '';
      if (/@g\.us$/i.test(id)) return;
      // If the cart just changed state to finalizado or saiu_para_entrega, clear any scheduled followups
      try {
        const finalState = (carrinhoService && carrinhoService.stats && carrinhoService.stats.menuFinalizado) || 'finalizado';
        const saiuState = (carrinhoService && carrinhoService.stats && carrinhoService.stats.saiuParaEntrega) || 'saiu_para_entrega';
        if (payload && payload.type === 'state_change' && (String(payload.estado) === String(finalState) || String(payload.estado) === String(saiuState))) {
          try { clearFollowupForClient(id); } catch(e) {}
          // Persist pedido automaticamente when state reaches finalizado (but not when changing from finalizado to saiu_para_entrega)
          try {
            const idNorm = id;
            const restaurantId = payload.restaurantId || getRestaurantByPhoneNumber(idNorm + '@c.us');
            const carrinhos = carrinhoService.getCarrinhos(restaurantId);
            const c = carrinhos[idNorm];
            // Only save automatically when reaching 'finalizado' state, not when changing to 'saiu_para_entrega'
            if (c && !c._pedidoSalvo && String(payload.estado) === String(finalState)) {
              // build pedido record
              const items = Array.isArray(c.carrinho) ? c.carrinho.map(it => ({ id: it.id, nome: it.nome, quantidade: it.quantidade, preco: it.preco, preparo: it.preparo })) : [];
              let totalCalc = 0;
              for (const it of items) totalCalc += (Number(it.preco)||0) * (Number(it.quantidade)||1);
              const entregaVal = (typeof c.valorEntrega !== 'undefined' && c.valorEntrega) ? Number(c.valorEntrega) : (c.entrega && Number(c.entrega) ? Number(c.entrega) : 0);
              totalCalc = totalCalc + (Number(entregaVal) || 0);
              const pedidoRecord = {
                id: `${idNorm}_${Date.now()}`,
                ts: Date.now(),
                total: totalCalc,
                entrega: entregaVal ? 1 : 0,
                endereco: c.endereco || null,
                estado: String(payload.estado) || (carrinhoService && carrinhoService.stats && carrinhoService.stats.saiuParaEntrega) || 'saiu_para_entrega',
                items,
                valorEntrega: entregaVal || 0
              };
              try {
                // Obter o restaurante correto baseado no número de telefone
                const pedidoRestaurant = getRestaurantByPhoneNumber(idNorm + '@c.us');
                const savedId = clientService && typeof clientService.adicionarPedido === 'function' ? clientService.adicionarPedido(idNorm, pedidoRecord, pedidoRestaurant) : null;
                console.log('[AUTO-PERSIST] adicionarPedido returned id =', savedId, 'for restaurant:', pedidoRestaurant);
                // mark as saved to prevent duplicate saves and store the saved id on the cart
                try { c._pedidoSalvo = true; c._pedidoId = savedId || pedidoRecord.id; } catch (e) {}
                // emit for frontend (fetch fresh record when possible)
                let saved = null;
                try { if (clientService && typeof clientService.obterPedidoPorId === 'function') saved = clientService.obterPedidoPorId(c._pedidoId, pedidoRestaurant); } catch(e) { saved = null; }
                if (!saved) saved = Object.assign({}, pedidoRecord, { id: c._pedidoId });
                // Emitir apenas para a sala do restaurante correto
                try { io.to(pedidoRestaurant).emit('pedido:salvo', { ok:true, pedido: saved, cliente: idNorm }); } catch(e) {}
              } catch (e) { console.error('[AUTO-PERSIST] erro ao salvar pedido:', e); }
            }
          } catch (e) { console.error('[AUTO-PERSIST] erro geral:', e); }
        }
      } catch(e) {}
      // sanitize payload.carrinho before emitting to avoid circular structures and binary detection issues
      const out = Object.assign({}, payload);
      if (payload && payload.carrinho) out.carrinho = sanitizeCarrinho(payload.carrinho);
      // Also sanitize any embedded carrinho under payload.carrinho
      try { 
        // Emitir apenas para a sala do restaurante correto baseado no ID do cliente
        const carrinhoRestaurant = getRestaurantByPhoneNumber(id + '@c.us');
        io.to(carrinhoRestaurant).emit('carrinho:update', out); 
      } catch (e) { console.error('[ERROR] Erro ao emitir carrinho:update:', e); }
      // Se o payload contém carrinho com itens, agendar follow-up para esse cliente
      try {
        if (out.carrinho && Array.isArray(out.carrinho) && out.carrinho.length > 0) {
          try { scheduleFollowupForClient(id); } catch (e) {}
        }
      } catch (e) { /* ignore */ }
    } catch (e) { }
  });

  // Escuta eventos de mudança de status do bot
  events.on('bot-status-changed', (payload) => {
    try {
      const { restaurantId, status } = payload;
      console.log(`[SOCKET] Enviando mudança de status do bot para sala ${restaurantId}: ${status ? 'ATIVO' : 'INATIVO'}`);
      
      // Emitir apenas para a sala do restaurante específico
      io.to(restaurantId).emit('bot-status-update', {
        restaurantId,
        status,
        timestamp: payload.timestamp
      });
    } catch (e) {
      console.error('[SOCKET] Erro ao emitir mudança de status do bot:', e);
    }
  });
}

// Inicia o servidor em porta 80 se não houver variáveis de ambiente, mas só após o DB estar pronto
const DASHBOARD_PORT = process.env.DASHBOARD_PORT || 80;
// PORT é usado em alguns trechos (ex: fetch interno); mantenha compatibilidade com variável padrão
const PORT = process.env.PORT || DASHBOARD_PORT;
try {
  if (clientService && clientService.dbReady && typeof clientService.dbReady.then === 'function') {
    clientService.dbReady.then(async () => {
      // optionally migrate cardapio maps into DB on startup when flag set
      try {
        const should = String(process.env.MIGRATE_CARDAPIO_ON_START||'').toLowerCase();
        if (should === '1' || should === 'true') {
          try {
            const migrate = require('./src/scripts/migrateCardapio');
            await migrate();
            console.log('[startup] migrateCardapio executed');
          } catch (e) { console.error('[startup] migrateCardapio failed', e); }
        }
      } catch(e) {}
      server.listen(DASHBOARD_PORT, () => console.log(`[dashboard] servindo ${publicDir} em http://localhost:${DASHBOARD_PORT} (DB ready)`));
    }).catch((e) => {
      console.error('dbReady rejected, iniciando servidor de qualquer forma:', e);
      server.listen(DASHBOARD_PORT, () => console.log(`[dashboard] servindo ${publicDir} em http://localhost:${DASHBOARD_PORT} (DB ready failed)`));
    });
  } else {
    server.listen(DASHBOARD_PORT, () => console.log(`[dashboard] servindo ${publicDir} em http://localhost:${DASHBOARD_PORT}`));
  }
} catch (e) {
  console.error('Erro ao aguardar dbReady:', e);
  server.listen(DASHBOARD_PORT, () => console.log(`[dashboard] servindo ${publicDir} em http://localhost:${DASHBOARD_PORT} (fallback)`));
}


// Função para checar se Chrome está instalado no caminho padrão do Windows
function getChromePath() {
  const chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  if (fs.existsSync(chromePath)) {
    console.log('✅ Chrome encontrado no caminho padrão.');
    return chromePath;
  } else {
    console.warn('⚠️ Chrome não encontrado no caminho padrão.');
    return null;
  }
}

const chromeExecutablePath = getChromePath();

// Função para processar mensagens por restaurante
async function processMessageForRestaurant(msg, restaurantId = null) {
  try {
    const idAtual = msg.from;
    const mensagem = msg.body;
    
    // Filtro de segurança: Ignorar grupos e broadcasts
    if (idAtual.includes('@g.us') || idAtual.includes('@broadcast')) {
      console.log(`🚫 Processamento cancelado - Grupo/Broadcast: ${idAtual}`);
      return;
    }
    
    // DETERMINAR RESTAURANTE PELO NÚMERO DO TELEFONE
    if (!restaurantId) {
      restaurantId = getRestaurantByPhoneNumber(idAtual);
    }
    
    // 🤖 VERIFICAR SE O BOT ESTÁ ATIVO PARA ESTE RESTAURANTE
    const botAtivo = carrinhoService.getBotStatus(restaurantId);
    if (!botAtivo) {
      console.log(`🚫 [${restaurantId}] Bot DESATIVADO - mensagem ignorada de ${idAtual}`);
      console.log(`💬 [${restaurantId}] Conteúdo ignorado: "${mensagem}"`);
      return;
    }
    
    // Usar restaurantId diretamente como clienteId
    const clienteId = restaurantId;
    
    console.log(`\n🚀 ===== INÍCIO DO FLUXO =====`);
    console.log(`📨 [${restaurantId}] Mensagem recebida de ${idAtual} (BOT ATIVO ✅)`);
    console.log(`💬 [${restaurantId}] Conteúdo: "${mensagem}"`);
    console.log(`🏪 [${restaurantId}] ClienteId: ${clienteId}`);
    console.log(`⏰ [${restaurantId}] Timestamp: ${new Date().toISOString()}`);
    
    // Verificar gatilhos personalizados primeiro
    console.log(`🔍 [${restaurantId}] Verificando gatilhos personalizados...`);
    const gatilhoExecutado = await verificarGatilhosPersonalizados(mensagem, msg, idAtual);
    if (gatilhoExecutado) {
      console.log(`🎯 [${restaurantId}] ✅ Gatilho personalizado executado para ${idAtual}`);
      console.log(`🏁 ===== FIM DO FLUXO (GATILHO) =====\n`);
      return;
    }
    console.log(`🔍 [${restaurantId}] ❌ Nenhum gatilho personalizado encontrado`);
    
    console.log(`📋 [${restaurantId}] Prosseguindo para processamento normal...`);

    // Processar mensagem normal
    const informacoesCliente = await obterInformacoesClienteAsync(idAtual, clienteId);
    if (!informacoesCliente) {
      console.log(`❌ [${restaurantId}] Cliente não encontrado: ${idAtual} - Criando novo cliente...`);
      
      // Criar novo cliente se não existir
      try {
        const clientService = require('./src/services/clienteService');
        clientService.adicionarCliente(idAtual, 'Cliente Novo', null, null, null, clienteId);
        console.log(`✅ [${restaurantId}] Novo cliente criado: ${idAtual}`);
        
        // Tentar obter novamente
        const novasInformacoes = await obterInformacoesClienteAsync(idAtual, clienteId);
        if (novasInformacoes) {
          const carrinhoAtual = carrinhoService.getCarrinho(idAtual);
          carrinhoAtual.lastMsg = mensagem; // Atualizar lastMsg
          const clientData = getWhatsAppClient(restaurantId);
          await analisePorStatus(carrinhoAtual, msg, idAtual, clientData.client, MessageMedia, clienteId);
        }
      } catch (createError) {
        console.error(`❌ [${restaurantId}] Erro ao criar cliente:`, createError);
      }
      return;
    }

    // Análise por status do cliente
    console.log(`🛒 [${restaurantId}] Obtendo carrinho do cliente...`);
    const carrinhoAtual = carrinhoService.getCarrinho(idAtual);
    carrinhoAtual.lastMsg = mensagem; // Atualizar lastMsg
    
    console.log(`🛒 [${restaurantId}] Estado atual do carrinho: ${carrinhoAtual.estado}`);
    console.log(`🛒 [${restaurantId}] Itens no carrinho: ${carrinhoAtual.carrinho.length}`);
    console.log(`🛒 [${restaurantId}] Última mensagem: "${carrinhoAtual.lastMsg}"`);
    
    console.log(`📞 [${restaurantId}] Chamando analisePorStatus...`);
    const clientData = getWhatsAppClient(restaurantId);
    await analisePorStatus(carrinhoAtual, msg, idAtual, clientData.client, MessageMedia, clienteId);
    
    console.log(`🏁 ===== FIM DO FLUXO (NORMAL) =====\n`);
    
  } catch (error) {
    console.error(`❌ [${restaurantId}] Erro ao processar mensagem:`, error);
    console.log(`🏁 ===== FIM DO FLUXO (ERRO) =====\n`);
  }
}

// Inicializar cliente padrão
const defaultClient = createWhatsAppClient('brutus-burger');

// Adicionar tratamento global de erros
process.on('unhandledRejection', (reason, promise) => {
  console.log('❌ Rejeição não tratada em:', promise, 'motivo:', reason);
});

process.on('uncaughtException', (error) => {
  console.log('❌ Exceção não capturada:', error);
});


// Cliente antigo removido - agora usando sistema multi-tenant

// Import do stats corrigido
const stats = {
  menuInicial: 'menu_inicial',
  menuFinalizado: 'menu_finalizado',
  menuAdicionais: 'menu_adicionais',
  menuNome: 'menu_nome',
  menuObservacao: 'menu_observacao',
  menuPagamento: 'menu_pagamento',
  menuTroco: 'menu_troco',
  menuEndereco: 'menu_endereco',
  menuSuporte: 'menu_suporte'
};

// ---- Follow-up helper: se cliente parou de responder por X minutos após adicionar itens
function clearFollowupForClient(id) {
  try {
    const idNorm = String(id).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
    const restaurantId = getRestaurantByPhoneNumber(idNorm + '@c.us');
    const carrinhos = carrinhoService.getCarrinhos(restaurantId);
    const c = carrinhos[idNorm];
    if (c && c._followupTimeout) {
      clearTimeout(c._followupTimeout);
      c._followupTimeout = null;
    }
    if (c) c._followupSent = false;
  } catch (e) { /* ignore */ }
}

function scheduleFollowupForClient(id, delayMs = 10 * 60 * 1000) {
  try {
    const idNorm = String(id).replace(/@c\.us$|@s\.whatsapp\.net$/i, '');
    const restaurantId = getRestaurantByPhoneNumber(idNorm + '@c.us');
    const carrinhos = carrinhoService.getCarrinhos(restaurantId);
    const c = carrinhos[idNorm];
    if (!c) return;
    if (c._followupTimeout) { clearTimeout(c._followupTimeout); c._followupTimeout = null; }
    const hasItems = Array.isArray(c.carrinho) && c.carrinho.length > 0;
    const finalState = (carrinhoService && carrinhoService.stats && carrinhoService.stats.menuFinalizado) || 'finalizado';
    if (!hasItems) return;
    if (c._followupSent) return;

    c._followupTimeout = setTimeout(async () => {
      try {
        const restaurantId = getRestaurantByPhoneNumber(idNorm + '@c.us');
        const carrinhos = carrinhoService.getCarrinhos(restaurantId);
        const current = carrinhos[idNorm];
        if (!current) return;
        const stillHasItems = Array.isArray(current.carrinho) && current.carrinho.length > 0;
        if (!stillHasItems) return;
        if (current.estado && String(current.estado) === String(finalState)) return;
        if (current._followupSent) return;

        const texto = (mensagens && mensagens.mensagem && mensagens.mensagem.msgFollowup) || 'Olá! Notei que você começou um pedido e não respondeu. Precisa de ajuda para finalizar ou quer continuar pedindo?';
        try {
          // Determinar qual cliente usar (padrão: brutus-burger)
          const targetRestaurant = 'brutus-burger';
          const clientData = whatsappClients.get(targetRestaurant);
          
          if (clientData && clientData.client && clientData.isReady) {
            await clientData.client.sendMessage(idNorm + '@s.whatsapp.net', texto);
            current._followupSent = true;
            try { events.emit('update', { type: 'followup_sent', id: idNorm, carrinho: sanitizeCarrinho(current) }); } catch (e) {}
            console.log(`[FOLLOWUP] Mensagem de follow-up enviada para ${idNorm} via ${targetRestaurant}`);
          } else {
            console.error(`[FOLLOWUP] Cliente WhatsApp não disponível para ${targetRestaurant}`);
          }
        } catch (e) { console.error('[FOLLOWUP] erro ao enviar follow-up:', e); }
      } catch (e) { /* ignore */ }
    }, delayMs);
  } catch (e) { /* ignore */ }
}
