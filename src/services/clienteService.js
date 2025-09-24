const multiTenantService = require('./multiTenantService');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Função para obter o banco do cliente atual
function getClientDatabase(clienteId) {
    if (!clienteId) {
        throw new Error('Cliente ID é obrigatório para operações de banco');
    }
    return multiTenantService.getClientDatabase(clienteId, 'main');
}

// Inicializa o banco multi-tenant (compatibilidade)
async function initDatabase() {
    console.log('[INFO] Sistema multi-tenant inicializado');
    // Não precisa mais de inicialização específica
    return Promise.resolve();
}

// Salva o banco (não necessário com better-sqlite3)
function saveDatabase() {
    // better-sqlite3 salva automaticamente
    return true;
}

const NOME_APP = "ROBO-BOT";

// Função para obter o caminho da pasta de dados do aplicativo de acordo com o SO
function getAppDataPath() {
    switch (process.platform) {
        case 'darwin':
            return path.join(os.homedir(), 'Library', 'Application Support', NOME_APP);
        case 'win32':
            return path.join(process.env.APPDATA, NOME_APP);
        case 'linux':
            return path.join(os.homedir(), '.config', NOME_APP);
        default:
            return path.join('.', NOME_APP);
    }
}

const pastaDadosApp = getAppDataPath();
// Cria a pasta de dados do aplicativo se ela não existir
if (!fs.existsSync(pastaDadosApp)) {
    fs.mkdirSync(pastaDadosApp, { recursive: true });
    console.log(`[INFO] Pasta criada para dados do aplicativo: ${pastaDadosApp}`);
}

// Retorna endereço salvo (formato async/await compatível)
function buscarEnderecoCliente(numero, clienteId = 'brutus-burger') {
    try {
        const clienteDB = multiTenantService.getClientDatabase(clienteId, 'main');
        if (!clienteDB) {
            console.error(`Banco de dados não encontrado para cliente ${clienteId}`);
            return Promise.resolve(null);
        }
        const stmt = clienteDB.prepare('SELECT endereco, latitude AS lat, longitude AS lng FROM clientes WHERE numero = ?');
        const result = stmt.get(numero);
        return Promise.resolve(result || null);
    } catch (err) {
        console.error('Erro ao buscar endereço do cliente:', err.message);
        return Promise.resolve(null);
    }
}


const caminhoBanco = path.join(pastaDadosApp, 'clientes.db');


// 👉 Cria a tabela 'clientes' se ela não existir, incluindo colunas para latitude e longitude
function createBanco(clienteId = 'brutus-burger') {
    try {
        const db = getClientDatabase(clienteId);
        
        db.exec(`CREATE TABLE IF NOT EXISTS clientes (
            numero TEXT PRIMARY KEY,
            nome TEXT,
            endereco TEXT,
            latitude REAL,
            longitude REAL,
            total_gasto REAL DEFAULT 0,
            historico TEXT DEFAULT '[]'
        )`);
        
        console.log(`[INFO] Tabela "clientes" verificada/criada com sucesso para cliente ${clienteId}.`);
        
        // Cria tabela de pedidos para histórico e cálculos futuros
        try {
            db.exec(`CREATE TABLE IF NOT EXISTS pedidos (
                id TEXT PRIMARY KEY,
                numero TEXT,
                ts INTEGER,
                total REAL,
                entrega INTEGER,
                endereco TEXT,
                estado TEXT,
                items TEXT,
                raw_json TEXT,
                valorEntrega REAL DEFAULT 0
            )`);
            console.log(`[INFO] Tabela "pedidos" verificada/criada com sucesso para cliente ${clienteId}.`);
        } catch (e) { 
            console.error(`Erro ao criar/verificar tabela pedidos para cliente ${clienteId}:`, e); 
        }
        
        saveDatabase();
    } catch (err) {
        console.error(`Erro ao criar a tabela clientes para cliente ${clienteId}:`, err.message);
    }
}

// Adiciona um pedido ao banco de dados (tabela pedidos) e atualiza histórico/total do cliente
function adicionarPedido(numero, pedido, clienteId) {
    try {
        if (!clienteId) {
            console.error('Cliente ID é obrigatório para adicionar pedido');
            return null;
        }
        
        const db = getClientDatabase(clienteId);
        const id = pedido.id || `${String(numero)}_${Date.now()}`;
        const total = Number(pedido.total || 0);
        const entrega = pedido.entrega ? 1 : 0;
        const endereco = pedido.endereco || null;
        const status = pedido.estado || pedido.status || 'pendente';
        const itemsStr = JSON.stringify(pedido.items || []);
        
        // Calcular valor de entrega
        let valorEntrega = 0;
        if (pedido.valorEntrega && typeof pedido.valorEntrega === 'number') {
            valorEntrega = Number(pedido.valorEntrega);
        } else if (entrega && pedido.items && pedido.total) {
            const items = Array.isArray(pedido.items) ? pedido.items : [];
            let totalItens = 0;
            for (const item of items) {
                totalItens += (Number(item.preco) || 0) * (Number(item.quantidade) || 1);
            }
            valorEntrega = total - totalItens;
            if (valorEntrega < 0) valorEntrega = 0;
        }

        // Inserir pedido usando schema do multiTenantService
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO pedidos 
            (cliente_numero, itens, total, status, endereco_entrega, observacoes, data_pedido) 
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
        `);
        
        const result = stmt.run(numero, itemsStr, total, status, endereco, JSON.stringify(pedido));
        const pedidoId = result.lastInsertRowid;
        
        console.log(`[INFO] Pedido salvo no banco: ${pedidoId} (cliente: ${numero}, total: ${total})`);
        return pedidoId;
    } catch (err) {
        console.error('Erro ao adicionar pedido:', err.message);
        return null;
    }
}

function obterPedidosPorCliente(numero, clienteId) {
    try {
        if (!clienteId) {
            console.error('Cliente ID é obrigatório para obter pedidos');
            return [];
        }
        
        const db = getClientDatabase(clienteId);
        const stmt = db.prepare('SELECT * FROM pedidos WHERE cliente_numero = ? ORDER BY data_pedido DESC');
        const results = stmt.all(numero);
        
        // Processar resultados para compatibilidade
        return results.map(row => {
            try {
                if (row.itens && typeof row.itens === 'string') {
                    row.items = JSON.parse(row.itens);
                }
                // Manter compatibilidade com campos antigos
                row.numero = row.cliente_numero;
                row.estado = row.status;
                row.ts = new Date(row.data_pedido).getTime();
            } catch(e) {
                console.error('Erro ao processar pedido:', e);
            }
            return row;
        });
    } catch (err) { 
        console.error('Erro ao obter pedidos por cliente:', err); 
        return []; 
    }
}

// Retorna pedidos filtrados por estado (string) ou todos se estado for null
function obterPedidosPorEstado(estado, clienteId) {
    try {
        if (!clienteId) {
            console.error('Cliente ID é obrigatório para obter pedidos');
            return [];
        }
        
        const db = getClientDatabase(clienteId);
        let query = 'SELECT * FROM pedidos';
        let params = [];
        
        if (estado && String(estado).trim().length > 0) {
            query += ' WHERE status = ?';
            params.push(String(estado));
        }
        query += ' ORDER BY data_pedido DESC';
        
        const stmt = db.prepare(query);
        const results = stmt.all(params);
        
        // Processar resultados para compatibilidade
        return results.map(row => {
            try {
                if (row.itens && typeof row.itens === 'string') {
                    row.items = JSON.parse(row.itens);
                }
            } catch(e) {
                console.error('Erro ao parsear itens:', e);
            }
            return row;
        });
    } catch (err) { 
        console.error('Erro ao obter pedidos por estado:', err); 
        return []; 
    }
}

// Atualiza o estado de um pedido específico
function atualizarEstadoPedido(pedidoId, novoEstado, clienteId) {
    try {
        if (!clienteId) {
            console.error('Cliente ID é obrigatório para atualizar pedido');
            return false;
        }
        
        const db = getClientDatabase(clienteId);
        console.log(`Atualizando pedido ${pedidoId} para estado: ${novoEstado}`);
        
        // Primeiro, verificar se o pedido existe
        const checkStmt = db.prepare('SELECT id FROM pedidos WHERE id = ?');
        const existing = checkStmt.get(pedidoId);
        
        if (!existing) {
            console.log(`❌ Nenhum pedido encontrado com ID: ${pedidoId}`);
            return false;
        }
        
        // Atualizar o estado do pedido
        const updateStmt = db.prepare('UPDATE pedidos SET status = ? WHERE id = ?');
        const result = updateStmt.run(novoEstado, pedidoId);
        
        if (result.changes > 0) {
            console.log(`✅ Pedido ${pedidoId} atualizado para estado: ${novoEstado}`);
            return true;
        } else {
            console.log(`❌ Nenhum pedido foi atualizado`);
            return false;
        }
        
    } catch (err) {
        console.error('Erro ao atualizar estado do pedido:', err);
        return false;
    }
}

// Reseta apenas os pedidos do dia atual
function resetarPedidosDia() {
    try {
        if (!db) {
            console.error('Banco de dados não inicializado');
            return false;
        }
        
        // Data de hoje
        const hoje = new Date();
        const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).getTime();
        const fimHoje = inicioHoje + (24 * 60 * 60 * 1000) - 1;
        
        console.log(`Removendo pedidos entre ${new Date(inicioHoje).toLocaleString()} e ${new Date(fimHoje).toLocaleString()}`);
        
        // Deletar pedidos do dia atual
        const stmt = db.prepare('DELETE FROM pedidos WHERE ts >= ? AND ts <= ?');
        stmt.run([inicioHoje, fimHoje]);
        stmt.free();
        
        console.log('✅ Pedidos do dia foram removidos.');
        
        // Salvar mudanças
        saveDatabase();
        console.log('✅ Banco de dados salvo.');
        
        return true;
        
    } catch (err) {
        console.error('Erro ao resetar pedidos do dia:', err);
        return false;
    }
}

// Reseta todos os pedidos do banco de dados
function resetarPedidos() {
    try {
        if (!db) {
            console.error('Banco de dados não inicializado');
            return false;
        }
        
        // Contar pedidos antes
        const pedidosAntes = obterPedidosPorEstado(null);
        console.log(`Pedidos encontrados antes do reset: ${pedidosAntes.length}`);
        
        // Deletar todos os pedidos
        db.run('DELETE FROM pedidos');
        console.log('✅ Todos os pedidos foram removidos da tabela.');
        
        // Salvar mudanças
        saveDatabase();
        console.log('✅ Banco de dados salvo.');
        
        // Verificar se foi resetado
        const pedidosDepois = obterPedidosPorEstado(null);
        console.log(`Pedidos encontrados após o reset: ${pedidosDepois.length}`);
        
        return pedidosDepois.length === 0;
    } catch (err) {
        console.error('Erro ao resetar pedidos:', err);
        return false;
    }
}

// Retorna um pedido específico pelo id (ou null se não encontrado)
function obterPedidoPorId(id) {
    try {
        if (!db) return null;
        const stmt = db.prepare('SELECT * FROM pedidos WHERE id = ?');
        const row = stmt.getAsObject([id]);
        stmt.free();
        if (row && Object.keys(row).length > 0) {
            // items e raw_json são strings, tentar parse
            try { if (row.items && typeof row.items === 'string') row.items = JSON.parse(row.items); } catch(e) { /* ignore */ }
            try { if (row.raw_json && typeof row.raw_json === 'string') row.raw_json = JSON.parse(row.raw_json); } catch(e) { /* ignore */ }
            return row;
        }
        return null;
    } catch (err) { console.error('Erro ao obter pedido por id:', err); return null; }
}

// Retorna um pedido pelo seu ID (string ID da tabela pedidos)
function obterPedidoPorId(id, clienteId = 'brutus-burger') {
    try {
        if (!clienteId) {
            console.error('Cliente ID é obrigatório para obter pedido por ID');
            return null;
        }
        const db = getClientDatabase(clienteId);
        if (!db) return null;
        
        // Usar prepared statement para evitar SQL injection e problemas de aspas
        const stmt = db.prepare('SELECT * FROM pedidos WHERE id = ? LIMIT 1');
        const row = stmt.get(String(id));
        
        if (row) {
            // row já é um objeto com as colunas
            const obj = { ...row };
            // try parsing items/raw_json
            try { if (obj.items && typeof obj.items === 'string') obj.items = JSON.parse(obj.items); } catch(e) { /* ignore */ }
            try { if (obj.raw_json && typeof obj.raw_json === 'string') obj.raw_json = JSON.parse(obj.raw_json); } catch(e) { /* ignore */ }
            return obj;
        }
        return null;
    } catch (err) { console.error('Erro ao obter pedido por id:', err); return null; }
}

// 👉 Atualiza o endereço, latitude e longitude de um cliente existente
function atualizarEnderecoCliente(numero, novoEndereco, lat = null, lng = null, clienteId = 'brutus-burger') {
    try {
        const clienteDB = multiTenantService.getClientDatabase(clienteId, 'main');
        if (!clienteDB) {
            console.error(`Banco de dados não encontrado para cliente ${clienteId}`);
            return;
        }
        const stmt = clienteDB.prepare('UPDATE clientes SET endereco = ?, latitude = ?, longitude = ? WHERE numero = ?');
        const result = stmt.run(novoEndereco, lat, lng, numero);
        
        if (result.changes > 0) {
            console.log(`Endereço e localização do cliente ${numero} atualizados para restaurante ${clienteId}.`);
        } else {
            console.log(`Nenhuma alteração feita para o cliente ${numero} no restaurante ${clienteId}. Verifique se o número existe.`);
        }
    } catch (err) {
        console.error('Erro ao atualizar endereço do cliente:', err.message);
    }
}

// 👉 Atualiza o nome de um cliente existente
function atualizarNomeCliente(numero, novoNome, clienteId = 'brutus-burger') {
    try {
        const clienteDB = multiTenantService.getClientDatabase(clienteId, 'main');
        if (!clienteDB) {
            console.error(`Banco de dados não encontrado para cliente ${clienteId}`);
            return;
        }
        const stmt = clienteDB.prepare('UPDATE clientes SET nome = ? WHERE numero = ?');
        const result = stmt.run(novoNome, numero);
        
        if (result.changes > 0) {
            console.log(`Nome do cliente ${numero} atualizado com sucesso para restaurante ${clienteId}.`);
        } else {
            console.log(`Nenhuma alteração de nome feita para o cliente ${numero} no restaurante ${clienteId}. Verifique se o número existe.`);
        }
    } catch (err) {
        console.error('Erro ao atualizar nome do cliente:', err.message);
    }
}

// 👉 Adiciona um novo cliente (ou substitui se já existir) com nome, endereço e coordenadas opcionais
function adicionarCliente(numero, nome, endereco = null, lat = null, lng = null, clienteId = 'brutus-burger') {
    try {
        const db = getClientDatabase(clienteId);
        
        if (!db) {
            console.error('Banco de dados não inicializado.');
            return;
        }
        
        const stmt = db.prepare("INSERT OR REPLACE INTO clientes (numero, nome, endereco, latitude, longitude, total_gasto, historico) VALUES (?, ?, ?, ?, ?, COALESCE((SELECT total_gasto FROM clientes WHERE numero = ?), 0), COALESCE((SELECT historico FROM clientes WHERE numero = ?), '[]'))");
        stmt.run(numero, nome, endereco, lat, lng, numero, numero);
        console.log(`Cliente ${numero} salvo/atualizado com sucesso no banco ${clienteId}.`);
        saveDatabase();
    } catch (err) {
        console.error('Erro ao adicionar/atualizar cliente:', err.message);
    }
}

// Adiciona um registro ao histórico JSON do cliente (adiciona objeto/linha)
function adicionarHistorico(numero, entrada, clienteId = 'brutus-burger') {
    try {
        const clienteDB = multiTenantService.getClientDatabase(clienteId, 'main');
        if (!clienteDB) { console.error(`Banco não inicializado para cliente ${clienteId}`); return; }
        
        const stmt = clienteDB.prepare('SELECT historico FROM clientes WHERE numero = ?');
        const row = stmt.get(numero);
        let hist = [];
        if (row && row.historico) {
            try { hist = JSON.parse(row.historico); } catch(e) { hist = []; }
        }
        hist.push({ ts: Date.now(), entry: entrada });
        const hstr = JSON.stringify(hist);
        // Se o cliente existe, atualiza; caso contrário, insere um novo registro mínimo
        try {
            const u = clienteDB.prepare('UPDATE clientes SET historico = ? WHERE numero = ?');
            const res = u.run(hstr, numero);
            if (!res || res.changes === 0) {
                const ins = clienteDB.prepare('INSERT OR REPLACE INTO clientes (numero, historico, total_gasto) VALUES (?, ?, 0)');
                ins.run(numero, hstr);
            }
            console.log(`Histórico adicionado para cliente ${numero} no restaurante ${clienteId}`);
        } catch (e) { console.error('Erro ao gravar historico:', e); }
    } catch (err) { console.error('Erro em adicionarHistorico:', err); }
}

// Adiciona um valor ao total gasto do cliente
function adicionarGasto(numero, valor, clienteId = 'brutus-burger') {
    try {
        const clienteDB = multiTenantService.getClientDatabase(clienteId, 'main');
        if (!clienteDB) { console.error(`Banco não inicializado para cliente ${clienteId}`); return; }
        
        const u = clienteDB.prepare('UPDATE clientes SET total_gasto = COALESCE(total_gasto,0) + ? WHERE numero = ?');
        const res = u.run(Number(valor)||0, numero);
        if (!res || res.changes === 0) {
            // cliente não existe ainda, insere
            const ins = clienteDB.prepare('INSERT OR REPLACE INTO clientes (numero, total_gasto, historico) VALUES (?, ?, "[]")');
            ins.run(numero, Number(valor)||0);
        }
        console.log(`Gasto adicionado para cliente ${numero} no restaurante ${clienteId}: R$ ${valor}`);
    } catch (err) { console.error('Erro ao adicionar gasto:', err); }
}

// Retorna o histórico (array) do cliente
function obterHistoricoCliente(numero, clienteId = 'brutus-burger') {
    try {
        const clienteDB = multiTenantService.getClientDatabase(clienteId, 'main');
        if (!clienteDB) return null;
        
        const stmt = clienteDB.prepare('SELECT historico FROM clientes WHERE numero = ?');
        const row = stmt.get(numero);
        if (row && row.historico) {
            try { return JSON.parse(row.historico); } catch (e) { return []; }
        }
        return [];
    } catch (err) { console.error('Erro ao obter historico:', err); return null; }
}

// Retorna total gasto do cliente
function obterTotalGasto(numero, clienteId = 'brutus-burger') {
    try {
        const clienteDB = multiTenantService.getClientDatabase(clienteId, 'main');
        if (!clienteDB) return 0;
        
        const stmt = clienteDB.prepare('SELECT total_gasto FROM clientes WHERE numero = ?');
        const row = stmt.get(numero);
        return row && row.total_gasto ? Number(row.total_gasto) : 0;
    } catch (err) { console.error('Erro ao obter total gasto:', err); return 0; }
}

// 👉 Busca informações de um cliente pelo número, com latitude/longitude convertidas
function obterInformacoesCliente(numero, callback, clienteId = 'brutus-burger') {
    try {
        const db = getClientDatabase(clienteId);
        
        if (!db) {
            console.error('Banco de dados não inicializado.');
            if (typeof callback === 'function') return callback(null, null);
            return null;
        }

        const stmt = db.prepare('SELECT * FROM clientes WHERE numero = ?');
        const result = stmt.get(numero);

        if (result && Object.keys(result).length > 0) {
            const info = {
                nome: result.nome,
                endereco: result.endereco,
                lat: result.latitude !== null ? parseFloat(result.latitude) : null,
                lng: result.longitude !== null ? parseFloat(result.longitude) : null
            };

            if (typeof callback === 'function') {
                return callback(null, info);
            }

            return info;
        } else {
            if (typeof callback === 'function') return callback(null, null);
            return null;
        }
    } catch (err) {
        console.error('Erro ao obter informações do cliente:', err);
        if (typeof callback === 'function') return callback(err, null);
        // rethrow so caller can catch if they expect synchronous behavior
        throw err;
    }
}


// 👉 Lista todos os clientes (para debug)
function printarClientes(clienteId = 'brutus-burger') {
    try {
        const clienteDB = multiTenantService.getClientDatabase(clienteId, 'main');
        if (!clienteDB) {
            console.error(`Banco de dados não inicializado para cliente ${clienteId}.`);
            return;
        }
        const stmt = clienteDB.prepare('SELECT * FROM clientes');
        const rows = stmt.all();
        
        if (rows.length === 0) {
            console.log(`[INFO] Nenhum cliente encontrado no banco de dados do restaurante ${clienteId}.`);
        } else {
            console.log(`[INFO] Lista de Clientes do restaurante ${clienteId}:`);
            console.table(rows);
        }
    } catch (err) {
        console.error('Erro ao listar clientes:', err);
    }
}

// Exporta as funções para serem usadas em outros módulos
module.exports = {
    atualizarEnderecoCliente,
    adicionarCliente,
    atualizarNomeCliente,
    obterInformacoesCliente,
    createBanco,
    printarClientes,
    buscarEnderecoCliente,
    caminhoBanco,
    initDatabase,
    adicionarHistorico,
    adicionarGasto,
    obterHistoricoCliente,
    obterTotalGasto
};
// Exports adicionais (adicionarPedido/obterPedidosPorCliente)
module.exports.adicionarPedido = adicionarPedido;
module.exports.obterPedidosPorCliente = obterPedidosPorCliente;
module.exports.obterPedidoPorId = obterPedidoPorId;
module.exports.obterPedidosPorEstado = obterPedidosPorEstado;
module.exports.resetarPedidos = resetarPedidos;
module.exports.resetarPedidosDia = resetarPedidosDia;
module.exports.atualizarEstadoPedido = atualizarEstadoPedido;

// Inicializa o banco de dados e exporta a Promise para que outros módulos possam aguardar
const dbInitPromise = initDatabase();
dbInitPromise.catch(err => {
    console.error('Erro ao inicializar banco de dados:', err);
});

// Exporta a promise para uso externo
module.exports.dbReady = dbInitPromise;
