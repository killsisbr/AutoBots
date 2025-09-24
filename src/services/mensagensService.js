const multiTenantService = require('./multiTenantService');

class MensagensService {
    constructor() {
        // Não precisa mais de db e dbPath únicos
    }

    // Função para obter o banco de mensagens do cliente
    getClientDatabase(clienteId) {
        if (!clienteId) {
            throw new Error('Cliente ID é obrigatório para operações de mensagens');
        }
        return multiTenantService.getClientDatabase(clienteId, 'mensagens');
    }

    async init() {
        try {
            console.log('[MENSAGENS] Sistema multi-tenant inicializado');
            return true;
        } catch (error) {
            console.error('[MENSAGENS] Erro ao inicializar:', error);
            return false;
        }
    }

    // Função para inicializar gatilhos padrão para um cliente específico
    async initializeDefaultTriggers(clienteId) {
        try {
            const db = this.getClientDatabase(clienteId);
            const existingCount = db.prepare('SELECT COUNT(*) as count FROM gatilhos').get().count;
            
            if (existingCount > 0) {
                console.log(`[MENSAGENS] Gatilhos já existem para cliente ${clienteId}`);
                return;
            }

            console.log(`[MENSAGENS] Inicializando gatilhos padrão para cliente ${clienteId}...`);
            this.addDefaultTriggers(clienteId);
        } catch (error) {
            console.error(`[MENSAGENS] Erro ao inicializar gatilhos para cliente ${clienteId}:`, error);
        }
    }

    formatTitle(chave) {
        const titles = {
            'msgAjuda': 'Mensagem de Ajuda',
            'msgApresentação': 'Mensagem de Apresentação',
            'msgAvisoEntrega': 'Aviso de Entrega',
            'msgEntregaeTaxas': 'Entrega e Taxas',
            'msgFormaDePagamento': 'Forma de Pagamento',
            'msgMenuGlobal': 'Menu Global',
            'msgObservação': 'Observações',
            'msgPedindoEndereço': 'Pedindo Endereço',
            'msgPedindoNome': 'Pedindo Nome',
            'msgPosPedido': 'Pós Pedido',
            'msgRecebido': 'Pedido Recebido',
            'msgTroco': 'Informações de Troco'
        };
        return titles[chave] || chave;
    }

    addDefaultTriggers(clienteId) {
        const defaultTriggers = [
            {
                nome: 'Saudação',
                palavras_chave: 'oi,olá,ola,bom dia,boa tarde,boa noite',
                resposta: 'Olá! Bem-vindo ao Brutus Burger! 🍔\n\nComo posso ajudá-lo hoje?',
                tipo: 'saudacao',
                prioridade: 1
            },
            {
                nome: 'Horário de Funcionamento',
                palavras_chave: 'horario,funcionamento,aberto,fechado,que horas',
                resposta: '🕐 *Horário de Funcionamento:*\n▪️ Segunda a Domingo: 18:00 às 23:30',
                tipo: 'informacao',
                prioridade: 2
            },
            {
                nome: 'Localização',
                palavras_chave: 'endereço,endereco,onde,localização,localizacao',
                resposta: '📍 *Nossa Localização:*\nInforme seu endereço que verificamos se entregamos na sua região!',
                tipo: 'informacao',
                prioridade: 2
            },
            {
                nome: 'Cardápio',
                palavras_chave: 'cardapio,menu,o que tem,produtos',
                resposta: '🍔 *Nosso Cardápio:*\nTemos deliciosos hambúrguers, bebidas e acompanhamentos!\n\nDigite o nome do produto que deseja ou navegue pelo nosso menu.',
                tipo: 'cardapio',
                prioridade: 2
            }
        ];

        for (const trigger of defaultTriggers) {
            try {
                this.addGatilho(clienteId, trigger);
            } catch (error) {
                // Ignorar se já existir
            }
        }
    }

    // CRUD Mensagens
    getAllMensagens(clienteId) {
        if (!clienteId) {
            throw new Error('Cliente ID é obrigatório para obter mensagens');
        }
        const db = this.getClientDatabase(clienteId);
        return db.prepare('SELECT * FROM mensagens ORDER BY titulo').all();
    }

    getMensagemByChave(clienteId, chave) {
        if (!clienteId) {
            throw new Error('Cliente ID é obrigatório para obter mensagem');
        }
        try {
            const db = this.getClientDatabase(clienteId);
            return db.prepare('SELECT * FROM mensagens WHERE chave = ?').get(chave);
        } catch (error) {
            console.log(`[MENSAGENS] Erro ao obter mensagem para cliente ${clienteId}, chave ${chave}:`, error);
            return null;
        }
    }

    addMensagem(clienteId, data) {
        if (!clienteId) {
            throw new Error('Cliente ID é obrigatório para adicionar mensagem');
        }
        const db = this.getClientDatabase(clienteId);
        const stmt = db.prepare(`
            INSERT INTO mensagens (chave, titulo, conteudo, categoria, ativo)
            VALUES (?, ?, ?, ?, ?)
        `);
        // Se ativo não for especificado ou for true, define como 1 (ativo)
        const ativo = data.ativo === false ? 0 : 1;
        return stmt.run(data.chave, data.titulo, data.conteudo, data.categoria || 'personalizado', ativo);
    }

    updateMensagem(clienteId, id, data) {
        if (!clienteId) {
            throw new Error('Cliente ID é obrigatório para atualizar mensagem');
        }
        const db = this.getClientDatabase(clienteId);
        const stmt = db.prepare(`
            UPDATE mensagens 
            SET titulo = ?, conteudo = ?, tipo = ?, ativo = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        // Se ativo não for especificado, mantém como ativo (1)
        // Se for especificado como false, define como inativo (0)
        const ativo = data.ativo === false ? 0 : 1;
        return stmt.run(data.titulo, data.conteudo, data.tipo, ativo, id);
    }

    deleteMensagem(clienteId, id) {
        if (!clienteId) {
            throw new Error('Cliente ID é obrigatório para deletar mensagem');
        }
        const db = this.getClientDatabase(clienteId);
        return db.prepare('DELETE FROM mensagens WHERE id = ?').run(id);
    }

    // CRUD Gatilhos
    getAllGatilhos(clienteId) {
        if (!clienteId) {
            throw new Error('Cliente ID é obrigatório para obter gatilhos');
        }
        const db = this.getClientDatabase(clienteId);
        return db.prepare('SELECT * FROM gatilhos ORDER BY prioridade, nome').all();
    }

    getGatilhosAtivos(clienteId) {
        if (!clienteId) {
            throw new Error('Cliente ID é obrigatório para obter gatilhos ativos');
        }
        const db = this.getClientDatabase(clienteId);
        return db.prepare('SELECT * FROM gatilhos WHERE ativo = 1 ORDER BY prioridade, nome').all();
    }

    addGatilho(clienteId, data) {
        if (!clienteId) {
            throw new Error('Cliente ID é obrigatório para adicionar gatilho');
        }
        const db = this.getClientDatabase(clienteId);
        const stmt = db.prepare(`
            INSERT INTO gatilhos (nome, palavras_chave, resposta, tipo, ativo, prioridade)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(
            data.nome, 
            data.palavras_chave, 
            data.resposta, 
            data.tipo || 'personalizado', 
            data.ativo !== false ? 1 : 0,
            data.prioridade || 1
        );
    }

    updateGatilho(clienteId, id, data) {
        if (!clienteId) {
            throw new Error('Cliente ID é obrigatório para atualizar gatilho');
        }
        const db = this.getClientDatabase(clienteId);
        const stmt = db.prepare(`
            UPDATE gatilhos 
            SET nome = ?, palavras_chave = ?, resposta = ?, tipo = ?, ativo = ?, prioridade = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);
        return stmt.run(data.nome, data.palavras_chave, data.resposta, data.tipo, data.ativo ? 1 : 0, data.prioridade, id);
    }

    deleteGatilho(clienteId, id) {
        if (!clienteId) {
            throw new Error('Cliente ID é obrigatório para deletar gatilho');
        }
        const db = this.getClientDatabase(clienteId);
        return db.prepare('DELETE FROM gatilhos WHERE id = ?').run(id);
    }

    // Buscar gatilho por mensagem
    findGatilhoForMessage(clienteId, message) {
        if (!clienteId) {
            throw new Error('Cliente ID é obrigatório para buscar gatilho');
        }
        
        try {
            const gatilhos = this.getGatilhosAtivos(clienteId);
            const messageNormalized = message.toLowerCase().trim();

            for (const gatilho of gatilhos) {
                const palavras = gatilho.palavras_chave.split(',').map(p => p.trim().toLowerCase());
                
                for (const palavra of palavras) {
                    if (messageNormalized.includes(palavra)) {
                        return gatilho;
                    }
                }
            }

            return null;
        } catch (error) {
            console.error(`[MENSAGENS] Erro ao buscar gatilho para cliente ${clienteId}:`, error);
            return null;
        }
    }

    // Não precisa mais de close com multi-tenant
    close() {
        // Conexões são gerenciadas pelo multiTenantService
        console.log('[MENSAGENS] Fechamento de conexões gerenciado pelo multiTenantService');
    }
}

module.exports = new MensagensService();