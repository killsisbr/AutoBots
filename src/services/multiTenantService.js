const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class MultiTenantService {
    constructor() {
        this.databases = new Map(); // Cache de conexões de banco por cliente
        this.dataDir = path.join(process.cwd(), 'data');
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
            const dbPath = path.join(this.dataDir, `${clienteId}_${dbType}.sqlite`);
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
                    data_criacao DATETIME DEFAULT CURRENT_TIMESTAMP,
                    data_atualizacao DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log('[INFO] Tabela "clientes" verificada/criada com sucesso.');

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

        // Criar índices separadamente
        db.exec(`CREATE INDEX IF NOT EXISTS idx_mensagens_chave ON mensagens(chave)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_mensagens_categoria ON mensagens(categoria)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_mensagens_ativo ON mensagens(ativo)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_gatilhos_palavra ON gatilhos(palavra)`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_gatilhos_ativo ON gatilhos(ativo)`);
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