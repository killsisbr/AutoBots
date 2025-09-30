// public/js/pedidos.js - Lógica do painel de pedidos
// Extrair do inline script de pedidos.html + melhorias de UX (toasts, loading states)

const socket = io();
const lista = document.getElementById('lista');
const carrinhos = {};

// Sistema Multi-Tenant - Obter restaurantId
function getRestaurantId() {
  return window.currentRestaurantId || 'brutus-burger';
}

// Função auxiliar para construir URLs de API com restaurantId
function buildApiUrl(endpoint) {
  const restaurantId = getRestaurantId();
  // Sempre incluir o restaurantId na URL para multi-tenant
  const separator = endpoint.includes('?') ? '&' : '?';
  // set both keys for compatibility with different clients
  return `${endpoint}${separator}restaurant=${encodeURIComponent(restaurantId)}&restaurant_id=${encodeURIComponent(restaurantId)}&clienteId=${encodeURIComponent(restaurantId)}`;
}

// Wrapper fetch que mostra mensagens amigáveis e retorna JSON/text
async function api(path, opts) {
  try {
    const res = await fetch(buildApiUrl(path), Object.assign({ headers: {'Content-Type':'application/json'} }, opts||{}));
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch(e) { data = text; }
    if (!res.ok) {
      const msg = data && data.error ? data.error : (typeof data === 'string' && data.length ? data : ('HTTP ' + res.status));
      const err = new Error(msg);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  } catch (err) {
    // log para debug e rethrow
    console.error('API ERROR', path, err);
    throw err;
  }
}

// Mapa de bebidas para reconhecimento automático (IDs corretos do cardápio)
const mapaBebidas = {
  // Coca-Cola
  'coca lata': 25,        // Coca-Cola Lata (R$ 6.00)
  'coca zero': 26,        // Coca-Cola Zero Lata (R$ 6.00)
  'coca lata zero': 26,   // Coca-Cola Zero Lata (R$ 6.00)
  'coca zero lata': 26,   // Coca-Cola Zero Lata (R$ 6.00)
  'coca 2l': 82,          // Coca-Cola 2 Litros (R$ 13.00)
  'coca dois litros': 82, // Coca-Cola 2 Litros (R$ 13.00)
  'coca 2 litros': 82,    // Coca-Cola 2 Litros (R$ 13.00)
  'coca 2l zero': 86,     // Coca-Cola Zero 2 Litros (R$ 13.00)
  'coca dois litros zero': 86,  // Coca-Cola Zero 2 Litros (R$ 13.00)
  'coca 2 litros zero': 86,     // Coca-Cola Zero 2 Litros (R$ 13.00)
  'coca zero 2l': 86,           // Coca-Cola Zero 2 Litros (R$ 13.00)
  'coca zero dois litros': 86,  // Coca-Cola Zero 2 Litros (R$ 13.00)
  'coca zero 2 litros': 86,     // Coca-Cola Zero 2 Litros (R$ 13.00)
  // guaraná
  'guaraná lata': 80,     // Guaraná lata (R$ 6.00)
  'guarana lata': 80,     // Guaraná lata (R$ 6.00)
  // guaraná 2l
  'guaraná 2l': 79,            // Guaraná 2 Litros (R$ 12.00)
  'guaraná dois litros': 79,   // Guaraná 2 Litros (R$ 12.00)
  'guaraná 2 litros': 79,      // Guaraná 2 Litros (R$ 12.00)
  'guaraná 2 litro': 79,       // Guaraná 2 Litros (R$ 12.00)
  'guaraná 2lts': 79,          // Guaraná 2 Litros (R$ 12.00)
  'guaraná 2 lt': 79,          // Guaraná 2 Litros (R$ 12.00)
  'guaraná 2lt': 79,           // Guaraná 2 Litros (R$ 12.00)
  'lata guaraná': 80,          // Guaraná lata (R$ 6.00)
  'lata guarana': 80,          // Guaraná lata (R$ 6.00)
  'guarana 2l': 79,            // Guaraná 2 Litros (R$ 12.00)
  '2l guarana': 79,            // Guaraná 2 Litros (R$ 12.00)
  '2l guaraná': 79,            // Guaraná 2 Litros (R$ 12.00)
  'guarana 2 l': 79,           // Guaraná 2 Litros (R$ 12.00)
  'guaraná 2 l': 79            // Guaraná 2 Litros (R$ 12.00)
};

// Normaliza IDs/contatos exibidos no painel, removendo sufixos comuns
function sanitizeId(rawId) {
  if (!rawId) return '';
  // remove sufixos conhecidos como '@s.whatsapp.net' e '@broadcast'
  return String(rawId).replace('@s.whatsapp.net', '').replace('@broadcast', '');
}

// Configuration: when true, opening a conversation modal will automatically request
// printing the order (useful for kitchen stations). Can be toggled as needed.
const AUTO_PRINT_ON_OPEN = false;
// Prevent double auto-print for the same order during the session
const autoPrintDone = new Set();

// Flags para ações em andamento (evita cliques duplicados)
let actionsInFlight = new Set(); // ex: 'add', 'remove', 'updateQty', 'finalizar'

function showToast(message, type = 'info') {
  // Cria toast simples no topo da tela
  const toast = document.createElement('div');
  toast.style.cssText = `
    position: fixed; top: 20px; right: 20px; z-index: 10000;
    padding: 12px 16px; border-radius: 8px; color: #fff; font-size: 14px;
    background: ${type === 'success' ? '#2a7' : type === 'error' ? '#c44' : '#2ac'};
    box-shadow: 0 4px 12px rgba(0,0,0,0.3); max-width: 300px;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function setButtonLoading(buttonId, loading = true) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  if (loading) {
    btn.disabled = true;
    btn.style.opacity = '0.6';
    btn.innerHTML += ' ⏳'; // Indicador visual simples
  } else {
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.innerHTML = btn.innerHTML.replace(' ⏳', ''); // Remove spinner
  }
}

// Função para emitir ação com loading e toast
function emitAction(actionType, data, buttonId = null) {
  // Criar uma chave mais específica que inclui o ID e ação para evitar duplicatas
  const actionKey = `${actionType}_${data.id || 'global'}_${data.itemId || data.itemName || 'no-item'}`;
  if (actionsInFlight.has(actionKey)) return; // Evita duplicatas
  actionsInFlight.add(actionKey);
  if (buttonId) setButtonLoading(buttonId, true);

  socket.emit(actionType, data);

  socket.once('admin:ack', (r) => {
    actionsInFlight.delete(actionKey);
    if (buttonId) setButtonLoading(buttonId, false);
    if (r.ok) {
      showToast(`Ação ${actionType} realizada com sucesso!`, 'success');
      // Refresh UI se necessário
      if (data && data.id) setTimeout(() => showConversation(data.id), 100);
    } else {
      // Mapeamento de erros amigáveis
      const friendlyErrors = {
        'not_finalized': 'O pedido precisa estar finalizado antes de marcar como "Saiu para entrega".'
      };
      const msg = (r && r.error && friendlyErrors[r.error]) ? friendlyErrors[r.error] : `Erro em ${actionType}: ${r && r.error ? r.error : 'Desconhecido'}`;
      showToast(msg, 'error');
    }
  });
}

// Função para renderizar um card de pedido (versão melhorada)
function renderCard(id, data) {
  const card = document.createElement('div');
  card.className = 'card';
  card.id = `card-${id}`;
  
  const sanitizedId = sanitizeId(id);
  const nome = data.nome || 'Cliente';
  const estado = data.estado || 'menuInicial';
  const itens = (data.carrinho && data.carrinho.carrinho) || data.carrinho || data.itens || [];
  const total = (data.carrinho && data.carrinho.valorTotal) || data.valorTotal || data.total || 0;
  const endereco = data.endereco || '';
  
  // Determina a cor e texto do status
  let statusColor = '#95a5a6';
  let statusText = estado;
  
  if (estado.includes('menu') || estado.includes('confirmacao')) {
    statusColor = '#f1c40f';
    statusText = 'Pedindo';
  } else if (estado.includes('endereco') || estado.includes('Endereco')) {
    statusColor = '#3498db';
    statusText = 'Endereço';
  } else if (estado === 'finalizado' || estado.includes('final')) {
    statusColor = '#2ecc71';
    statusText = 'Finalizado';
  }
  
  card.innerHTML = `
    <div class="card-header">
      <div class="client-info">
        <h3 class="client-name">${nome}</h3>
        <div class="client-meta">
          <span class="client-id">${sanitizedId}</span>
          <span class="status-badge" style="background:${statusColor};">${statusText}</span>
        </div>
      </div>
      <div class="order-total">
        <div class="total-label">Total</div>
        <div class="total-amount">R$ ${Number(total).toFixed(2)}</div>
      </div>
    </div>

    <div class="card-content">
      ${itens.length === 0 ? 
        '<div class="empty-cart">Carrinho vazio</div>' : 
        `<div class="cart-items">
          ${itens.map((item, index) => `
            <div class="cart-item">
              <div class="item-info">
                <div class="item-name">${item.quantidade || 1}x ${item.nome || item.id || 'Item'}</div>
                ${item.preparo ? `<div class="item-preparation">${item.preparo}</div>` : ''}
              </div>
              <div class="item-controls">
                <button class="control-btn" onclick="emitUpdateQty('${id}', ${index}, -1)">−</button>
                <span class="item-qty">${item.quantidade || 1}</span>
                <button class="control-btn" onclick="emitUpdateQty('${id}', ${index}, 1)">+</button>
                <button class="control-btn delete" onclick="removeItem('${id}', ${index})">×</button>
              </div>
            </div>
          `).join('')}
        </div>`
      }
      
      <div class="add-item-section">
        <input type="text" id="add-input-${sanitizedId}" placeholder="Adicionar item (ex: 1 x burger)" 
               class="add-input" />
        <button id="add-btn-${sanitizedId}" class="add-btn" onclick="addItemByName('${id}', '${sanitizedId}')">+</button>
      </div>
    </div>

    <div class="card-actions">
      <button class="action-btn secondary" onclick="setState('${id}', 'menuInicial')">Reset</button>
      <button class="action-btn danger" onclick="reset('${id}')">Limpar</button>
      <button class="action-btn chat" onclick="showConversation('${id}')">Conversa</button>
      <button class="action-btn success" onclick="finalizar('${id}')">Finalizar</button>
      ${ (estado && (String(estado).includes('final') || String(estado) === 'finalizado')) ? `<button id="delivery-btn-${sanitizedId}" class="action-btn delivery" onclick="saiuEntrega('${id}')">Saiu</button>` : '' }
    </div>
  `;
  
  return card;
}

// Resto do código extraído (renderAll, addItemByName, etc.)
function renderAll() {
  lista.innerHTML = '';
  const keys = Object.keys(carrinhos).sort();
  for (const id of keys) {
    lista.appendChild(renderCard(id, carrinhos[id]));
  }
}

// Função showConversation removida daqui - versão completa está na linha 1851

// Prompt quick-edit for client name (from card)
function editClientNamePrompt(id) {
  const current = (carrinhos[id] && carrinhos[id].nome) ? carrinhos[id].nome : '';
  const novo = prompt('Novo nome do cliente:', current || '');
  if (novo === null) return; // cancel
  // emit via socket
  socket.emit('admin:updateName', { id, nome: novo });
}

function editClientAddressPrompt(id) {
  const current = (carrinhos[id] && carrinhos[id].endereco) ? carrinhos[id].endereco : '';
  const novo = prompt('Endereço do cliente (ex: Rua, nº, bairro):', current || '');
  if (novo === null) return;
  const novoTrim = String(novo || '').trim();
  if (novoTrim.length < 6) {
    showToast('Endereço muito curto. Informe no mínimo 6 caracteres.', 'error');
    return;
  }
  socket.emit('admin:updateEndereco', { id, endereco: novoTrim });
}

function setState(id, state) {
  emitAction('admin:setState', { id, state }, `reset-btn-${id}`);
}

function reset(id) {
  emitAction('admin:reset', { id }, `clear-btn-${id}`);
}

function finalizar(id) {
  emitAction('admin:finalizar', { id }, `final-btn-${id}`);
}

function saiuEntrega(id) {
  const btnId = `delivery-btn-${sanitizeId(id)}`;
  emitAction('admin:saiuEntrega', { id }, btnId);
}

// mapa dinâmico para itens adicionados via modal (nome limpo -> id)
// Será populado a partir do servidor (mappings persistidos no DB)
const mapaCardapio = {};

async function loadCardapioAndMappings() {
  try {
    // fetch mappings first (nome -> itemId)
    try {
      const mJson = await api('/api/cardapio/mappings');
      if (mJson && mJson.mappings) Object.assign(mapaCardapio, mJson.mappings);
    } catch (e) { console.warn('Não foi possível carregar mappings via API:', e); }
    // optionally fetch items for UI purposes (not strictly needed for mapping)
    try {
      const itJson = await api('/api/cardapio');
      if (itJson && Array.isArray(itJson.items)) {
        // if items exist, ensure any mapping referencing a numeric id that doesn't exist yet
        // is left as-is. We won't auto-create mappings here.
      }
    } catch(e) {}
  } catch (e) {
    console.error('Erro carregando cardapio/mappings do servidor', e);
  }
}

// Sistema Unificado de Gerenciamento do Cardápio
class CardapioManager {
  constructor() {
    this.currentTab = 'visualizar';
    this.cardapioData = [];
    this.editingItem = null;
    this.init();
  }

  init() {
    this.bindEvents();
    this.loadCardapioData();
  }

  bindEvents() {
    // Modal principal
    const openBtn = document.getElementById('btn-cardapio');
    const closeBtn = document.getElementById('cardapio-close');
    if (openBtn) openBtn.addEventListener('click', () => this.openModal());
    if (closeBtn) closeBtn.addEventListener('click', () => this.closeModal());

    // Sistema de abas
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
    });

    // Aba Visualizar & Editar
    const searchInput = document.getElementById('buscar-item-unified');
    const filterSelect = document.getElementById('filtro-tipo-unified');
    const refreshBtn = document.getElementById('refresh-cardapio-unified');
    
    if (searchInput) searchInput.addEventListener('input', () => this.filterItems());
    if (filterSelect) filterSelect.addEventListener('change', () => this.filterItems());
    if (refreshBtn) refreshBtn.addEventListener('click', () => this.refreshCardapio());

    // Aba Adicionar Item
    const saveBtn = document.getElementById('salvar-item-unified');
    const clearBtn = document.getElementById('limpar-form-unified');
    
    console.log('🔧 DEBUG: Botão salvar encontrado:', saveBtn);
    if (saveBtn) {
      console.log('🔧 DEBUG: Adicionando event listener ao botão salvar');
      saveBtn.addEventListener('click', () => {
        console.log('🔧 DEBUG: Botão salvar clicado!');
        this.saveNewItem();
      });
    }
    if (clearBtn) clearBtn.addEventListener('click', () => this.clearForm());

    // Aba Mapeamentos
    const addMappingBtn = document.getElementById('adicionar-mapeamento-unified');
    const addMultipleBtn = document.getElementById('adicionar-multiplos-gatilhos-unified');
    const refreshMappingsBtn = document.getElementById('refresh-mapeamentos-unified');
    
    if (addMappingBtn) addMappingBtn.addEventListener('click', () => this.addMapping());
    if (addMultipleBtn) addMultipleBtn.addEventListener('click', () => this.addMultipleMappings());
    if (refreshMappingsBtn) refreshMappingsBtn.addEventListener('click', () => this.loadMapeamentos());

    // Aba Configurações
    const backupBtn = document.getElementById('backup-cardapio');
    const restoreBtn = document.getElementById('restore-cardapio');
    const resetBtn = document.getElementById('reset-cardapio');
    const syncBtn = document.getElementById('sync-servidor');
    
    if (backupBtn) backupBtn.addEventListener('click', () => this.backupCardapio());
    if (restoreBtn) restoreBtn.addEventListener('click', () => this.restoreCardapio());
    if (resetBtn) resetBtn.addEventListener('click', () => this.resetCardapio());
    if (syncBtn) syncBtn.addEventListener('click', () => this.syncWithServer());
  }

  openModal() {
    const modal = document.getElementById('cardapio-modal');
    if (!modal) return;
    modal.style.display = 'flex';
    this.switchTab('visualizar');
    this.loadCardapioData();
    this.updateStats();
  }

  closeModal() {
    const modal = document.getElementById('cardapio-modal');
    if (!modal) return;
    modal.style.display = 'none';
    this.editingItem = null;
  }

  switchTab(tabName) {
    // Atualizar botões das abas
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.remove('active');
      btn.style.color = 'rgba(255,255,255,0.6)';
      btn.style.borderBottomColor = 'transparent';
    });
    
    const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
    if (activeBtn) {
      activeBtn.classList.add('active');
      activeBtn.style.color = '#fff';
      activeBtn.style.borderBottomColor = '#3498db';
    }

    // Mostrar/ocultar conteúdo das abas
    document.querySelectorAll('.tab-content').forEach(content => {
      content.style.display = 'none';
    });
    
    const activeContent = document.getElementById(`tab-${tabName}`);
    if (activeContent) {
      activeContent.style.display = 'block';
    }

    this.currentTab = tabName;
    
    // Carregar dados específicos da aba
    switch(tabName) {
      case 'visualizar':
        this.renderCardapioList();
        break;
      case 'mapeamentos':
        this.loadMapeamentos();
        break;
      case 'configuracoes':
        this.updateStats();
        break;
    }
  }

  async loadCardapioData() {
    try {
  // Carregar dados do servidor (banco SQLite)
  const data = await api('/api/cardapio');
      
      if (data && data.ok && Array.isArray(data.items)) {
        this.cardapioData = data.items;
        // Salvar no localStorage como backup
        localStorage.setItem('cardapio', JSON.stringify(this.cardapioData));
      } else {
        // Fallback para localStorage se servidor falhar
        const localData = localStorage.getItem('cardapio');
        if (localData) {
          this.cardapioData = JSON.parse(localData);
        } else {
          this.cardapioData = [];
        }
      }
      
      // Carregar mapeamentos
      await loadCardapioAndMappings();
      this.renderCardapioList();
    } catch (error) {
      console.error('Erro ao carregar dados do cardápio:', error);
      // Fallback para localStorage em caso de erro
      const localData = localStorage.getItem('cardapio');
      if (localData) {
        this.cardapioData = JSON.parse(localData);
        this.renderCardapioList();
      }
      showToast('Erro ao carregar cardápio do servidor, usando dados locais', 'warning');
    }
  }

  renderCardapioList() {
    console.log('🔧 DEBUG: renderCardapioList chamado');
    const container = document.getElementById('lista-cardapio-unified');
    if (!container) {
      console.log('🔧 DEBUG: Container lista-cardapio-unified não encontrado!');
      return;
    }
    console.log('🔧 DEBUG: Container encontrado, dados do cardápio:', this.cardapioData);

    const searchTerm = document.getElementById('buscar-item-unified')?.value.toLowerCase() || '';
    const filterType = document.getElementById('filtro-tipo-unified')?.value || '';
    
    let filteredData = this.cardapioData.filter(item => {
      const matchesSearch = !searchTerm || 
        item.nome.toLowerCase().includes(searchTerm) ||
        (item.descricao && item.descricao.toLowerCase().includes(searchTerm));
      const matchesType = !filterType || item.tipo === filterType;
      return matchesSearch && matchesType;
    });

    if (filteredData.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;color:rgba(255,255,255,0.6);padding:40px;">
          <div style="font-size:48px;margin-bottom:16px;">🍽️</div>
          <div style="font-size:18px;margin-bottom:8px;">Nenhum item encontrado</div>
          <div style="font-size:14px;">Tente ajustar os filtros ou adicionar novos itens</div>
        </div>
      `;
      return;
    }

    const tipoIcons = {
      'Lanche': '🍔',
      'Bebida': '🥤',
      'Adicional': '🧀',
      'Sobremesa': '🍰'
    };

    const tipoColors = {
      'Lanche': '#10b981',
      'Bebida': '#3b82f6',
      'Adicional': '#f59e0b',
      'Sobremesa': '#8b5cf6'
    };

    container.innerHTML = filteredData.map(item => `
      <div class="cardapio-item" data-id="${item.id || item.nome}" style="
        background:rgba(255,255,255,0.05);
        backdrop-filter:blur(10px);
        border:1px solid rgba(255,255,255,0.1);
        border-radius:12px;
        padding:20px;
        transition:all 0.3s ease;
        cursor:pointer;
      " onmouseover="this.style.transform='translateY(-2px)';this.style.boxShadow='0 8px 25px rgba(0,0,0,0.3)'" onmouseout="this.style.transform='translateY(0)';this.style.boxShadow='none'">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
          <div style="flex:1;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
              <span style="font-size:24px;">${tipoIcons[item.tipo] || '📦'}</span>
              <div>
                <h4 style="margin:0;color:#fff;font-size:18px;font-weight:600;" onclick="cardapioManager.editField('${item.id || item.nome}', 'nome', this)">${item.nome}</h4>
                <span style="
                  background:${tipoColors[item.tipo] || '#6b7280'};
                  color:#fff;
                  padding:4px 12px;
                  border-radius:20px;
                  font-size:12px;
                  font-weight:500;
                ">${item.tipo}</span>
              </div>
            </div>
            ${item.descricao ? `<p style="margin:0 0 8px 0;color:rgba(255,255,255,0.7);font-size:14px;" onclick="cardapioManager.editField('${item.id || item.nome}', 'descricao', this)">${item.descricao}</p>` : ''}
            <div style="display:flex;align-items:center;gap:16px;">
              <div style="color:#10b981;font-weight:bold;font-size:20px;" onclick="cardapioManager.editField('${item.id || item.nome}', 'preco', this)">R$ ${item.preco ? item.preco.toFixed(2) : '0.00'}</div>
              ${item.id ? `<div style="color:rgba(255,255,255,0.5);font-size:12px;">ID: ${item.id}</div>` : ''}
            </div>
            ${item.gatilhos && item.gatilhos.length > 0 ? `
              <div style="margin-top:12px;">
                <div style="color:rgba(255,255,255,0.6);font-size:12px;margin-bottom:4px;">Gatilhos:</div>
                <div style="display:flex;flex-wrap:wrap;gap:6px;" onclick="cardapioManager.editField('${item.id || item.nome}', 'gatilhos', this)">
                  ${item.gatilhos.map(g => `<span style="background:rgba(255,255,255,0.1);color:rgba(255,255,255,0.8);padding:2px 8px;border-radius:12px;font-size:11px;">${g}</span>`).join('')}
                </div>
              </div>
            ` : ''}
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button onclick="console.log('🔧 DEBUG: Botão editar clicado para item:', '${item.id || item.nome}'); cardapioManager.editItem('${item.id || item.nome}')" style="
              background:linear-gradient(135deg,#3b82f6,#1d4ed8);
              color:#fff;
              border:0;
              padding:8px 12px;
              border-radius:6px;
              cursor:pointer;
              font-size:12px;
              font-weight:500;
            ">✏️ Editar</button>
            <button onclick="(async () => await cardapioManager.viewTriggers('${item.id || item.nome}'))()" style="
              background:linear-gradient(135deg,#8b5cf6,#7c3aed);
              color:#fff;
              border:0;
              padding:8px 12px;
              border-radius:6px;
              cursor:pointer;
              font-size:12px;
              font-weight:500;
            ">🎯 Ver Gatilhos</button>
            <button onclick="cardapioManager.deleteItem('${item.id || item.nome}')" style="
              background:linear-gradient(135deg,#ef4444,#dc2626);
              color:#fff;
              border:0;
              padding:8px 12px;
              border-radius:6px;
              cursor:pointer;
              font-size:12px;
              font-weight:500;
            ">🗑️ Excluir</button>
          </div>
        </div>
      </div>
    `).join('');
  }

  filterItems() {
    this.renderCardapioList();
  }

  refreshCardapio() {
    this.loadCardapioData();
    showToast('🔄 Cardápio atualizado', 'info');
  }

  // Edição inline de campos
  editField(itemId, field, element) {
    const item = this.cardapioData.find(i => (i.id || i.nome) === itemId);
    if (!item) return;

    const currentValue = field === 'gatilhos' ? item[field]?.join(', ') || '' : item[field] || '';
    const input = document.createElement('input');
    input.type = field === 'preco' ? 'number' : 'text';
    input.value = currentValue;
    input.style.cssText = `
      background:rgba(255,255,255,0.1);
      border:1px solid #3498db;
      border-radius:4px;
      padding:4px 8px;
      color:#fff;
      font-size:inherit;
      width:100%;
    `;

    const originalText = element.textContent;
    element.innerHTML = '';
    element.appendChild(input);
    input.focus();
    input.select();

    const saveEdit = () => {
      let newValue = input.value.trim();
      
      if (field === 'preco') {
        newValue = parseFloat(newValue) || 0;
      } else if (field === 'gatilhos') {
        newValue = newValue.split(',').map(g => g.trim()).filter(g => g);
      }
      
      item[field] = newValue;
      this.saveCardapioData();
      this.renderCardapioList();
      showToast(`✅ ${field} atualizado`, 'success');
    };

    const cancelEdit = () => {
      element.textContent = originalText;
    };

    input.addEventListener('blur', saveEdit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveEdit();
      if (e.key === 'Escape') cancelEdit();
    });
  }

  editItem(itemId) {
    console.log('🔧 DEBUG: editItem chamado com ID:', itemId, 'tipo:', typeof itemId);
    console.log('🔧 DEBUG: cardapioData length:', this.cardapioData.length);
    console.log('🔧 DEBUG: Todos os IDs disponíveis:', this.cardapioData.map(i => i.id));
    const item = this.cardapioData.find(i => i.id == itemId || i.id === parseInt(itemId) || i.id === String(itemId));
    console.log('🔧 DEBUG: Item encontrado:', item);
    console.log('🔧 DEBUG: Primeiros 3 itens:', this.cardapioData.slice(0, 3));
    
    if (!item) {
      console.log('🔧 DEBUG: Item não encontrado!');
      showToast('❌ Item não encontrado', 'error');
      return;
    }

    // Preencher formulário na aba de adicionar
    console.log('🔧 DEBUG: Mudando para aba adicionar');
    this.switchTab('adicionar');
    
    console.log('🔧 DEBUG: Preenchendo formulário');
    document.getElementById('item-nome-unified').value = item.nome || '';
    document.getElementById('item-desc-unified').value = item.descricao || '';
    document.getElementById('item-preco-unified').value = item.preco || '';
    document.getElementById('item-tipo-unified').value = item.tipo || '';
    document.getElementById('item-gatilhos-unified').value = item.gatilhos?.join(', ') || '';
    
    this.editingItem = itemId;
    document.getElementById('salvar-item-unified').textContent = '💾 Atualizar Item';
    console.log('🔧 DEBUG: Modo de edição ativado para item:', itemId);
    showToast('📝 Modo de edição ativado', 'info');
  }

  duplicateItem(itemId) {
    const item = this.cardapioData.find(i => (i.id || i.nome) === itemId);
    if (!item) return;

    const newItem = {
      ...item,
      nome: `${item.nome} (Cópia)`,
      id: Date.now() // Novo ID
    };
    
    this.cardapioData.push(newItem);
    this.saveCardapioData();
    this.renderCardapioList();
    showToast('📋 Item duplicado com sucesso', 'success');
  }

  async viewTriggers(itemId) {
    const item = this.cardapioData.find(i => (i.id || i.nome) === itemId);
    if (!item) {
      showToast('❌ Item não encontrado', 'error');
      return;
    }
    
    // Buscar gatilhos dos mappings do servidor
    let gatilhos = [];
    try {
      const data = await api('/api/cardapio/mappings');
      if (data && data.mappings) {
        // Criar mapa reverso: encontrar todos os gatilhos que apontam para este item
        gatilhos = Object.entries(data.mappings)
          .filter(([gatilho, mappedItemId]) => mappedItemId == itemId)
          .map(([gatilho, mappedItemId]) => gatilho);
      }
    } catch (error) {
      console.error('Erro ao carregar gatilhos:', error);
      showToast('⚠️ Erro ao carregar gatilhos do servidor', 'warning');
    }
    
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.8);
      backdrop-filter: blur(10px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 3000;
    `;
    
    modal.innerHTML = `
      <div style="
        background: rgba(255,255,255,0.1);
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255,255,255,0.2);
        color: #fff;
        width: 500px;
        max-width: 95%;
        border-radius: 16px;
        padding: 24px;
        box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h3 style="margin:0;font-size:20px;font-weight:600;">🎯 Gatilhos do Item</h3>
          <button onclick="this.closest('div').parentElement.remove()" style="
            background:rgba(255,255,255,0.1);
            border:1px solid rgba(255,255,255,0.2);
            color:#fff;
            padding:8px 12px;
            border-radius:8px;
            cursor:pointer;
          ">✕ Fechar</button>
        </div>
        
        <div style="margin-bottom:16px;">
          <h4 style="margin:0 0 8px 0;color:#fff;">${item.nome}</h4>
          <p style="margin:0;color:rgba(255,255,255,0.7);font-size:14px;">ID: ${item.id || 'Auto'} | Tipo: ${item.tipo}</p>
        </div>
        
        <div style="
          background:rgba(255,255,255,0.05);
          border:1px solid rgba(255,255,255,0.1);
          border-radius:12px;
          padding:16px;
          margin-bottom:20px;
        ">
          <h5 style="margin:0 0 12px 0;color:#fff;">Gatilhos Atuais (${gatilhos.length}):</h5>
          ${gatilhos.length > 0 ? 
            gatilhos.map(g => `<span style="
              background:rgba(139,92,246,0.2);
              border:1px solid rgba(139,92,246,0.3);
              color:#c4b5fd;
              padding:6px 12px;
              border-radius:20px;
              font-size:12px;
              margin:4px 4px 4px 0;
              display:inline-block;
            ">${g}</span>`).join('') 
            : '<p style="margin:0;color:rgba(255,255,255,0.5);font-style:italic;">Nenhum gatilho configurado para este item</p>'
          }
        </div>
        
        <div style="display:flex;gap:12px;justify-content:flex-end;">
          <button onclick="cardapioManager.editItem('${itemId}'); this.closest('div').parentElement.remove();" style="
            background:linear-gradient(135deg,#3b82f6,#1d4ed8);
            color:#fff;
            border:0;
            padding:10px 16px;
            border-radius:8px;
            cursor:pointer;
            font-weight:500;
          ">✏️ Editar Item</button>
          <button onclick="this.closest('div').parentElement.remove()" style="
            background:rgba(255,255,255,0.1);
            border:1px solid rgba(255,255,255,0.2);
            color:#fff;
            padding:10px 16px;
            border-radius:8px;
            cursor:pointer;
          ">Fechar</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Fechar modal ao clicar fora
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.remove();
      }
    });
  }

  async deleteItem(itemId) {
    if (!confirm('Tem certeza que deseja excluir este item?')) return;
    
    try {
      // Tentar remover do servidor primeiro
      const res = await api(`/api/cardapio/${encodeURIComponent(itemId)}`, { method: 'DELETE' });
      showToast((res && res.ok) ? '🗑️ Item excluído do servidor' : '🗑️ Item excluído', 'success');
      // Recarregar dados do servidor
      await this.loadCardapioData();
    } catch (error) {
      console.error('Erro ao excluir item:', error);
      // Fallback: remover apenas localmente
      this.cardapioData = this.cardapioData.filter(i => (i.id || i.nome) !== itemId);
      this.saveCardapioData();
      this.renderCardapioList();
      showToast('🗑️ Item excluído localmente (erro no servidor)', 'warning');
    }
  }

  async saveNewItem() {
    console.log('🔧 DEBUG: saveNewItem iniciado');
    const nome = document.getElementById('item-nome-unified').value.trim();
    const descricao = document.getElementById('item-desc-unified').value.trim();
    const preco = parseFloat(document.getElementById('item-preco-unified').value) || 0;
    const tipo = document.getElementById('item-tipo-unified').value;
    const gatilhosText = document.getElementById('item-gatilhos-unified').value.trim();
    const gatilhos = gatilhosText ? gatilhosText.split(',').map(g => g.trim()).filter(g => g) : [];

    console.log('🔧 DEBUG: Dados coletados:', { nome, descricao, preco, tipo, gatilhos });

    if (!nome || !tipo) {
      console.log('🔧 DEBUG: Validação falhou - nome ou tipo vazio');
      showToast('❌ Nome e tipo são obrigatórios', 'error');
      return;
    }

    try {
      if (this.editingItem) {
        // Atualizar item existente via API
        console.log('🔧 DEBUG: Atualizando item existente:', this.editingItem);
        const result = await api(`/api/cardapio/${encodeURIComponent(this.editingItem)}`, { method: 'PUT', body: JSON.stringify({ nome, descricao, preco, tipo }) });
        
        if (result) {
          
          console.log('🔧 DEBUG: Item atualizado no servidor:', result);
          
            // Atualizar mapeamentos se houver gatilhos
            if (gatilhos.length > 0) {
              // Primeiro, remover mapeamentos antigos do item
              try {
                await api(`/api/cardapio/mappings/${encodeURIComponent(this.editingItem)}`, { method: 'DELETE' });
              } catch (e) {
                console.warn('Erro ao remover mapeamentos antigos:', e);
              }
            
              // Adicionar novos mapeamentos
              for (const gatilho of gatilhos) {
                try {
                  await api('/api/cardapio/mappings', { method: 'POST', body: JSON.stringify({ nome: gatilho.toLowerCase(), itemId: this.editingItem }) });
                } catch (e) {
                  console.error('Erro ao adicionar mapeamento:', e);
                }
              }
            }
          
          showToast('✅ Item atualizado com sucesso', 'success');
          // Recarregar dados do servidor
          await this.loadCardapioData();
        } else {
          throw new Error('Falha ao atualizar item no servidor');
        }
      } else {
        // Adicionar novo item via API
        console.log('🔧 DEBUG: Enviando requisição para API');
        const result = await api('/api/cardapio', { method: 'POST', body: JSON.stringify({ nome, descricao, preco, tipo }) });
        console.log('🔧 DEBUG: Resultado da API:', result);
        if (result && result.ok) {
          showToast('✅ Item adicionado ao servidor', 'success');
          
          // Adicionar mapeamentos se houver gatilhos
            if (gatilhos.length > 0) {
              for (const gatilho of gatilhos) {
                try {
                  await api('/api/cardapio/mappings', { method: 'POST', body: JSON.stringify({ nome: gatilho.toLowerCase(), itemId: result.id }) });
                } catch (e) {
                  console.error('Erro ao adicionar mapeamento:', e);
                }
              }
            }
          
          // Recarregar dados do servidor
          await this.loadCardapioData();
        } else {
          throw new Error('Falha ao adicionar item');
        }
      }
    } catch (error) {
      console.error('🔧 DEBUG: Erro capturado:', error);
      console.error('Erro ao salvar item:', error);
      showToast('❌ Erro ao salvar item', 'error');
      return;
    }

    this.clearForm();
    this.switchTab('visualizar');
  }

  clearForm() {
    document.getElementById('item-nome-unified').value = '';
    document.getElementById('item-desc-unified').value = '';
    document.getElementById('item-preco-unified').value = '';
    document.getElementById('item-tipo-unified').value = '';
    document.getElementById('item-gatilhos-unified').value = '';
    
    this.editingItem = null;
    document.getElementById('salvar-item-unified').textContent = '💾 Salvar Item';
  }

  async loadMapeamentos() {
    const container = document.getElementById('lista-mapeamentos-unified');
    if (!container) return;

    let mapeamentos = {};
    try {
      // Carregar mapeamentos do servidor
      const data = await api('/api/cardapio/mappings');
      if (data && data.mappings) mapeamentos = data.mappings;
    } catch (error) {
      console.error('Erro ao carregar mapeamentos do servidor:', error);
      // Fallback para localStorage
      mapeamentos = JSON.parse(localStorage.getItem('mapeamentos') || '{}');
    }
    
    const entries = Object.entries(mapeamentos);

    if (entries.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;color:rgba(255,255,255,0.6);padding:40px;">
          <div style="font-size:48px;margin-bottom:16px;">🔗</div>
          <div style="font-size:18px;margin-bottom:8px;">Nenhum mapeamento encontrado</div>
          <div style="font-size:14px;">Adicione mapeamentos para conectar palavras aos itens</div>
        </div>
      `;
      return;
    }

    container.innerHTML = entries.map(([gatilho, itemId]) => {
      const item = this.cardapioData.find(i => i.id == itemId);
      return `
        <div style="
          background:rgba(255,255,255,0.05);
          border:1px solid rgba(255,255,255,0.1);
          border-radius:8px;
          padding:16px;
          display:flex;
          justify-content:space-between;
          align-items:center;
        ">
          <div>
            <div style="color:#fff;font-weight:600;margin-bottom:4px;">"${gatilho}"</div>
            <div style="color:rgba(255,255,255,0.7);font-size:14px;">
              → ${item ? item.nome : `Item ID: ${itemId}`}
            </div>
          </div>
          <button onclick="cardapioManager.removeMapping('${gatilho}')" style="
            background:#ef4444;
            color:#fff;
            border:0;
            padding:8px 12px;
            border-radius:4px;
            cursor:pointer;
          ">🗑️ Remover</button>
        </div>
      `;
    }).join('');
  }

  async addMapping() {
    const gatilho = prompt('Digite o gatilho (palavra-chave):');
    if (!gatilho) return;

    const itemNome = prompt('Digite o nome do item:');
    if (!itemNome) return;

    const item = this.cardapioData.find(i => i.nome.toLowerCase().includes(itemNome.toLowerCase()));
    if (!item) {
      showToast('❌ Item não encontrado', 'error');
      return;
    }

    try {
      // Adicionar mapeamento via API
      await api('/api/cardapio/mappings', { method: 'POST', body: JSON.stringify({ nome: gatilho.toLowerCase(), itemId: item.id }) });
      showToast('✅ Mapeamento adicionado ao servidor', 'success');
      // Recarregar mapeamentos
      await loadCardapioAndMappings();
      await this.loadMapeamentos();
    } catch (error) {
      console.error('Erro ao adicionar mapeamento:', error);
      // Fallback: adicionar apenas localmente
      const mapeamentos = JSON.parse(localStorage.getItem('mapeamentos') || '{}');
      mapeamentos[gatilho.toLowerCase()] = item.id;
      localStorage.setItem('mapeamentos', JSON.stringify(mapeamentos));
      this.loadMapeamentos();
      showToast('✅ Mapeamento adicionado localmente (erro no servidor)', 'warning');
    }
  }

  addMultipleMappings() {
    const text = prompt('Digite os gatilhos separados por vírgula:');
    if (!text) return;

    const itemNome = prompt('Digite o nome do item:');
    if (!itemNome) return;

    const item = this.cardapioData.find(i => i.nome.toLowerCase().includes(itemNome.toLowerCase()));
    if (!item) {
      showToast('❌ Item não encontrado', 'error');
      return;
    }

    const gatilhos = text.split(',').map(g => g.trim()).filter(g => g);
    const mapeamentos = JSON.parse(localStorage.getItem('mapeamentos') || '{}');
    
    gatilhos.forEach(gatilho => {
      mapeamentos[gatilho.toLowerCase()] = item.id;
    });
    
    localStorage.setItem('mapeamentos', JSON.stringify(mapeamentos));
    this.loadMapeamentos();
    showToast(`✅ ${gatilhos.length} mapeamentos adicionados`, 'success');
  }

  async removeMapping(gatilho) {
    if (!confirm(`Remover mapeamento "${gatilho}"?`)) return;
    
    try {
      // Remover mapeamento via API
      await api(`/api/cardapio/mappings/${encodeURIComponent(gatilho)}`, { method: 'DELETE' });
      showToast('🗑️ Mapeamento removido do servidor', 'success');
      // Recarregar mapeamentos
      await loadCardapioAndMappings();
      await this.loadMapeamentos();
    } catch (error) {
      console.error('Erro ao remover mapeamento:', error);
      // Fallback: remover apenas localmente
      const mapeamentos = JSON.parse(localStorage.getItem('mapeamentos') || '{}');
      delete mapeamentos[gatilho];
      localStorage.setItem('mapeamentos', JSON.stringify(mapeamentos));
      this.loadMapeamentos();
      showToast('🗑️ Mapeamento removido localmente (erro no servidor)', 'warning');
    }
  }

  updateStats() {
    const totalItens = this.cardapioData.length;
    const mapeamentos = JSON.parse(localStorage.getItem('mapeamentos') || '{}');
    const totalMapeamentos = Object.keys(mapeamentos).length;
    
    const tipos = {};
    this.cardapioData.forEach(item => {
      tipos[item.tipo] = (tipos[item.tipo] || 0) + 1;
    });

    const statsContainer = document.getElementById('stats-cardapio');
    if (statsContainer) {
      statsContainer.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;">
          <div style="background:rgba(255,255,255,0.05);padding:20px;border-radius:8px;text-align:center;">
            <div style="font-size:32px;color:#3498db;font-weight:bold;">${totalItens}</div>
            <div style="color:rgba(255,255,255,0.7);">Total de Itens</div>
          </div>
          <div style="background:rgba(255,255,255,0.05);padding:20px;border-radius:8px;text-align:center;">
            <div style="font-size:32px;color:#10b981;font-weight:bold;">${totalMapeamentos}</div>
            <div style="color:rgba(255,255,255,0.7);">Mapeamentos</div>
          </div>
          <div style="background:rgba(255,255,255,0.05);padding:20px;border-radius:8px;text-align:center;">
            <div style="font-size:32px;color:#f59e0b;font-weight:bold;">${Object.keys(tipos).length}</div>
            <div style="color:rgba(255,255,255,0.7);">Tipos</div>
          </div>
        </div>
        <div style="margin-top:20px;">
          <h4 style="color:#fff;margin-bottom:12px;">Distribuição por Tipo:</h4>
          ${Object.entries(tipos).map(([tipo, count]) => `
            <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
              <span style="color:rgba(255,255,255,0.8);">${tipo}</span>
              <span style="color:#3498db;font-weight:bold;">${count}</span>
            </div>
          `).join('')}
        </div>
      `;
    }
  }

  backupCardapio() {
    const data = {
      cardapio: this.cardapioData,
      mapeamentos: JSON.parse(localStorage.getItem('mapeamentos') || '{}'),
      timestamp: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cardapio-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showToast('💾 Backup criado', 'success');
  }

  restoreCardapio() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.cardapio && data.mapeamentos) {
            this.cardapioData = data.cardapio;
            localStorage.setItem('cardapio', JSON.stringify(data.cardapio));
            localStorage.setItem('mapeamentos', JSON.stringify(data.mapeamentos));
            this.renderCardapioList();
            this.updateStats();
            showToast('📥 Backup restaurado', 'success');
          } else {
            showToast('❌ Arquivo de backup inválido', 'error');
          }
        } catch (error) {
          showToast('❌ Erro ao ler arquivo', 'error');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  resetCardapio() {
    if (!confirm('ATENÇÃO: Isso irá apagar todos os dados do cardápio e mapeamentos. Continuar?')) return;
    
    this.cardapioData = [];
    localStorage.removeItem('cardapio');
    localStorage.removeItem('mapeamentos');
    this.renderCardapioList();
    this.loadMapeamentos();
    this.updateStats();
    showToast('🔄 Sistema resetado', 'info');
  }

  syncWithServer() {
    showToast('🔄 Sincronizando...', 'info');
    loadCardapioAndMappings().then(() => {
      this.loadCardapioData();
      showToast('✅ Sincronização concluída', 'success');
    }).catch(() => {
      showToast('❌ Erro na sincronização', 'error');
    });
  }

  saveCardapioData() {
    localStorage.setItem('cardapio', JSON.stringify(this.cardapioData));
  }
}

// Instância global do gerenciador
let cardapioManager;

// Helpers para compatibilidade
function openCardapioModal() {
  if (!cardapioManager) cardapioManager = new CardapioManager();
  cardapioManager.openModal();
}

function closeCardapioModal() {
  if (cardapioManager) cardapioManager.closeModal();
}

// Função para mostrar notificações
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  const colors = {
    success: '#10b981',
    error: '#ef4444',
    info: '#3b82f6',
    warning: '#f59e0b'
  };
  
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${colors[type] || colors.info};
    color: white;
    padding: 12px 20px;
    border-radius: 8px;
    font-weight: 500;
    z-index: 10000;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    animation: slideIn 0.3s ease;
  `;
  
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Adicionar estilos de animação
if (!document.getElementById('toast-styles')) {
  const style = document.createElement('style');
  style.id = 'toast-styles';
  style.textContent = `
    @keyframes slideIn {
      from { transform: translateX(100%); opacity: 0; }
      to { transform: translateX(0); opacity: 1; }
    }
    @keyframes slideOut {
      from { transform: translateX(0); opacity: 1; }
      to { transform: translateX(100%); opacity: 0; }
    }
  `;
  document.head.appendChild(style);
}

// Função para carregar mapeamentos no submodal
function loadMapeamentos() {
  const container = document.getElementById('lista-mapeamentos');
  if (!container) return;
  const entries = Object.keys(mapaCardapio).sort();
  if (entries.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#95a5a6;padding:20px;">📝 Nenhum mapeamento definido</div>';
    return;
  }
  container.innerHTML = entries.map(k => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;margin-bottom:8px;background:rgba(255,255,255,0.03);border-radius:6px;border-left:3px solid #f39c12;">
      <div>
        <div style="font-weight:bold;color:#fff;">${k}</div>
        <div style="font-size:12px;color:#95a5a6;">→ ID: ${mapaCardapio[k]}</div>
      </div>
      <button onclick="removeMapping('${k}')" style="background:#e74c3c;color:#fff;border:0;padding:6px 12px;border-radius:4px;cursor:pointer;font-size:12px;">🗑️ Remover</button>
    </div>
  `).join('');
}

// Função para carregar cardápio completo no submodal
function loadCardapioCompleto() {
  const container = document.getElementById('lista-cardapio');
  const filtroTipo = document.getElementById('filtro-tipo').value;
  const busca = document.getElementById('buscar-item').value.toLowerCase();
  
  if (!container) return;
  
  // Simular dados do cardápio (em produção viria do servidor)
  let cardapio = JSON.parse(localStorage.getItem('cardapio') || '[]');
  
  // Aplicar filtros
  if (filtroTipo) {
    cardapio = cardapio.filter(item => item.tipo === filtroTipo);
  }
  
  if (busca) {
    cardapio = cardapio.filter(item => 
      item.nome.toLowerCase().includes(busca) || 
      (item.descricao && item.descricao.toLowerCase().includes(busca))
    );
  }
  
  if (cardapio.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:#95a5a6;padding:20px;">🍽️ Nenhum item encontrado</div>';
    return;
  }
  
  const tipoIcons = {
    'Lanche': '🍔',
    'Bebida': '🥤', 
    'Adicional': '🧀',
    'Sobremesa': '🍰'
  };
  
  container.innerHTML = cardapio.map(item => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:16px;margin-bottom:12px;background:rgba(255,255,255,0.03);border-radius:8px;border-left:4px solid #9b59b6;">
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:20px;">${tipoIcons[item.tipo] || '📦'}</span>
          <span style="font-weight:bold;color:#fff;font-size:16px;">${item.nome}</span>
          <span style="background:${item.tipo === 'Lanche' ? '#2ecc71' : item.tipo === 'Bebida' ? '#3498db' : item.tipo === 'Adicional' ? '#f39c12' : '#9b59b6'};color:#fff;padding:2px 8px;border-radius:12px;font-size:10px;">${item.tipo}</span>
        </div>
        ${item.descricao ? `<div style="color:#95a5a6;font-size:14px;margin-bottom:4px;">${item.descricao}</div>` : ''}
        <div style="color:#2ecc71;font-weight:bold;font-size:16px;">R$ ${item.preco.toFixed(2)}</div>
        ${item.gatilhos && item.gatilhos.length > 0 ? `<div style="margin-top:8px;"><small style="color:#95a5a6;">Gatilhos: ${item.gatilhos.join(', ')}</small></div>` : ''}
      </div>
      <div style="text-align:right;">
        <div style="color:#95a5a6;font-size:12px;">ID: ${item.id || 'Auto'}</div>
      </div>
    </div>
  `).join('');
}

function renderCardapioMappings() {
  // Manter compatibilidade com código existente
  loadMapeamentos();
}

function removeMapping(nome) {
  // request server to remove mapping
  socket.emit('admin:removeMapping', { nome });
}

// Evento para adicionar gatilho a partir do modal
function addTriggerFromModal() {
  const nomeEl = document.getElementById('cardapio-nome');
  const idEl = document.getElementById('cardapio-id');
  if (!nomeEl || !idEl) return;
  const nome = (nomeEl.value || '').trim().toLowerCase();
  const id = idEl.value ? Number(idEl.value) : null;
  if (!nome || !id) return showToast('Nome e ID obrigatórios para o gatilho', 'error');
  socket.emit('admin:addMapping', { nome, itemId: id });
}

// Evento para adicionar múltiplos gatilhos a partir do modal
function addMultipleTriggersFromModal() {
  const nomeEl = document.getElementById('cardapio-nome');
  const idEl = document.getElementById('cardapio-id');
  const gatilhosEl = document.getElementById('cardapio-gatilhos');
  if (!nomeEl || !idEl || !gatilhosEl) return;
  
  const nome = (nomeEl.value || '').trim();
  const id = idEl.value ? Number(idEl.value) : null;
  const gatilhosText = (gatilhosEl.value || '').trim();
  
  if (!nome || !id) return showToast('Nome e ID obrigatórios para os gatilhos', 'error');
  if (!gatilhosText) return showToast('Digite pelo menos um gatilho', 'error');
  
  // Processa os gatilhos separados por vírgula
  const gatilhos = gatilhosText.split(',').map(g => g.trim().toLowerCase()).filter(g => g.length > 0);
  
  if (gatilhos.length === 0) return showToast('Nenhum gatilho válido encontrado', 'error');
  
  // Adiciona o nome do item como primeiro gatilho se não estiver na lista
  const nomeNormalizado = nome.toLowerCase();
  if (!gatilhos.includes(nomeNormalizado)) {
    gatilhos.unshift(nomeNormalizado);
  }
  
  // Envia via API REST para melhor controle
  (async () => {
    try {
      const data = await api('/api/cardapio/mappings/multiple', { method: 'POST', body: JSON.stringify({ gatilhos, itemId: id }) });
      if (data && data.ok) {
        showToast(`${gatilhos.length} gatilhos adicionados com sucesso!`, 'success');
        gatilhosEl.value = ''; // Limpa o campo
        // Recarrega os mapeamentos
        await loadCardapioAndMappings();
        renderCardapioMappings();
      } else {
        showToast('Erro ao adicionar gatilhos: ' + (data && data.error ? data.error : 'unknown'), 'error');
      }
    } catch (err) {
      console.error('Erro ao adicionar múltiplos gatilhos:', err);
      showToast('Erro de conexão ao adicionar gatilhos', 'error');
    }
  })();
}

// Save local (keeps mapping in the current page). Could be extended to persist via API/socket
function saveCardapioLocal() {
  // open server modal save: request full cardapio items to be refreshed
  socket.emit('admin:getCardapio');
  showToast('Solicitando sincronização do cardápio ao servidor...', 'info');
}

// Hook buttons (will be wired on load)
document.addEventListener('DOMContentLoaded', () => {
  // Inicializar o CardapioManager automaticamente
  console.log('🔧 DEBUG: Inicializando CardapioManager no DOMContentLoaded');
  if (!cardapioManager) {
    cardapioManager = new CardapioManager();
    console.log('🔧 DEBUG: CardapioManager criado:', cardapioManager);
  } else {
    console.log('🔧 DEBUG: CardapioManager já existe:', cardapioManager);
  }
  
  // Tornar cardapioManager global para debug
  window.cardapioManager = cardapioManager;
  console.log('🔧 DEBUG: cardapioManager disponível globalmente');
  
  const btn = document.getElementById('btn-cardapio');
  if (btn) btn.addEventListener('click', openCardapioModal);
  const closeBtn = document.getElementById('cardapio-close');
  if (closeBtn) closeBtn.addEventListener('click', closeCardapioModal);
  
  // Botões do menu principal
  const btnAdicionarItem = document.getElementById('btn-adicionar-item');
  if (btnAdicionarItem) btnAdicionarItem.addEventListener('click', () => {
    document.getElementById('adicionar-item-modal').style.display = 'flex';
    document.getElementById('cardapio-status').textContent = 'Modo: Adicionar Item';
  });
  
  const btnGerenciarMapeamentos = document.getElementById('btn-gerenciar-mapeamentos');
  if (btnGerenciarMapeamentos) btnGerenciarMapeamentos.addEventListener('click', () => {
    document.getElementById('mapeamentos-modal').style.display = 'flex';
    document.getElementById('cardapio-status').textContent = 'Modo: Gerenciar Mapeamentos';
    loadMapeamentos();
  });
  
  const btnVisualizarCardapio = document.getElementById('btn-visualizar-cardapio');
  if (btnVisualizarCardapio) btnVisualizarCardapio.addEventListener('click', () => {
    document.getElementById('visualizar-cardapio-modal').style.display = 'flex';
    document.getElementById('cardapio-status').textContent = 'Modo: Visualizar Cardápio';
    loadCardapioCompleto();
  });
  
  // Submodal: Adicionar Item
  const adicionarItemClose = document.getElementById('adicionar-item-close');
  if (adicionarItemClose) adicionarItemClose.addEventListener('click', () => {
    document.getElementById('adicionar-item-modal').style.display = 'none';
    document.getElementById('cardapio-status').textContent = 'Sistema pronto';
  });
  
  const salvarItem = document.getElementById('salvar-item');
  if (salvarItem) salvarItem.addEventListener('click', () => {
    const nome = document.getElementById('item-nome').value.trim();
    const desc = document.getElementById('item-desc').value.trim();
    const preco = parseFloat(document.getElementById('item-preco').value) || 0;
    const tipo = document.getElementById('item-tipo').value;
    const id = document.getElementById('item-id').value.trim();
    const gatilhos = document.getElementById('item-gatilhos').value.trim();

    if (!nome) {
      showToast('❌ Nome do item é obrigatório', 'error');
      return;
    }

    if (preco <= 0) {
      showToast('❌ Preço deve ser maior que zero', 'error');
      return;
    }

    const item = {
      nome,
      descricao: desc,
      preco,
      tipo,
      id: id || null,
      gatilhos: gatilhos.split(',').map(g => g.trim()).filter(g => g)
    };

    // Salvar no localStorage
    let cardapio = JSON.parse(localStorage.getItem('cardapio') || '[]');
    cardapio.push(item);
    localStorage.setItem('cardapio', JSON.stringify(cardapio));

    // Adicionar mapeamentos dos gatilhos
    const itemId = id || nome.toLowerCase().replace(/\s+/g, '-');
    if (gatilhos) {
      const triggerList = gatilhos.split(',').map(g => g.trim().toLowerCase()).filter(g => g);
      triggerList.forEach(trigger => {
        if (!mapaCardapio[trigger]) {
          mapaCardapio[trigger] = itemId;
        }
      });
    }

    showToast(`✅ Item "${nome}" adicionado com sucesso!`, 'success');
    
    // Limpar campos
    document.getElementById('item-nome').value = '';
    document.getElementById('item-desc').value = '';
    document.getElementById('item-preco').value = '';
    document.getElementById('item-id').value = '';
    document.getElementById('item-gatilhos').value = '';
    
    // Fechar modal
    document.getElementById('adicionar-item-modal').style.display = 'none';
    document.getElementById('cardapio-status').textContent = 'Item adicionado com sucesso!';
    
    loadCardapioAndMappings();
  });
  
  // Submodal: Gerenciar Mapeamentos
  const mapeamentosClose = document.getElementById('mapeamentos-close');
  if (mapeamentosClose) mapeamentosClose.addEventListener('click', () => {
    document.getElementById('mapeamentos-modal').style.display = 'none';
    document.getElementById('cardapio-status').textContent = 'Sistema pronto';
  });
  
  const refreshMapeamentos = document.getElementById('refresh-mapeamentos');
  if (refreshMapeamentos) refreshMapeamentos.addEventListener('click', () => {
    loadMapeamentos();
    showToast('🔄 Mapeamentos atualizados', 'info');
  });
  
  const adicionarMapeamento = document.getElementById('adicionar-mapeamento');
  if (adicionarMapeamento) adicionarMapeamento.addEventListener('click', () => {
    const gatilho = document.getElementById('novo-gatilho').value.trim().toLowerCase();
    const itemId = document.getElementById('novo-item-id').value.trim();
    
    if (!gatilho || !itemId) {
      showToast('❌ Preencha gatilho e ID do item', 'error');
      return;
    }
    
    if (mapaCardapio[gatilho]) {
      showToast('⚠️ Gatilho já existe', 'warning');
      return;
    }
    
    mapaCardapio[gatilho] = itemId;
    showToast(`✅ Mapeamento adicionado: "${gatilho}" → ${itemId}`, 'success');
    
    // Limpar campos
    document.getElementById('novo-gatilho').value = '';
    document.getElementById('novo-item-id').value = '';
    
    loadMapeamentos();
  });
  
  // Submodal: Visualizar Cardápio
  const visualizarCardapioClose = document.getElementById('visualizar-cardapio-close');
  if (visualizarCardapioClose) visualizarCardapioClose.addEventListener('click', () => {
    document.getElementById('visualizar-cardapio-modal').style.display = 'none';
    document.getElementById('cardapio-status').textContent = 'Sistema pronto';
  });
  
  const refreshCardapio = document.getElementById('refresh-cardapio');
  if (refreshCardapio) refreshCardapio.addEventListener('click', () => {
    loadCardapioCompleto();
    showToast('🔄 Cardápio atualizado', 'info');
  });
  
  const filtroTipo = document.getElementById('filtro-tipo');
  if (filtroTipo) filtroTipo.addEventListener('change', () => {
    loadCardapioCompleto();
  });
  
  const buscarItem = document.getElementById('buscar-item');
  if (buscarItem) buscarItem.addEventListener('input', () => {
    loadCardapioCompleto();
  });
  // request mappings from server on load
  // prefer REST load, but also listen for socket broadcasts
  loadCardapioAndMappings().then(() => { try { renderCardapioMappings(); showToast('Mapeamentos carregados do servidor', 'success'); } catch(e){} });
  socket.emit('admin:getMappings');
  socket.once('admin:mappings', (r) => {
    if (!r || !r.ok) return;
    try { Object.assign(mapaCardapio, r.mappings || {}); renderCardapioMappings(); } catch(e){}
  });
  // listen for broadcast updates
  socket.on('admin:mappings', (r) => {
    if (!r || !r.ok) return;
    try { Object.assign(mapaCardapio, r.mappings || {}); renderCardapioMappings(); } catch(e){}
  });
});

function limparTexto(texto) {
  return String(texto).toLowerCase().replace(/[.,!?]/g, '').trim();
}

function addItemByName(id, contato) {
  const input = document.getElementById(`add-input-${contato}`);
  if (!input) return;
  const raw = input.value && input.value.trim();
  if (!raw) return showToast('Digite o nome do item.', 'error');
  let quantidade = 1;
  let nome = raw;
  let preparo = '';
  const match = raw.match(/^\s*(\d+)\s+(.+)$/);
  if (match) {
    quantidade = parseInt(match[1]);
    nome = match[2];
  }
  const prepMatch = raw.match(/\b(sem|com)\s+([a-zçãéíóúâêôãõ0-9\- ]+)\b/i);
  if (prepMatch) {
    preparo = prepMatch[0].trim();
    let nomeBase = raw.replace(prepMatch[0], '').trim();
    const matchQtd = nomeBase.match(/^\s*(\d+)\s+(.+)$/);
    if (matchQtd) {
      nomeBase = matchQtd[2];
    }
    nome = nomeBase;
  }
  const bebidaId = mapaBebidas[limparTexto(nome)];
  if (bebidaId) {
    console.log('emit admin:addItem (bebida)', { id, itemId: bebidaId, quantidade, nome, tipo: 'Bebida' });
    emitAction('admin:addItem', { id, itemId: bebidaId, quantidade, nome, tipo: 'Bebida', preparo }, `add-btn-${contato}`);
    input.value = '';
    return;
  }
  // check dynamic cardapio map as fallback
  const mapaId = mapaCardapio[limparTexto(nome)];
  if (mapaId) {
    console.log('emit admin:addItem (mapaCardapio)', { id, itemId: mapaId, quantidade, nome });
    emitAction('admin:addItem', { id, itemId: mapaId, quantidade, nome, preparo }, `add-btn-${contato}`);
    input.value = '';
    return;
  }
  console.log('emit admin:addItem', { id, itemName: nome, quantidade, preparo });
  emitAction('admin:addItem', { id, itemName: nome, quantidade, preparo }, `add-btn-${contato}`);
  input.value = '';
}

function removeItem(id, index) {
  emitAction('admin:removeItem', { id, index });
}

socket.on('initial', (payload) => {
  // Limpa carrinhos antigos e carrega os novos do payload
  for (const k of Object.keys(carrinhos)) delete carrinhos[k];
  const novos = payload.carrinhos || {};
  for (const k of Object.keys(novos)) carrinhos[k] = novos[k];
  renderAll();
  // ensure totals are loaded after initial data
  try { fetchTotaisDoDia(); } catch(e) { console.error('erro fetchTotaisDoDia after initial', e); }
  // update dashboard if open
  try { if (typeof updateDashboardIfOpen === 'function') updateDashboardIfOpen(); } catch (e) { console.error('erro atualizando dashboard after initial', e); }
});

socket.on('carrinho:update', (payload) => {
  try {
    if (!payload || !payload.id) return;
    const id = payload.id;
    // payload.carrinho pode conter o carrinho inteiro
    if (payload.carrinho) {
      // If the new estado signals 'saiu'/'entregue' (but not 'escolhendo_entrega_retirada'), move it to entregues (remove from main view)
      const estado = (payload.carrinho && payload.carrinho.estado) ? String(payload.carrinho.estado).toLowerCase() : '';
      if (estado.includes('saiu') || (estado.includes('entreg') && !estado.includes('escolhendo_entrega_retirada'))) {
        // Remove from main in-memory list
        try { delete carrinhos[id]; } catch(e) { carrinhos[id] = undefined; }
        // Refresh main UI
        renderAll();
        // Refresh entregues modal list and open it so operator sees it
        fetchEntregues().then(list => { renderEntreguesList(list); openEntreguesModal(); }).catch(e => console.error('Erro ao atualizar entregues (carrinho:update)', e));
        return; // don't continue with normal rendering for this id
      }
      carrinhos[id] = payload.carrinho;
    } else {
      // mesclar campos
      carrinhos[id] = Object.assign({}, carrinhos[id] || {}, payload);
    }
    renderAll();
    // Se o modal estiver aberto para esse id, atualiza o conteúdo em tempo real
    const modal = document.getElementById('conversation-modal');
    if (modal && modal.style.display === 'flex') {
      const currentTitle = document.getElementById('conv-title').textContent || '';
      if (currentTitle.includes(id.replace('@s.whatsapp.net',''))) {
        // re-render modal content
        try { showConversation(id); } catch(e) { console.error(e); }
      }
    }
  } catch (e) { console.error(e); }
});

socket.on('admin:ack', (r) => {
  if (!r) return;
  // O emitAction já cuida do toast aqui; este listener é legado, mas mantém para compat
  if (r.ok) {
    console.log('Ação admin concluída', r);
  } else {
    showToast('Erro na ação administrativa: ' + (r.error || 'unknown'), 'error');
  }
});

// Local cache para entregues (permite atualização imediata quando server emite pedido salvo)
let entreguesCache = [];

// Atualiza lista de entregues automaticamente quando servidor notifica que um pedido foi salvo
socket.on('pedido:salvo', (p) => {
  try {
  console.log('pedido:salvo recebido', p);
    // Se o servidor enviou o objeto do pedido, usamos ele para atualizar o cache local
    try {
      if (p && p.pedido) {
        const incoming = p.pedido;
        entreguesCache = entreguesCache || [];
        const incomingId = String(incoming.id || incoming.numero || '');
        const exists = entreguesCache.find(x => String(x.id || x.numero) === incomingId);
        if (!exists) {
          // only add to cache if estado indicates 'saiu'/'entreg' OR if it's not present (safety)
          const estado = (incoming.estado || '').toString().toLowerCase();
          if (estado.includes('saiu') || estado.includes('entreg')) {
            entreguesCache.unshift(incoming);
          } else {
            // if incoming doesn't have entrega state, still add but at the end (fallback)
            entreguesCache.push(incoming);
          }
        }
      }
    } catch (e) { console.error('pedido:salvo cache update error', e); }

    // Atualiza a UI: se modal aberto, renderiza; se não, abre o modal para destacar o pedido
    try {
      const modal = document.getElementById('entregues-modal');
      // Only auto-open when the saved pedido clearly signals 'saiu'/'entreg'
      const savedEstado = (p && p.pedido && (p.pedido.estado || '')).toString().toLowerCase();
      renderEntreguesList(entreguesCache);
      if ((savedEstado.includes('saiu') || savedEstado.includes('entreg')) && modal && modal.style.display !== 'flex') {
        openEntreguesModal();
      }
  // update header totals in real-time
  try { fetchTotaisDoDia(); } catch (e) { console.error('erro atualizando totais do dia', e); }
  // update dashboard if open
  try { if (typeof updateDashboardIfOpen === 'function') updateDashboardIfOpen(); } catch (e) { console.error('erro atualizando dashboard', e); }
    } catch (e) { console.error('pedido:salvo render error', e); }
  } catch (e) { console.error('pedido:salvo handler error', e); }
});

// Listener para mudanças de status do bot
socket.on('bot-status-update', (payload) => {
  try {
    const { restaurantId, status } = payload;
    const currentRestaurant = getRestaurantId();
    
    // Só atualizar se for o mesmo restaurante
    if (restaurantId === currentRestaurant) {
      console.log(`[BOT-STATUS] Status atualizado: ${status ? 'ATIVO' : 'INATIVO'}`);
      
      // Atualizar botão se a função existir (definida no HTML)
      if (typeof updateBotToggleButton === 'function') {
        updateBotToggleButton(status);
      }
      
      // Mostrar notificação suave
      showToast(`🤖 Bot ${status ? 'ativado' : 'desativado'}!`, status ? 'success' : 'warning');
    }
  } catch (e) {
    console.error('Erro ao processar mudança de status do bot:', e);
  }
});

// Funções para abrir/fechar modal de conversa
async function showConversation(id) {
  const modal = document.getElementById('conversation-modal');
  const title = document.getElementById('conv-title');
  const body = document.getElementById('conv-messages');
  const cartEl = document.getElementById('conv-cart');
  const valorEl = document.getElementById('conv-valor');
  const openWa = document.getElementById('conv-open-wa');

  // Try to fetch tenant-scoped carrinhos from the server so the modal shows the
  // full history for the current restaurant. Merge server messages into the
  // in-memory carrinhos cache (avoid duplications).
  try {
    const server = await api('/api/carrinhos');
    if (server && server.carrinhos) {
      const serverCarr = server.carrinhos || {};
      const serverData = serverCarr[id];
      if (serverData) {
        // Ensure local carrinhos entry exists
        if (!carrinhos[id]) carrinhos[id] = serverData;
        else {
          // Merge basic metadata if missing locally
          carrinhos[id].nome = carrinhos[id].nome || serverData.nome;
          carrinhos[id].endereco = carrinhos[id].endereco || serverData.endereco;
          carrinhos[id].estado = carrinhos[id].estado || serverData.estado;
          carrinhos[id].carrinho = carrinhos[id].carrinho || serverData.carrinho || serverData.itens;
          carrinhos[id].valorTotal = carrinhos[id].valorTotal || serverData.valorTotal || serverData.total;
          // Do NOT merge server-side `messages` into the local cache. This UI
          // should only render messages that were received via socket/initial
          // payload (local memory) to avoid showing messages from other
          // tenant contexts. Ensure there's at least an array to avoid errors.
          if (!Array.isArray(carrinhos[id].messages)) carrinhos[id].messages = [];
        }
      }
    }
  } catch (e) {
    // non-fatal: if fetch fails, we'll render using local in-memory data
    console.warn('Não foi possível carregar histórico de carrinhos do servidor:', e);
  }

  const data = carrinhos[id] || {};
  title.textContent = `${data.nome || 'Cliente'} — ${sanitizeId(id)}`;

  // Render message history from local in-memory `carrinhos` only. This avoids
  // cross-tenant history issues introduced when merging server-side data, but
  // still shows the conversation that the panel knows about (socket initial
  // payload / recent messages). If no messages are present, show an empty
  // state message.
  body.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.flexDirection = 'column';
  wrap.style.gap = '8px';

  const msgs = (data.messages && Array.isArray(data.messages)) ? data.messages.slice(-200) : (data.lastMsg ? [{ fromMe:false, text: data.lastMsg, timestamp: Date.now() }] : []);
  if (msgs.length === 0) {
    body.innerHTML = '<div class="small">Nenhuma mensagem disponível</div>';
  } else {
    for (const m of msgs) {
      const bubble = document.createElement('div');
      bubble.style.display = 'flex';
      bubble.style.flexDirection = 'column';
      bubble.style.alignItems = m.fromMe ? 'flex-end' : 'flex-start';

      const time = document.createElement('div');
      time.style.fontSize = '11px';
      time.style.color = '#999';
      time.style.marginBottom = '4px';
      time.textContent = new Date(m.timestamp || Date.now()).toLocaleString();

      const content = document.createElement('div');
      content.style.maxWidth = '86%';
      content.style.padding = '8px 10px';
      content.style.borderRadius = '12px';
      content.style.background = m.fromMe ? '#2a7' : '#222';
      content.style.color = m.fromMe ? '#042' : '#eee';
      content.innerHTML = (m.text || '').replace(/\n/g, '<br/>');

      bubble.appendChild(time);
      bubble.appendChild(content);
      wrap.appendChild(bubble);
    }
    body.appendChild(wrap);
    // autoscroll para o fim
    setTimeout(()=>{ body.scrollTop = body.scrollHeight; }, 10);
  }

  // Carrinho
  cartEl.innerHTML = '';
  const itens = (data.carrinho || []);
  if (itens.length === 0) cartEl.innerHTML = '<div class="small">Carrinho vazio</div>';
  else {
    // agrega itens por id+preparo para visual mais limpo, preservando todos índices
    const agg = {};
    for (let idx = 0; idx < itens.length; idx++) {
      const it = itens[idx];
      const key = `${it.id||''}::${(it.preparo||'').trim()}::${(it.nome||'').trim()}`;
      if (!agg[key]) {
        agg[key] = {
          ...it,
          quantidade: 0,
          indices: []
        };
      }
      agg[key].quantidade += Number(it.quantidade||1);
      agg[key].indices.push(idx);
    }
    // Renderiza cada ocorrência individualmente para manter referência correta de índice
    cartEl.innerHTML = Object.keys(agg).map(k => {
      const it = agg[k];
      return it.indices.map((originalIndex, i) => {
        // Para cada ocorrência, mostra 1x e permite ação individual
        const qtd = Number(itens[originalIndex].quantidade || 1);
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px dashed rgba(255,255,255,0.03)">
          <div><strong>${qtd}x</strong> ${it.nome} ${it.preparo ? `(${it.preparo})` : ''}</div>
          <div style="display:flex;gap:6px;align-items:center">
            <small class="muted">R$ ${Number(it.preco||0).toFixed(2)}</small>
            <button id="qty-minus-${originalIndex}" class="qty-btn" onclick="emitUpdateQty('${id}', ${originalIndex}, -1)">−</button>
            <button id="qty-plus-${originalIndex}" class="qty-btn" onclick="emitUpdateQty('${id}', ${originalIndex}, 1)">+</button>
            <button id="remove-btn-${originalIndex}" style="background:#a22;color:#fff;border:0;padding:6px;border-radius:6px" onclick="removeItem('${id}', ${originalIndex})">Remover</button>
          </div>
        </div>`;
      }).join('');
    }).join('');
  }
  // calcula valor total a partir dos itens caso data.valorTotal não esteja presente
  (function(){
    let total = 0;
    try {
  // conv-saiu removed from modal; main tab still has the 'Saiu' button
      const itensCalc = (data.carrinho || []);
      for (const it of itensCalc) {
        const preco = Number(it.preco || 0);
        const qtd = Number(it.quantidade || 1);
        total += preco * qtd;
      }
    } catch(e) { total = Number(data.valorTotal||0); }
    
    // Keep total as products-only (exclude delivery fee). Delivery is shown separately.
    let entregaVal = 0;
    try { if (data.entrega && typeof data.valorEntrega === 'number' && data.valorEntrega > 0) entregaVal = Number(data.valorEntrega); } catch(e) {}
    const produtoTotal = Math.max(0, Number(total) - Number(entregaVal || 0));
    valorEl.textContent = Number(produtoTotal || data.valorTotal || 0).toFixed(2);
    // set delivery fee display in modal
    try { document.getElementById('conv-taxa').textContent = (data.valorEntrega && Number(data.valorEntrega) ? Number(data.valorEntrega).toFixed(2) : '0.00'); } catch(e) {}
  })();

  openWa.onclick = () => { window.open(`https://wa.me/${id.replace('@s.whatsapp.net','')}`); };
  document.getElementById('conv-close').onclick = closeConversation;
  // prepara o input de envio para este chat
  const convInput = document.getElementById('conv-input');
  const convSend = document.getElementById('conv-send');
  if (convInput) convInput.value = '';
  if (convInput) convInput.dataset.targetId = id; // guarda id alvo
  if (convSend) convSend.onclick = () => {
    const text = (convInput && convInput.value) ? convInput.value.trim() : '';
    if (!text) return;
    emitAction('admin:sendMessage', { id, text, restaurantId: getRestaurantId() }, 'conv-send');
    if (convInput) convInput.value = '';
  };

  // Wire modal quick-action buttons
  const convReset = document.getElementById('conv-reset');
  const convClear = document.getElementById('conv-clear');
  const convAdd = document.getElementById('conv-add');
  const convAddInput = document.getElementById('conv-add-input');
  const convEditName = document.getElementById('conv-edit-name');

  if (convReset) convReset.onclick = () => {
    if (!confirm('Confirma resetar o carrinho deste cliente?')) return;
    emitAction('admin:reset', { id }, 'conv-reset');
  };
  if (convClear) convClear.onclick = () => {
    if (!confirm('Confirma limpar (reset) o carrinho deste cliente?')) return;
    emitAction('admin:reset', { id }, 'conv-clear');
  };
    if (convAdd) convAdd.onclick = () => {
    const raw = (convAddInput && convAddInput.value) ? convAddInput.value.trim() : '';
    if (!raw) return showToast('Digite o item a adicionar (ex: 1 dallas, sem bacon)', 'error');
    // tenta extrair quantidade e preparo como feito na função addItemByName
    let quantidade = 1;
    let nome = raw;
    let preparo = '';
    const match = raw.match(/^\s*(\d+)\s+(.+)$/);
    if (match) {
      quantidade = parseInt(match[1]);
      nome = match[2];
    }
    const prepMatch = raw.match(/\b(sem|com)\s+([a-zçãéíóúâêôãõ0-9\- ]+)\b/i);
    if (prepMatch) {
      preparo = prepMatch[0].trim();
      let nomeBase = raw.replace(prepMatch[0], '').trim();
      const matchQtd = nomeBase.match(/^\s*(\d+)\s+(.+)$/);
      if (matchQtd) nomeBase = matchQtd[2];
      nome = nomeBase;
    }
    // mapear bebidas conhecidas para itemId
    try {
      const bebidaId = mapaBebidas[limparTexto(nome)];
      if (bebidaId) {
        emitAction('admin:addItem', { id, itemId: bebidaId, quantidade, nome, tipo: 'Bebida' }, 'conv-add');
        if (convAddInput) convAddInput.value = '';
        return;
      }
    } catch (e) { /* ignore */ }
    emitAction('admin:addItem', { id, itemName: nome, quantidade, preparo }, 'conv-add');
    if (convAddInput) convAddInput.value = '';
  };
  if (convEditName) convEditName.onclick = () => {
    const idTarget = id;
    const current = (carrinhos[idTarget] && carrinhos[idTarget].nome) ? carrinhos[idTarget].nome : '';
    const novo = prompt('Novo nome do cliente:', current || '');
    if (novo === null) return;
    socket.emit('admin:updateName', { id: idTarget, nome: novo });
  };

  // botão finalizar dentro do modal
  const convFinalizar = document.getElementById('conv-finalizar');
  if (convFinalizar) convFinalizar.onclick = () => {
    if (!confirm('Confirma finalizar o pedido deste cliente?')) return;
    emitAction('admin:finalizarCarrinho', { id }, 'conv-finalizar');
  };

  // botão imprimir dentro do modal
  const convPrint = document.getElementById('conv-print');
  if (convPrint) convPrint.onclick = () => {
    if (!confirm('Deseja gerar e abrir o PDF deste pedido? (Só funciona se o pedido estiver totalmente finalizado)')) return;
    // Emite a ação que pede ao servidor para gerar/servir o PDF
    // O servidor responderá via 'admin:ack' com { ok:true, url: '/pedidos/<id>.pdf' }
    actionsInFlight.add('imprimir');
    setButtonLoading('conv-print', true);
    socket.emit('admin:imprimirPedido', { id });
    socket.once('admin:ack', (r) => {
      actionsInFlight.delete('imprimir');
      setButtonLoading('conv-print', false);
      if (r && r.ok && r.url) {
          // Show the PDF inside an in-page modal (iframe) so we don't open a new tab.
          try {
            const pdfOverlay = document.createElement('div');
            pdfOverlay.style.position = 'fixed';
            pdfOverlay.style.inset = '0';
            pdfOverlay.style.background = 'rgba(0,0,0,0.85)';
            pdfOverlay.style.display = 'flex';
            pdfOverlay.style.alignItems = 'center';
            pdfOverlay.style.justifyContent = 'center';
            pdfOverlay.style.zIndex = 99999;

            const pdfContainer = document.createElement('div');
            pdfContainer.style.width = '90%';
            pdfContainer.style.height = '90%';
            pdfContainer.style.background = '#fff';
            pdfContainer.style.borderRadius = '8px';
            pdfContainer.style.overflow = 'hidden';
            pdfContainer.style.position = 'relative';

            // Header bar so controls don't overlap the PDF viewer
            const header = document.createElement('div');
            header.style.height = '44px';
            header.style.display = 'flex';
            header.style.alignItems = 'center';
            header.style.justifyContent = 'space-between';
            header.style.padding = '6px 12px';
            header.style.background = '#2c2c2c';
            header.style.color = '#fff';
            header.style.boxSizing = 'border-box';

            const leftActions = document.createElement('div');
            leftActions.style.display = 'flex';
            leftActions.style.gap = '8px';

            const downloadLink = document.createElement('a');
            downloadLink.href = r.url;
            downloadLink.textContent = 'Download';
            downloadLink.style.color = '#fff';
            downloadLink.style.textDecoration = 'none';
            downloadLink.style.padding = '6px 10px';
            downloadLink.style.borderRadius = '4px';
            downloadLink.style.background = 'transparent';
            downloadLink.setAttribute('download', '');

            const printBtn = document.createElement('button');
            printBtn.textContent = 'Imprimir';
            printBtn.style.padding = '6px 10px';
            printBtn.style.borderRadius = '4px';
            printBtn.style.border = 'none';
            printBtn.style.cursor = 'pointer';
            printBtn.onclick = () => {
              try {
                // Try to print the iframe contents
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
              } catch (e) {
                showToast('Não foi possível iniciar impressão automática. Use Download ou o menu do navegador.', 'error');
              }
            };

            leftActions.appendChild(downloadLink);
            leftActions.appendChild(printBtn);

            const rightActions = document.createElement('div');
            const closeBtn = document.createElement('button');
            closeBtn.textContent = 'Fechar';
            closeBtn.style.padding = '6px 10px';
            closeBtn.style.borderRadius = '4px';
            closeBtn.style.border = 'none';
            closeBtn.style.cursor = 'pointer';
            closeBtn.onclick = () => { try { document.body.removeChild(pdfOverlay); } catch(e){} };
            rightActions.appendChild(closeBtn);

            header.appendChild(leftActions);
            header.appendChild(rightActions);

            const iframe = document.createElement('iframe');
            iframe.src = r.url;
            iframe.style.width = '100%';
            iframe.style.height = 'calc(100% - 44px)';
            iframe.style.border = '0';

            pdfContainer.appendChild(header);
            pdfContainer.appendChild(iframe);
            pdfOverlay.appendChild(pdfContainer);
            document.body.appendChild(pdfOverlay);

            showToast('PDF gerado. Visualize no modal e use o botão de Download/Imprimir do navegador.', 'success');
          } catch (e) {
            showToast('PDF gerado, mas não foi possível abrir a visualização. URL: ' + r.url, 'error');
          }
      } else {
        showToast('Não foi possível imprimir: ' + (r && r.error ? r.error : 'Pedido não finalizado'), 'error');
      }
    });
  };

  modal.style.display = 'flex';
  // Auto-print on open is intentionally disabled. Keep this block as a safe no-op
  // so that automatic printing cannot trigger even if the flag is toggled.
  try {
    if (AUTO_PRINT_ON_OPEN && data && data.estado && String(data.estado) === 'finalizado') {
      if (!autoPrintDone.has(id)) {
        autoPrintDone.add(id);
        // Automatic printing is disabled — require admin to click the Imprimir button.
        showToast('Impressão automática está desabilitada. Use o botão Imprimir no popup.', 'info');
      }
    }
  } catch (e) { console.error('auto-print error', e); }
}

function closeConversation() {
  document.getElementById('conversation-modal').style.display = 'none';
}

// --- Delivered orders modal logic ---
async function fetchEntregues() {
  try {
    const j = await api('/api/pedidos/entregues');
    if (!j || !j.ok) return entreguesCache || [];
    // If server returned empty but we have local cache from recent "pedido:salvo" events,
    // prefer the cache to avoid the race where DB GET happens before persistence finished.
    const serverList = j.pedidos || [];
    if ((!serverList || serverList.length === 0) && entreguesCache && entreguesCache.length > 0) {
      return entreguesCache;
    }
    // Atualiza o cache com os dados do servidor
    entreguesCache = serverList;
    return serverList;
  } catch (e) { console.error('fetchEntregues error', e); return []; }
}

function renderEntreguesList(items) {
  const container = document.getElementById('entregues-body');
  if (!container) return;
  container.innerHTML = '';
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="small">Nenhum pedido entregue encontrado para hoje.<br><small style="opacity:0.7;">Apenas pedidos registrados hoje são exibidos nesta lista.</small></div>';
    return;
  }
  for (const p of items) {
    const el = document.createElement('div');
    el.style.padding = '10px'; el.style.borderBottom = '1px solid rgba(255,255,255,0.03)'; el.style.display='flex'; el.style.justifyContent='space-between';
    const left = document.createElement('div');
    // Try to show known cliente info (name, endereco) by fetching /api/cliente/:numero when possible
    const clienteNumero = p.cliente || p.numero || '';
    let clienteHTML = '';
    try {
      // Fire-and-forget: fetch info but render placeholders first
  fetch(buildApiUrl(`/api/cliente/${encodeURIComponent(clienteNumero)}`)).then(res => res.json()).then(json => {
        try {
          const info = (json && json.cliente) ? json.cliente : null;
          const target = document.getElementById(`cliente-info-${p.id || clienteNumero}`);
          if (target) {
            target.innerHTML = info && info.nome ? `<strong>${info.nome}</strong> &mdash; ${clienteNumero}` : `${clienteNumero}`;
            const addrEl = document.getElementById(`cliente-endereco-${p.id || clienteNumero}`);
            if (addrEl) addrEl.textContent = info && info.endereco ? info.endereco : '';
          }
        } catch (e) { /* ignore */ }
      }).catch(()=>{});
    } catch(e) {}
    left.innerHTML = `<div style="font-weight:700" id="cliente-info-${p.id || clienteNumero}">Pedido ${p.id || p.numero || ''} — Cliente: ${clienteNumero}</div><div class="small" id="cliente-endereco-${p.id || clienteNumero}">Data: ${new Date(Number(p.ts||Date.now())).toLocaleString()} — Total: R$ ${Number(p.total||0).toFixed(2)}</div>`;
    const right = document.createElement('div');
  const openBtn = document.createElement('button');
  openBtn.className = 'icon-btn'; openBtn.textContent = 'Abrir';
  openBtn.onclick = () => { openPedidoDetail(p); };
    right.appendChild(openBtn);
    // Add conversation (wa.me) button
    if (clienteNumero) {
      const conv = document.createElement('button');
      conv.className = 'icon-btn'; conv.style.marginLeft = '8px'; conv.textContent = 'Conversa';
      conv.onclick = () => { window.open(`https://wa.me/${clienteNumero.replace(/[^0-9]/g,'')}`, '_blank'); };
      right.appendChild(conv);
    }
    el.appendChild(left); el.appendChild(right);
    container.appendChild(el);
  }
}

  function openPedidoDetail(pedido) {
    try {
      const modal = document.getElementById('pedido-detail-modal');
      const body = document.getElementById('pedido-detail-body');
      const title = document.getElementById('pedido-detail-title');
      if (!modal || !body || !title) return;
      const id = pedido.id || pedido.numero || (pedido.idpedido || '(unknown)');
      const cliente = pedido.cliente || pedido.numero || ''; 
      title.textContent = `Pedido ${id} — ${cliente}`;
      // If items absent, try to fetch full pedido by id from server
      const render = (pd) => {
        let html = '';
        html += `<p><strong>Cliente:</strong> ${pd.cliente || cliente}</p>`;
        html += `<p><strong>Data:</strong> ${new Date(Number(pd.ts || Date.now())).toLocaleString()}</p>`;
        html += `<p><strong>Total:</strong> R$ ${Number(pd.total || 0).toFixed(2)}</p>`;
        if (pd.endereco) html += `<p><strong>Endereço:</strong> ${pd.endereco}</p>`;
        const items = pd.items || pd.itens || pd.itemsPedido || [];
        if (Array.isArray(items) && items.length > 0) {
          html += `<div style="margin-top:12px"><strong>Itens:</strong><div style="margin-top:8px">`;
          html += items.map(it => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px dashed rgba(255,255,255,0.03)"><div>${(it.quantidade||it.qtd||1)}x ${it.nome || it.id || ''} ${it.preparo?`(${it.preparo})`:''}</div><div>R$ ${(Number(it.preco)||0).toFixed(2)}</div></div>`).join('');
          html += `</div></div>`;
        } else {
          html += `<div class="small">Nenhum item encontrado no registro do pedido.</div>`;
        }
        body.innerHTML = html;
        modal.style.display = 'flex';
      };

      const items = pedido.items || pedido.itens || pedido.itemsPedido || [];
      if (Array.isArray(items) && items.length > 0) {
        render(pedido);
      } else {
        // try fetch
  fetch(buildApiUrl(`/api/pedidos/${encodeURIComponent(id)}`)).then(r => r.json()).then(j => {
          if (j && j.ok && j.pedido) render(j.pedido);
          else render(pedido); // best-effort
        }).catch(e => { console.error('fetch pedido by id error', e); render(pedido); });
      }
    } catch (e) { console.error('openPedidoDetail error', e); }
  }

  function closePedidoDetail() { const m = document.getElementById('pedido-detail-modal'); if (m) m.style.display = 'none'; }

  document.addEventListener('DOMContentLoaded', () => {
    const close = document.getElementById('pedido-detail-close'); if (close) close.onclick = closePedidoDetail;
  });

function openEntreguesModal() {
  const modal = document.getElementById('entregues-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  // load list
  fetchEntregues().then(list => renderEntreguesList(list));
}

function closeEntreguesModal() { document.getElementById('entregues-modal').style.display = 'none'; }

document.addEventListener('DOMContentLoaded', () => {
  // wire header button
  try {
    const btn = document.getElementById('btn-entregues');
    if (btn) btn.onclick = openEntreguesModal;
    const closeBtn = document.getElementById('entregues-close'); if (closeBtn) closeBtn.onclick = closeEntreguesModal;
    const refreshBtn = document.getElementById('entregues-refresh'); if (refreshBtn) refreshBtn.onclick = () => { 
      // Limpa o cache para forçar busca no servidor
      entreguesCache = [];
      fetchEntregues().then(list => renderEntreguesList(list)); 
    };
  } catch (e) {}
});

// Totals widget: fetch and render totals for the day
async function fetchTotaisDoDia() {
  try {
  console.log('fetchTotaisDoDia -> solicitando /api/pedidos/totais-dia');
  const j = await api('/api/pedidos/totais-dia');
  console.log('fetchTotaisDoDia -> resposta', j);
  if (!j || !j.ok) return;
  try { document.getElementById('header-total-produtos').textContent = Number(j.totalProdutos || 0).toFixed(2); } catch(e){}
  try { document.getElementById('header-total-entregues').textContent = Number(j.totalEntregues || 0).toFixed(2); } catch(e){}
  } catch (e) { console.error('fetchTotaisDoDia error', e); }
}

// refresh totals on load and when relevant events occur
document.addEventListener('DOMContentLoaded', () => { fetchTotaisDoDia(); });

// Emite atualização de quantidade para o servidor
function emitUpdateQty(id, index, delta) {
  const btnId = delta > 0 ? `qty-plus-${index}` : `qty-minus-${index}`;
  emitAction('admin:updateQuantity', { id, index, delta }, btnId);
}

// Inicialização (chamado no final do HTML)
document.addEventListener('DOMContentLoaded', () => {
  renderAll(); // Render inicial se necessário
});
