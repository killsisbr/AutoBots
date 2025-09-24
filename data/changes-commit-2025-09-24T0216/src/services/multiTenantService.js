const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class MultiTenantService {
    constructor() {
        this.databases = new Map(); // Cache de conexões de banco por cliente
        // New organized layout: data/usuarios/<cliente>/*.sqlite
        this.dataDir = path.join(process.cwd(), 'data', 'usuarios');
        this.ensureDataDirectory();
    }

    ensureDataDirectory() {
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    // Obter conexão de banco específica do cliente
    getClientDatabase(clienteId, dbType = 'main') {
        const dbKey = `${clienteId}_${dbType}`;
        
        if (!this.databases.has(dbKey)) {
            // Ensure per-client directory exists
            const clientDir = path.join(this.dataDir, clienteId);
            if (!fs.existsSync(clientDir)) fs.mkdirSync(clientDir, { recursive: true });

            // New per-client file path: data/usuarios/<cliente>/<dbType>.sqlite
            const dbPath = path.join(clientDir, `${dbType}.sqlite`);

            // Backwards-compatibility: if old flat path exists (data/<cliente>_<dbType>.sqlite), migrate it
            try {
                const oldFlatPath = path.join(process.cwd(), 'data', `${clienteId}_${dbType}.sqlite`);
                if (!fs.existsSync(dbPath) && fs.existsSync(oldFlatPath)) {
                    try {
                        fs.renameSync(oldFlatPath, dbPath);
                        // Move also -shm and -wal files if present
                        ['-shm', '-wal'].forEach(sfx => {
                            const oldSide = oldFlatPath + sfx;
                            const newSide = dbPath + sfx;
                            if (fs.existsSync(oldSide) && !fs.existsSync(newSide)) {
                                try { fs.renameSync(oldSide, newSide); } catch (e) { /* best-effort */ }
                            }
                        });
                        console.log(`[MultiTenant] Migrated ${oldFlatPath} -> ${dbPath}`);
                    } catch (e) {
                        // Fall back to copy if rename fails
                        try {
                            fs.copyFileSync(oldFlatPath, dbPath);
                            console.log(`[MultiTenant] Copied ${oldFlatPath} -> ${dbPath}`);
                        } catch (copyErr) {
                            console.warn(`[MultiTenant] Could not migrate ${oldFlatPath}:`, copyErr && copyErr.message ? copyErr.message : copyErr);
                        }
                    }
                }
            } catch (e) {
                console.warn('[MultiTenant] Error during backwards-compat migration check:', e && e.message ? e.message : e);
            }

            const db = new Database(dbPath);
            
            // Configurações de performance
            db.pragma('journal_mode = WAL');
            db.pragma('synchronous = NORMAL');
            db.pragma('cache_size = 1000');
            db.pragma('temp_store = memory');
            
            // Inicializar tabelas baseado no tipo
            this.initializeTables(db, dbType);
            
            this.databases.set(dbKey, db);
        }
        
        return this.databases.get(dbKey);
    }

    // Inicializar tabelas baseado no tipo de banco
    initializeTables(db, dbType) {
        try {
            console.log(`[MultiTenant] Criando tabelas do tipo: ${dbType}`);
            switch (dbType) {
                case 'main':
                    console.log(`[MultiTenant] Criando tabelas principais...`);
                    this.createMainTables(db);
                    console.log(`[MultiTenant] Tabelas principais criadas com sucesso`);
                    break;
                case 'cardapio':
                    console.log(`[MultiTenant] Criando tabelas do cardápio...`);
                    this.createCardapioTables(db);
                    console.log(`[MultiTenant] Tabelas do cardápio criadas com sucesso`);
                    break;
                case 'mensagens':
                    console.log(`[MultiTenant] Criando tabelas de mensagens...`);
                    this.createMensagensTables(db);
                    console.log(`[MultiTenant] Tabelas de mensagens criadas com sucesso`);
                    break;
            }
        } catch (error) {
            console.error(`[MultiTenant] Erro ao criar tabelas do tipo ${dbType}:`, error);
            throw error;
        }
    }

    // Tabelas principais (clientes, pedidos, etc.)
    createMainTables(db) {
        try {
            // Tabela de clientes
            db.exec(`
                CREATE TABLE IF NOT EXISTS clientes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    numero TEXT UNIQUE NOT NULL,
                    nome TEXT,
                    endereco TEXT,
                    observacoes TEXT,
                    latitude REAL,
                    longitude REAL,
                    total_gasto REAL DEFAULT 0,
                    historico TEXT DEFAULT '[]',
                    data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                    data_atualizacao DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('[INFO] Tabela "clientes" verificada/criada com sucesso.');

            // Migração: garantir colunas compatíveis com clienteService
            try {
                const cols = db.prepare("PRAGMA table_info('clientes')").all();
                const existing = new Set(cols.map(c => c.name));
                const toAdd = [];
                if (!existing.has('latitude')) toAdd.push("latitude REAL");
                if (!existing.has('longitude')) toAdd.push("longitude REAL");
                if (!existing.has('total_gasto')) toAdd.push("total_gasto REAL DEFAULT 0");
                if (!existing.has('historico')) toAdd.push("historico TEXT DEFAULT '[]'");

                for (const colDef of toAdd) {
                    const colName = colDef.split(' ')[0];
                    try {
                        console.log(`[MultiTenant] Adicionando coluna '${colName}' na tabela clientes`);
                        db.exec(`ALTER TABLE clientes ADD COLUMN ${colDef}`);
                    } catch (e) {
                        console.warn(`[MultiTenant] Falha ao adicionar coluna ${colName}:`, e && e.message ? e.message : e);
                    }
                }
            } catch (e) {
                console.warn('[MultiTenant] Erro ao verificar/migrar colunas da tabela clientes:', e && e.message ? e.message : e);
            }

            // Tabela de pedidos
            db.exec(`
                CREATE TABLE IF NOT EXISTS pedidos (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    cliente_numero TEXT NOT NULL,
                    itens TEXT NOT NULL,
                    total REAL NOT NULL,
                    status TEXT DEFAULT 'pendente',
                    data_pedido DATETIME DEFAULT CURRENT_TIMESTAMP,
                    data_entrega DATETIME,
                    observacoes TEXT,
                    forma_pagamento TEXT,
                    troco REAL,
                    endereco_entrega TEXT,
                    FOREIGN KEY (cliente_numero) REFERENCES clientes(numero)
                )
            `);
            console.log('[INFO] Tabela "pedidos" verificada/criada com sucesso.');

            // Tabela de carrinho (estado temporário)
            db.exec(`
                CREATE TABLE IF NOT EXISTS carrinhos (
                    cliente_numero TEXT PRIMARY KEY,
                    itens TEXT,
                    status TEXT DEFAULT 'ativo',
                    data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                    data_atualizacao DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('[INFO] Tabela "carrinhos" verificada/criada com sucesso.');

            // Índices para performance
            db.exec(`
                CREATE INDEX IF NOT EXISTS idx_pedidos_cliente ON pedidos(cliente_numero);
                CREATE INDEX IF NOT EXISTS idx_pedidos_data ON pedidos(data_pedido);
                CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
            `);
            console.log('[INFO] Índices verificados/criados com sucesso.');
        } catch (error) {
            console.error('[ERROR] Erro ao criar tabelas principais:', error);
            throw error;
        }
    }

    // Tabelas do cardápio
    createCardapioTables(db) {
        // Tabela de itens do cardápio (compatível com cardapioService)
        db.exec(`
            CREATE TABLE IF NOT EXISTS items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL,
                descricao TEXT,
                preco REAL NOT NULL,
                tipo TEXT DEFAULT 'Lanche',
                data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                data_atualizacao DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Tabela de mapeamentos/gatilhos (compatível com cardapioService)
        db.exec(`
            CREATE TABLE IF NOT EXISTS mappings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                nome TEXT NOT NULL UNIQUE,
                itemId INTEGER NOT NULL,
                data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (itemId) REFERENCES items(id) ON DELETE CASCADE
            )
        `);

        // Índices para performance
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_items_tipo ON items(tipo);
            CREATE INDEX IF NOT EXISTS idx_items_nome ON items(nome);
            CREATE INDEX IF NOT EXISTS idx_mappings_nome ON mappings(nome);
            CREATE INDEX IF NOT EXISTS idx_mappings_itemId ON mappings(itemId);
        `);
    }

    // Tabelas de mensagens
    createMensagensTables(db) {
        // Criar tabela mensagens
        db.exec(`
            CREATE TABLE IF NOT EXISTS mensagens (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chave TEXT UNIQUE,
                titulo TEXT NOT NULL,
                conteudo TEXT NOT NULL,
                categoria TEXT,
                ativo BOOLEAN DEFAULT 1,
                data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                data_atualizacao DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Criar tabela gatilhos
        db.exec(`
            CREATE TABLE IF NOT EXISTS gatilhos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                palavra TEXT NOT NULL,
                mensagem_id INTEGER NOT NULL,
                categoria TEXT,
                ativo BOOLEAN DEFAULT 1,
                data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (mensagem_id) REFERENCES mensagens(id)
            )
        `);

        // Criar índices separadamente — tornar resiliente a esquemas antigos
        try {
            // Verificar colunas existentes nas tabelas
            const msgCols = new Set((db.prepare("PRAGMA table_info('mensagens')").all() || []).map(c => c.name));

            // Se 'chave' não existir (schema antigo), tentar adicioná-la — sem UNIQUE para compatibilidade
            if (!msgCols.has('chave')) {
                try {
                    db.exec(`ALTER TABLE mensagens ADD COLUMN chave TEXT`);
                    console.log("[MultiTenant] Adicionada coluna 'chave' na tabela mensagens (migração)");
                    msgCols.add('chave');
                } catch (e) {
                    console.warn('[MultiTenant] Não foi possível adicionar coluna chave na tabela mensagens:', e && e.message ? e.message : e);
                }
            }

            // Criar índices apenas se as colunas existirem
            if (msgCols.has('chave')) {
                try { db.exec(`CREATE INDEX IF NOT EXISTS idx_mensagens_chave ON mensagens(chave)`); } catch (e) { console.warn('[MultiTenant] Falha ao criar idx_mensagens_chave:', e && e.message ? e.message : e); }
            }
            if (msgCols.has('categoria')) {
                try { db.exec(`CREATE INDEX IF NOT EXISTS idx_mensagens_categoria ON mensagens(categoria)`); } catch (e) { console.warn('[MultiTenant] Falha ao criar idx_mensagens_categoria:', e && e.message ? e.message : e); }
            }
            if (msgCols.has('ativo')) {
                try { db.exec(`CREATE INDEX IF NOT EXISTS idx_mensagens_ativo ON mensagens(ativo)`); } catch (e) { console.warn('[MultiTenant] Falha ao criar idx_mensagens_ativo:', e && e.message ? e.message : e); }
            }

            // Gatilhos: verificar colunas antes de criar índices (algumas bases antigas têm estrutura diferente)
            const gatCols = new Set((db.prepare("PRAGMA table_info('gatilhos')").all() || []).map(c => c.name));

            // Garantir colunas esperadas pela camada de serviços (compatibilidade)
            const requiredGatCols = [
                { name: 'nome', def: 'TEXT' },
                { name: 'palavras_chave', def: 'TEXT' },
                { name: 'resposta', def: 'TEXT' },
                { name: 'tipo', def: "TEXT DEFAULT 'personalizado'" },
                { name: 'prioridade', def: 'INTEGER DEFAULT 1' },
                { name: 'updated_at', def: "DATETIME DEFAULT CURRENT_TIMESTAMP" }
            ];

            for (const col of requiredGatCols) {
                if (!gatCols.has(col.name)) {
                    try {
                        console.log(`[MultiTenant] Adicionando coluna '${col.name}' na tabela gatilhos`);
                        db.exec(`ALTER TABLE gatilhos ADD COLUMN ${col.name} ${col.def}`);
                        gatCols.add(col.name);
                    } catch (e) {
                        console.warn(`[MultiTenant] Falha ao adicionar coluna ${col.name} em gatilhos:`, e && e.message ? e.message : e);
                    }
                }
            }

            // Criar índices seguros para a nova estrutura
            if (gatCols.has('nome')) {
                try { db.exec(`CREATE INDEX IF NOT EXISTS idx_gatilhos_nome ON gatilhos(nome)`); } catch (e) { console.warn('[MultiTenant] Falha ao criar idx_gatilhos_nome:', e && e.message ? e.message : e); }
            }
            if (gatCols.has('palavras_chave')) {
                try { db.exec(`CREATE INDEX IF NOT EXISTS idx_gatilhos_palavras_chave ON gatilhos(palavras_chave)`); } catch (e) { console.warn('[MultiTenant] Falha ao criar idx_gatilhos_palavras_chave:', e && e.message ? e.message : e); }
            }
            if (gatCols.has('prioridade')) {
                try { db.exec(`CREATE INDEX IF NOT EXISTS idx_gatilhos_prioridade ON gatilhos(prioridade)`); } catch (e) { console.warn('[MultiTenant] Falha ao criar idx_gatilhos_prioridade:', e && e.message ? e.message : e); }
            }
            if (gatCols.has('ativo')) {
                try { db.exec(`CREATE INDEX IF NOT EXISTS idx_gatilhos_ativo ON gatilhos(ativo)`); } catch (e) { console.warn('[MultiTenant] Falha ao criar idx_gatilhos_ativo:', e && e.message ? e.message : e); }
            }
        } catch (e) {
            console.warn('[MultiTenant] Erro ao criar índices de mensagens/gatilhos:', e && e.message ? e.message : e);
        }
    }

    // Migrar dados existentes para um cliente específico
    async migrateExistingData(clienteId) {
        try {
            const oldDbPath = path.join(this.dataDir, 'mensagens.sqlite');
            const oldCardapioPath = path.join(this.dataDir, 'cardapio.sqlite');
            
            // Migrar mensagens se existir
            if (fs.existsSync(oldDbPath)) {
                const oldDb = new Database(oldDbPath);
                const newDb = this.getClientDatabase(clienteId, 'mensagens');
                
                try {
                    // Verificar se existe tabela mensagens no formato antigo
                    const mensagensExist = oldDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mensagens'").get();
                    
                    if (mensagensExist) {
                        // Copiar mensagens
                        const mensagens = oldDb.prepare('SELECT * FROM mensagens').all();
                        const insertMensagem = newDb.prepare(`
                            INSERT INTO mensagens (id, titulo, conteudo, categoria, ativo, data_criacao, data_atualizacao)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `);
                        
                        for (const msg of mensagens) {
                            insertMensagem.run(msg.id, msg.titulo, msg.conteudo, msg.categoria, msg.ativo, msg.data_criacao, msg.data_atualizacao);
                        }
                    }
                    
                    // Verificar estrutura da tabela gatilhos
                    const gatilhosTableInfo = oldDb.prepare("PRAGMA table_info(gatilhos)").all();
                    const hasOldStructure = gatilhosTableInfo.some(col => col.name === 'nome' || col.name === 'palavras_chave');
                    
                    if (hasOldStructure) {
                        console.log('Detectada estrutura antiga de gatilhos, pulando migração...');
                        // Estrutura antiga incompatível, não migrar gatilhos
                    } else {
                        // Estrutura nova compatível
                        const gatilhos = oldDb.prepare('SELECT * FROM gatilhos').all();
                        const insertGatilho = newDb.prepare(`
                            INSERT INTO gatilhos (id, palavra, mensagem_id, categoria, ativo, data_criacao)
                            VALUES (?, ?, ?, ?, ?, ?)
                        `);
                        
                        for (const gatilho of gatilhos) {
                            // Verificar se todos os campos necessários existem
                            if (gatilho.palavra && gatilho.mensagem_id) {
                                insertGatilho.run(gatilho.id, gatilho.palavra, gatilho.mensagem_id, gatilho.categoria, gatilho.ativo, gatilho.data_criacao);
                            }
                        }
                    }
                } catch (error) {
                    console.log('Erro na migração de gatilhos:', error.message);
                }
                
                oldDb.close();
            }
            
            // Migrar cardápio se existir
            if (fs.existsSync(oldCardapioPath)) {
                const oldDb = new Database(oldCardapioPath);
                const newDb = this.getClientDatabase(clienteId, 'cardapio');
                
                try {
                    // Tentar migrar da estrutura antiga (cardapio)
                    const itensAntigos = oldDb.prepare('SELECT * FROM cardapio').all();
                    const insertItem = newDb.prepare(`
                        INSERT INTO items (id, nome, descricao, preco, tipo, data_criacao, data_atualizacao)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                    `);
                    
                    for (const item of itensAntigos) {
                        const tipo = item.categoria || 'Lanche';
                        insertItem.run(item.id, item.nome, item.descricao, item.preco, tipo, item.data_criacao, item.data_atualizacao);
                    }
                    
                    // Migrar mapeamentos antigos
                    const mappingsAntigos = oldDb.prepare('SELECT * FROM cardapio_mappings').all();
                    const insertMapping = newDb.prepare(`
                        INSERT INTO mappings (nome, itemId, data_criacao)
                        VALUES (?, ?, ?)
                    `);
                    
                    for (const mapping of mappingsAntigos) {
                        insertMapping.run(mapping.nome_original, mapping.item_id, mapping.data_criacao);
                    }
                } catch (error) {
                    // Se não conseguir migrar da estrutura antiga, tentar da nova
                    try {
                        const itensNovos = oldDb.prepare('SELECT * FROM items').all();
                        const insertItem = newDb.prepare(`
                            INSERT INTO items (id, nome, descricao, preco, tipo, data_criacao, data_atualizacao)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        `);
                        
                        for (const item of itensNovos) {
                            insertItem.run(item.id, item.nome, item.descricao, item.preco, item.tipo, item.data_criacao, item.data_atualizacao);
                        }
                        
                        const mappingsNovos = oldDb.prepare('SELECT * FROM mappings').all();
                        const insertMapping = newDb.prepare(`
                            INSERT INTO mappings (nome, itemId, data_criacao)
                            VALUES (?, ?, ?)
                        `);
                        
                        for (const mapping of mappingsNovos) {
                            insertMapping.run(mapping.nome, mapping.itemId, mapping.data_criacao);
                        }
                    } catch (innerError) {
                        console.warn(`[MultiTenant] Não foi possível migrar cardápio para ${clienteId}:`, innerError.message);
                    }
                }
                
                oldDb.close();
            }
            
            console.log(`[MultiTenant] Dados migrados para cliente: ${clienteId}`);
        } catch (error) {
            console.error(`[MultiTenant] Erro ao migrar dados para ${clienteId}:`, error);
        }
    }

    // Fechar todas as conexões
    closeAll() {
        for (const [key, db] of this.databases) {
            try {
                db.close();
            } catch (error) {
                console.error(`Erro ao fechar banco ${key}:`, error);
            }
        }
        this.databases.clear();
    }

    // Obter estatísticas de uso por cliente
    getClientStats(clienteId) {
        try {
            const mainDb = this.getClientDatabase(clienteId, 'main');
            const cardapioDb = this.getClientDatabase(clienteId, 'cardapio');
            const mensagensDb = this.getClientDatabase(clienteId, 'mensagens');
            
            return {
                clientes: mainDb.prepare('SELECT COUNT(*) as count FROM clientes').get().count,
                pedidos: mainDb.prepare('SELECT COUNT(*) as count FROM pedidos').get().count,
                itensCardapio: cardapioDb.prepare('SELECT COUNT(*) as count FROM items').get().count,
                mensagens: mensagensDb.prepare('SELECT COUNT(*) as count FROM mensagens').get().count,
                gatilhos: mensagensDb.prepare('SELECT COUNT(*) as count FROM gatilhos').get().count
            };
        } catch (error) {
            console.error(`Erro ao obter estatísticas para ${clienteId}:`, error);
            return null;
        }
    }
}

module.exports = new MultiTenantService();