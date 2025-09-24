const multiTenantService = require('./multiTenantService');
const { normalizarTexto } = require('../utils/normalizarTexto');

// Função para obter o banco do cardápio do cliente
function getClientDatabase(clienteId) {
    if (!clienteId) {
        throw new Error('Cliente ID é obrigatório para operações de cardápio');
    }
    return multiTenantService.getClientDatabase(clienteId, 'cardapio');
}

// Inicialização multi-tenant (compatibilidade)
async function init() {
    console.log('[cardapioService] Sistema multi-tenant inicializado');
    return Promise.resolve(true);
}

// Não precisa mais de persist com better-sqlite3
function persist() {
    // better-sqlite3 salva automaticamente
    return true;
}

function getItems(clienteId) {
  if (!clienteId) {
    throw new Error('Cliente ID é obrigatório para obter itens do cardápio');
  }
  
  try {
    const db = getClientDatabase(clienteId);
    const stmt = db.prepare('SELECT id, nome, descricao, preco, tipo FROM items ORDER BY tipo, nome');
    const rows = stmt.all();
    return rows;
  } catch (e) { 
    console.error('[cardapioService] getItems error', e); 
    return []; 
  }
}

function addItem(clienteId, { nome, descricao, preco, tipo, id }) {
  if (!clienteId) {
    throw new Error('Cliente ID é obrigatório para adicionar item ao cardápio');
  }
  
  try {
    const db = getClientDatabase(clienteId);
    const stmt = db.prepare('INSERT INTO items (nome, descricao, preco, tipo) VALUES (?, ?, ?, ?)');
    const result = stmt.run(String(nome||''), String(descricao||''), Number(preco||0), String(tipo||'Lanche'));
    return result.lastInsertRowid;
  } catch (e) { 
    console.error('[cardapioService] addItem error', e); 
    return null; 
  }
}

function removeItem(clienteId, itemId) {
  if (!clienteId) {
    throw new Error('Cliente ID é obrigatório para remover item do cardápio');
  }
  
  try {
    const db = getClientDatabase(clienteId);
    
    // Primeiro, remover todos os mapeamentos de gatilho para este item
    const mappingStmt = db.prepare('DELETE FROM mappings WHERE itemId = ?');
    mappingStmt.run(Number(itemId));
    
    // Depois, remover o item do cardápio
    const itemStmt = db.prepare('DELETE FROM items WHERE id = ?');
    itemStmt.run(Number(itemId));
    
    return true;
  } catch (e) { 
    console.error('[cardapioService] removeItem error', e); 
    return false; 
  }
}

function updateItem(clienteId, itemId, { nome, descricao, preco, tipo }) {
  if (!clienteId) {
    throw new Error('Cliente ID é obrigatório para atualizar item do cardápio');
  }
  
  try {
    const db = getClientDatabase(clienteId);
    const stmt = db.prepare('UPDATE items SET nome = ?, descricao = ?, preco = ?, tipo = ? WHERE id = ?');
    stmt.run(String(nome||''), String(descricao||''), Number(preco||0), String(tipo||'Lanche'), Number(itemId));
    return true;
  } catch (e) { 
    console.error('[cardapioService] updateItem error', e); 
    return false; 
  }
}

function getMappings(clienteId) {
  if (!clienteId) {
    throw new Error('Cliente ID é obrigatório para obter mapeamentos');
  }
  
  try {
    const db = getClientDatabase(clienteId);
    const stmt = db.prepare('SELECT nome, itemId FROM mappings');
    const rows = stmt.all();
    const out = {};
    for (const row of rows) {
      out[normalizarTexto(String(row.nome))] = Number(row.itemId);
    }
    return out;
  } catch (e) { 
    console.error('[cardapioService] getMappings error', e); 
    return {}; 
  }
}

// Retorna os mapeamentos como um array de objetos no formato { item_id, palavra_chave }
function getMappingsArray(clienteId) {
  if (!clienteId) {
    throw new Error('Cliente ID é obrigatório para obter mapeamentos');
  }

  try {
    const db = getClientDatabase(clienteId);
    // Pegar os mapeamentos no formato original (nome, itemId)
    const stmt = db.prepare('SELECT nome, itemId FROM mappings');
    const rows = stmt.all();
    const out = [];
    for (const row of rows) {
      out.push({
        item_id: Number(row.itemId),
        palavra_chave: String(row.nome)
      });
    }
    return out;
  } catch (e) {
    console.error('[cardapioService] getMappingsArray error', e);
    return [];
  }
}

function addMapping(clienteId, nome, itemId) {
  if (!clienteId) {
    throw new Error('Cliente ID é obrigatório para adicionar mapeamento');
  }
  
  try {
    const db = getClientDatabase(clienteId);
    const n = normalizarTexto(String(nome||''));
    const stmt = db.prepare('INSERT OR REPLACE INTO mappings (nome, itemId) VALUES (?, ?)');
    stmt.run(n, Number(itemId));
    return true;
  } catch (e) { 
    console.error('[cardapioService] addMapping error', e); 
    return false; 
  }
}

function addMultipleMappings(clienteId, gatilhos, itemId) {
  if (!clienteId) {
    throw new Error('Cliente ID é obrigatório para adicionar múltiplos mapeamentos');
  }
  
  if (!Array.isArray(gatilhos)) return false;
  
  try {
    const db = getClientDatabase(clienteId);
    const stmt = db.prepare('INSERT OR REPLACE INTO mappings (nome, itemId) VALUES (?, ?)');
    for (const gatilho of gatilhos) {
      const n = normalizarTexto(String(gatilho||''));
      if (n) {
        stmt.run(n, Number(itemId));
      }
    }
    return true;
  } catch (e) { 
    console.error('[cardapioService] addMultipleMappings error', e); 
    return false; 
  }
}

function getMappingsByItemId(clienteId, itemId) {
  if (!clienteId) {
    throw new Error('Cliente ID é obrigatório para obter mapeamentos por item');
  }
  
  try {
    const db = getClientDatabase(clienteId);
    const stmt = db.prepare('SELECT nome FROM mappings WHERE itemId = ?');
    const rows = stmt.all(Number(itemId));
    return rows.map(row => String(row.nome));
  } catch (e) { 
    console.error('[cardapioService] getMappingsByItemId error', e); 
    return []; 
  }
}

function removeMapping(clienteId, nome) {
  if (!clienteId) {
    throw new Error('Cliente ID é obrigatório para remover mapeamento');
  }
  
  try {
    const db = getClientDatabase(clienteId);
    const n = normalizarTexto(String(nome||''));
    const stmt = db.prepare('DELETE FROM mappings WHERE nome = ?');
    stmt.run(n);
    return true;
  } catch (e) { 
    console.error('[cardapioService] removeMapping error', e); 
    return false; 
  }
}

// Função para limpar todos os itens do cardápio
function clearAllItems(clienteId) {
  if (!clienteId) {
    throw new Error('Cliente ID é obrigatório para limpar cardápio');
  }
  
  try {
    const db = getClientDatabase(clienteId);
    const stmt = db.prepare('DELETE FROM items');
    const result = stmt.run();
    console.log(`[cardapioService] Removidos ${result.changes} itens do cardápio de ${clienteId}`);
    return result.changes;
  } catch (e) { 
    console.error('[cardapioService] clearAllItems error', e); 
    return 0; 
  }
}

// Função para limpar todos os mapeamentos
function clearAllMappings(clienteId) {
  if (!clienteId) {
    throw new Error('Cliente ID é obrigatório para limpar mapeamentos');
  }
  
  try {
    const db = getClientDatabase(clienteId);
  const stmt = db.prepare('DELETE FROM mappings');
    const result = stmt.run();
    console.log(`[cardapioService] Removidos ${result.changes} mapeamentos de ${clienteId}`);
    return result.changes;
  } catch (e) { 
    console.error('[cardapioService] clearAllMappings error', e); 
    return 0; 
  }
}

// Função para obter todos os itens (alias para getItems para compatibilidade)
function getAllItems(clienteId) {
  return getItems(clienteId);
}

module.exports = {
  init,
  getItems,
  getAllItems,
  addItem,
  removeItem,
  updateItem,
  getMappings,
  getMappingsArray,
  addMapping,
  addMultipleMappings,
  getMappingsByItemId,
  removeMapping,
  clearAllItems,
  clearAllMappings,
};
