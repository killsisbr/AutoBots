(() => {
  const socket = io();
  const el = id => document.getElementById(id);

  // Funções multi-tenant
  function getRestaurantId() {
    // 1. Verificar path: /restaurant/:id/
    const pathMatch = window.location.pathname.match(/^\/restaurant\/([^\/]+)/);
    if (pathMatch) return pathMatch[1];
    
    // 2. Verificar query parameter: ?restaurant_id=
    const urlParams = new URLSearchParams(window.location.search);
    const queryParam = urlParams.get('restaurant_id');
    if (queryParam) return queryParam;
    
    // 3. Verificar subdomain: restaurante.domain.com
    const hostname = window.location.hostname;
    const parts = hostname.split('.');
    if (parts.length > 2) return parts[0];
    
    // 4. Default
    return 'default';
  }

  function buildApiUrl(endpoint) {
    const restaurantId = getRestaurantId();
    const url = new URL(endpoint, window.location.origin);
    // set both keys for backward compatibility
    url.searchParams.set('restaurant_id', restaurantId);
    url.searchParams.set('restaurant', restaurantId);
    return url.toString();
  }

  // Small UX helper: show transient messages (success / error / info)
  function showMessage(msg, type = 'info') {
    let elMsg = document.getElementById('api-status-msg');
    if (!elMsg) {
      elMsg = document.createElement('div');
      elMsg.id = 'api-status-msg';
      elMsg.style.position = 'fixed';
      elMsg.style.right = '20px';
      elMsg.style.bottom = '20px';
      elMsg.style.padding = '10px 14px';
      elMsg.style.borderRadius = '6px';
      elMsg.style.zIndex = 9999;
      elMsg.style.boxShadow = '0 2px 8px rgba(0,0,0,0.2)';
      elMsg.style.fontFamily = 'sans-serif';
      elMsg.style.fontSize = '13px';
      document.body.appendChild(elMsg);
    }
    elMsg.textContent = msg;
    elMsg.style.background = type === 'error' ? '#e74c3c' : (type === 'success' ? '#2ecc71' : '#34495e');
    elMsg.style.color = '#fff';
    elMsg.style.display = 'block';
    if (elMsg._hideTimeout) clearTimeout(elMsg._hideTimeout);
    elMsg._hideTimeout = setTimeout(() => { elMsg.style.display = 'none'; }, 4000);
  }

  // Wrapper fetch that surfaces server error bodies when possible
  async function api(path, opts) {
    const res = await fetch(buildApiUrl(path), Object.assign({ headers: {'Content-Type':'application/json'} }, opts||{}));
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
    if (!res.ok) {
      const msg = data && data.error ? data.error : (typeof data === 'string' && data.length ? data : ('HTTP ' + res.status));
      const err = new Error(msg);
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return data;
  }

  async function loadItems() {
    try {
      const res = await api('/api/cardapio');
      const items = res.items || [];
      renderItems(items);
        // populate mapping itemId suggestions
        const mapInput = document.getElementById('map-itemid');
        if (mapInput) {
          // replace with datalist for quick selection
          let dl = document.getElementById('items-datalist');
          if (!dl) {
            dl = document.createElement('datalist'); dl.id = 'items-datalist'; document.body.appendChild(dl);
            mapInput.setAttribute('list', 'items-datalist');
          }
          dl.innerHTML = items.map(it => `<option value="${it.id}">${escapeHtml(it.nome)}</option>`).join('');
        }
    } catch (e) { el('items-list').innerText = 'Erro ao carregar items: ' + e.message; }
  }

  function renderItems(items) {
    if (!items || items.length === 0) { el('items-list').innerHTML = '<div class="small">Nenhum item cadastrado</div>'; return; }
    el('items-list').innerHTML = items.map(it => {
      return `<div class="item"><div><strong>${escapeHtml(it.nome)}</strong> <div class="small">#${it.id} • ${escapeHtml(it.tipo||'')}</div></div><div><button data-id="${it.id}" class="btn-red btn-remove">Remover</button></div></div>`;
    }).join('');
    Array.from(document.querySelectorAll('.btn-remove')).forEach(b => b.addEventListener('click', async (ev) => {
      try {
        const id = ev.currentTarget.getAttribute('data-id');
        if (!confirm('Remover item ' + id + ' ?')) return;
        const res = await api('/api/cardapio/' + encodeURIComponent(id), { method: 'DELETE' });
        // show clearer success message
        showMessage((res && res.ok) ? ('Item ' + id + ' removido com sucesso') : ('Item ' + id + ' removido'), 'success');
        loadItems();
      } catch (e) { console.error(e); showMessage('Falha ao remover: ' + (e.message || e), 'error'); }
    }));
  }

  function escapeHtml(s){ return String(s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":"&#39;"})[c]); }

  async function loadMappings() {
    try {
      const res = await api('/api/cardapio/mappings');
      renderMappings(res.mappings || {});
    } catch (e) { el('mappings-list').innerText = 'Erro ao carregar mappings: ' + e.message; }
  }

  function renderMappings(mappings) {
    const keys = Object.keys(mappings || {});
    if (keys.length === 0) { el('mappings-list').innerHTML = '<div class="small">Nenhum mapeamento</div>'; return; }
    el('mappings-list').innerHTML = keys.map(k => `<div class="item"><div><strong>${escapeHtml(k)}</strong> → <span class="small">${mappings[k]}</span></div><div><button data-nome="${escapeHtml(k)}" class="btn-red btn-remove-map">Remover</button></div></div>`).join('');
    Array.from(document.querySelectorAll('.btn-remove-map')).forEach(b => b.addEventListener('click', async (ev) => {
      try {
        const nome = ev.currentTarget.getAttribute('data-nome');
        if (!confirm('Remover mapping ' + nome + ' ?')) return;
        const res = await api('/api/cardapio/mappings/' + encodeURIComponent(nome), { method: 'DELETE' });
        showMessage((res && res.ok) ? ('Mapping "' + nome + '" removido') : ('Mapping "' + nome + '" removido'), 'success');
        loadMappings();
      } catch (e) { console.error(e); showMessage('Falha ao remover mapping: ' + (e.message || e), 'error'); }
    }));
  }

  // handlers
  el('btn-add-item').addEventListener('click', async () => {
    try {
      const nome = el('item-nome').value.trim();
      if (!nome) return alert('Nome obrigatório');
      const descricao = el('item-desc').value.trim();
      const preco = parseFloat(el('item-preco').value) || 0;
      const tipo = el('item-tipo').value || 'Lanche';
      await api('/api/cardapio', { method: 'POST', body: JSON.stringify({ nome, descricao, preco, tipo }) });
      el('item-nome').value=''; el('item-desc').value=''; el('item-preco').value='';
      loadItems();
    } catch (e) { alert('Erro ao adicionar item: ' + e.message); }
  });

  el('btn-add-mapping').addEventListener('click', async () => {
    try {
      const nome = el('map-nome').value.trim();
      const itemId = el('map-itemid').value.trim();
      if (!nome || !itemId) return alert('Nome e itemId obrigatórios');
      await api('/api/cardapio/mappings', { method: 'POST', body: JSON.stringify({ nome, itemId }) });
      el('map-nome').value=''; el('map-itemid').value='';
      loadMappings();
    } catch (e) { alert('Erro ao adicionar mapping: ' + e.message); }
  });

  // sockets: update mappings broadcast
  socket.on('admin:mappings', (msg) => {
    if (msg && msg.ok && msg.mappings) renderMappings(msg.mappings);
  });

  socket.on('connect', () => {
    loadItems(); loadMappings();
  });

  // initial page actions
  window.loadItems = loadItems;
  window.loadMappings = loadMappings;
})();
