// Multi-tenant carrinhos: { restaurantId: { clienteId: carrinho } }
const carrinhosPorRestaurante = {};

// Multi-tenant bot status: { restaurantId: boolean }
const botStatusPorRestaurante = {};

// Função para obter carrinhos de um restaurante específico
function getCarrinhos(restaurantId = 'brutus-burger') {
    if (!carrinhosPorRestaurante[restaurantId]) {
        carrinhosPorRestaurante[restaurantId] = {};
    }
    return carrinhosPorRestaurante[restaurantId];
}

// Função para obter/definir status do bot
function getBotStatus(restaurantId = 'brutus-burger') {
    if (!(restaurantId in botStatusPorRestaurante)) {
        botStatusPorRestaurante[restaurantId] = true; // Padrão: ativo
    }
    return botStatusPorRestaurante[restaurantId];
}

function setBotStatus(restaurantId = 'brutus-burger', status = true) {
    botStatusPorRestaurante[restaurantId] = Boolean(status);
    console.log(`[BOT-STATUS] ${restaurantId}: ${status ? 'ATIVADO' : 'DESATIVADO'}`);
    
    // Emitir evento para notificar mudança de status
    try {
        events.emit('bot-status-changed', { 
            type: 'bot_status_change', 
            restaurantId, 
            status: Boolean(status),
            timestamp: Date.now()
        });
    } catch (e) {
        console.error('[BOT-STATUS] Erro ao emitir evento:', e);
    }
    
    return Boolean(status);
}

// Backward compatibility - mantém interface antiga
const carrinhos = new Proxy({}, {
    get: function(target, prop) {
        // Para compatibilidade, usa brutus-burger como padrão
        return getCarrinhos('brutus-burger')[prop];
    },
    set: function(target, prop, value) {
        // Para compatibilidade, usa brutus-burger como padrão
        getCarrinhos('brutus-burger')[prop] = value;
        return true;
    },
    has: function(target, prop) {
        return prop in getCarrinhos('brutus-burger');
    },
    ownKeys: function(target) {
        return Object.keys(getCarrinhos('brutus-burger'));
    },
    getOwnPropertyDescriptor: function(target, prop) {
        return Object.getOwnPropertyDescriptor(getCarrinhos('brutus-burger'), prop);
    }
});
const EventEmitter = require('events');
const events = new EventEmitter();
// Utility: normaliza IDs/contatos removendo sufixos como '@s.whatsapp.net', '@c.us' e '@broadcast'
function sanitizeId(rawId) {
    if (!rawId) return '';
    return String(rawId).replace(/@c\.us$|@s\.whatsapp\.net$|@broadcast$/gi, '');
}
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
            if (k && typeof k === 'string' && k.startsWith('_')) continue;
            const val = v[k];
            if (typeof val === 'function') continue;
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
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer'); // Biblioteca para gerar PDF
const pdfPrinter = require('pdf-to-printer'); // Biblioteca para imprimir PDF

const mensagens = require('../utils/mensagens'); // Caminho para o seu arquivo de mensagens
const { obterInformacoesCliente, atualizarEnderecoCliente, adicionarPedido } = require('./clienteService'); // Importa funções do serviço de cliente
const { obterPedidoPorId } = require('./clienteService');
const cardapio = require('../utils/cardapio'); // Cardápio sempre como array
const cardapioService = require('./cardapioService'); // Serviço de cardápio dinâmico

/**
 * Busca um item no cardápio dinâmico (SQLite) ou estático como fallback
 * @param {number} itemId - ID do item
 * @param {string} clienteId - ID do cliente
 * @returns {Object|null} - Item encontrado ou null
 */
async function buscarItemCardapio(itemId, clienteId = 'brutus-burger') {
    let itemCardapio = null;
    
    // Normalizar o ID para number para garantir comparação correta
    const normalizedId = typeof itemId === 'string' ? parseInt(itemId, 10) : itemId;
    
    // Primeiro tenta encontrar no cardapioService dinâmico (SQLite)
    try {
        await cardapioService.init();
        const itemsDinamicos = cardapioService.getItems(clienteId);
        itemCardapio = itemsDinamicos.find(i => i.id === normalizedId);
        if (itemCardapio) {
            console.log(`[CARDAPIO] Item ID ${itemId} (normalizado: ${normalizedId}) encontrado no cardápio dinâmico para ${clienteId}:`, itemCardapio);
            return itemCardapio;
        }
        
        // Se não encontrou no cardápio específico do cliente e o cliente não é brutus-burger,
        // tenta buscar no cardápio do brutus-burger como fallback
        if (clienteId !== 'brutus-burger') {
            console.log(`[CARDAPIO] Item não encontrado para ${clienteId}, tentando fallback para brutus-burger`);
            const itemsBrutus = cardapioService.getItems('brutus-burger');
            itemCardapio = itemsBrutus.find(i => i.id === normalizedId);
            if (itemCardapio) {
                console.log(`[CARDAPIO] Item ID ${itemId} (normalizado: ${normalizedId}) encontrado no cardápio brutus-burger (fallback):`, itemCardapio);
                return itemCardapio;
            }
        }
    } catch (e) {
        console.error('[CARDAPIO] Erro ao buscar no cardápio dinâmico:', e);
    }
    
    // Se não encontrou no SQLite, tenta no cardápio estático como fallback
    if (!Array.isArray(cardapio)) {
        console.error('Cardápio estático não está carregado como array.');
        return null;
    }
    
    itemCardapio = cardapio.find(i => i.id === normalizedId);
    if (itemCardapio) {
        console.log(`[CARDAPIO] Item ID ${itemId} (normalizado: ${normalizedId}) encontrado no cardápio estático:`, itemCardapio);
    }
    
    return itemCardapio;
}

const stats = { // Estados possíveis do carrinho para controle do fluxo do bot
    menuBebidas: 'menu-bebidas',
    menuUnidadeBebida: 'menu-quantidade-bebidas',
    menuConfirmandoPedido: 'confirmandoPedido',
    menuDescrição: 'definindo_preparo.',
    menuUnidade: 'definindo_unidade',
    menuPagamento: 'formar_de_pagamento',
    menuTroco: 'definindo_troco',
    menuEndereço: 'coletando_endereco',
    menuEntregaRetirada: 'escolhendo_entrega_retirada',
    menuResgate: 'resgate',
    menuAdicionais: 'adicionais',
    menuNome: 'coletando_nome',
    menuQuantidadeAdicionais: 'quantidade_adicionais',
    menuEmPreparo: 'pedindo_em_preparo',
    menuSuporte: 'suporte',
    menuInicial: 'menu-inicial',
    menuFinalizado: 'finalizado',
    saiuParaEntrega: 'saiu_para_entrega'
}

/**
 * Inicializa um novo carrinho para um cliente em um restaurante específico.
 * É importante que esta função seja chamada quando um cliente inicia uma nova sessão.
 * @param {string} clienteId ID único do cliente (ex: número de telefone).
 * @param {string} restaurantId ID do restaurante (padrão: 'brutus-burger').
 */
function inicializarCarrinho(clienteId, restaurantId = 'brutus-burger') {
    const sanitizedId = sanitizeId(clienteId);
    const carrinhos = getCarrinhos(restaurantId);
    if (!carrinhos[sanitizedId]) {
        carrinhos[sanitizedId] = {
            carrinho: [], // Array de itens do pedido
            estado: stats.menuInicial, // Estado atual da interação do bot com o cliente
            status: null, // Status do pedido (null, 'finalizado', etc.)
            valor: 0, // Valor temporário por item, não o total acumulado
            valorTotal: 0, // Valor total do pedido, incluindo entrega
            valorEntrega: 0, // Valor da taxa de entrega
            entrega: false, // Flag para indicar se é entrega (true) ou retirada (false)
            retirada: false, // Flag para indicar se é retirada
            endereco: null, // Endereço do cliente (texto)
            lat: null, // Latitude do endereço
            lng: null, // Longitude do endereço
            troco: undefined,
            alertAdicionado: true,
            observacao: undefined,
            formaDePagamento: undefined,
            observacaoConfirmada: undefined,
            aprt: true,
            idSelect: null, // Usado para seleção de itens/opções
            lastMsg: '' // Última mensagem do cliente
        };
        console.log(`[INFO] Carrinho inicializado para o cliente: ${sanitizedId} (original: ${clienteId}) no restaurante: ${restaurantId}`);
    // Emite evento para consumidores (ex: dashboard em tempo real)
    try { events.emit('update', { type: 'init', id: sanitizedId, carrinho: sanitizeCarrinho ? sanitizeCarrinho(carrinhos[sanitizedId]) : carrinhos[sanitizedId], restaurantId }); } catch (e) {}
    }
}

/**
 * Compatibilidade: wrapper que retorna o carrinho inicializado.
 * Alguns lugares do código chamam `initCarrinho` e esperam receber o objeto do carrinho.
 */
function initCarrinho(clienteId, restaurantId = 'brutus-burger') {
    const sanitizedId = sanitizeId(clienteId);
    inicializarCarrinho(sanitizedId, restaurantId);
    const carrinhos = getCarrinhos(restaurantId);
    return carrinhos[sanitizedId];
}

/**
 * Calcula o valor total do carrinho, incluindo itens e taxa de entrega.
 * O valor é arredondado para duas casas decimais.
 * @param {string} id ID do cliente.
 * @returns {number} Valor total do pedido.
 */
function valorTotal(id, restaurantId) {
    const sanitizedId = sanitizeId(id);
    const carrinhos = getCarrinhos(restaurantId);
    // Certifica-se de que o carrinho existe
    if (!carrinhos[sanitizedId]) {
        console.error(`Erro: Carrinho não encontrado para o ID ${sanitizedId} (original: ${id}) em valorTotal.`);
        return 0;
    }

    let totalItens = carrinhos[sanitizedId].carrinho.reduce((total, item) => {
        // Garante que preco e quantidade são números e calcula o subtotal
        const itemPreco = parseFloat(item.preco || 0);
        const itemQuantidade = parseInt(item.quantidade || 0);
        return total + (itemPreco * itemQuantidade);
    }, 0);

    let totalComEntrega = totalItens;

    // Adiciona a taxa de entrega se a entrega estiver ativa e o valor for um número válido
    if (carrinhos[sanitizedId].entrega && typeof carrinhos[sanitizedId].valorEntrega === 'number' && carrinhos[sanitizedId].valorEntrega > 0) {
        totalComEntrega += carrinhos[sanitizedId].valorEntrega;
    }

    // Armazena o valor total calculado no objeto do carrinho e o retorna formatado
    carrinhos[sanitizedId].valorTotal = parseFloat(totalComEntrega.toFixed(2));
    return carrinhos[sanitizedId].valorTotal;
}

/**
 * Adiciona um item ao carrinho do cliente.
 * @param {string} clienteId ID do cliente.
 * @param {number} itemId ID do item do cardápio.
 * @param {number} quantidade Quantidade do item.
 * @param {string} AnotarPreparo Anotações ou preparo especial para o item.
 * @param {string} tipagem Tipo do item (ex: 'Lanche', 'Bebida', 'Adicional').
 * @returns {object|null} O objeto do carrinho atualizado ou null em caso de erro.
 */
async function adicionarItemAoCarrinho(clienteId, itemId, quantidade, AnotarPreparo, tipagem, displayName, restaurantId = 'brutus-burger') {
    console.log(`🛒 [adicionarItemAoCarrinho] INÍCIO: Cliente ${clienteId}, ItemID ${itemId}, Qtd ${quantidade}`);
    console.log(`📝 [adicionarItemAoCarrinho] PARÂMETROS: preparo="${AnotarPreparo}", tipo="${tipagem}", display="${displayName}", restaurantId="${restaurantId}"`);
    
    const sanitizedId = sanitizeId(clienteId);
    inicializarCarrinho(sanitizedId); // Garante que o carrinho existe
    console.log(`✅ [adicionarItemAoCarrinho] CARRINHO: Inicializado para cliente ${sanitizedId} (original: ${clienteId})`);

    // Usar função centralizada de busca no cardápio
    console.log(`🔍 [adicionarItemAoCarrinho] BUSCA: Procurando item ${itemId} no cardápio do restaurante ${restaurantId}`);
    const itemCardapio = await buscarItemCardapio(itemId, restaurantId);

    if (itemCardapio) {
        console.log(`✅ [adicionarItemAoCarrinho] ITEM ENCONTRADO: ${itemCardapio.nome} (ID: ${itemCardapio.id}, Preço: R$ ${itemCardapio.preco})`);
        
        const itemParaAdicionar = {
            id: itemCardapio.id,
            nome: displayName && String(displayName).trim().length > 0 ? String(displayName).trim() : itemCardapio.nome,
            quantidade: parseInt(quantidade), // Garante que a quantidade é um número inteiro
            preparo: AnotarPreparo,
            descricao: itemCardapio.descricao,
            preco: parseFloat(itemCardapio.preco), // Garante que o preço é um número float
            tipo: tipagem,
        };
        
        console.log(`📦 [adicionarItemAoCarrinho] ITEM PREPARADO:`, itemParaAdicionar);
        
        carrinhos[sanitizedId].carrinho.push(itemParaAdicionar); // Adiciona o item ao array do carrinho
        console.log(`✅ [adicionarItemAoCarrinho] ITEM ADICIONADO: Carrinho agora tem ${carrinhos[sanitizedId].carrinho.length} itens`);
        
        // debug: mostrar o item que foi adicionado
        try {
            const added = carrinhos[sanitizedId].carrinho[carrinhos[sanitizedId].carrinho.length - 1];
            console.log('🛒 [adicionarItemAoCarrinho] CONFIRMAÇÃO: Item adicionado ->', { clienteId: sanitizedId, item: added });
        } catch (e) {}
        
        // Recalcula o valor total após adicionar o item
        console.log(`💰 [adicionarItemAoCarrinho] RECALCULANDO: Valor total do carrinho`);
        const novoTotal = valorTotal(sanitizedId, restaurantId);
        console.log(`💰 [adicionarItemAoCarrinho] TOTAL ATUALIZADO: R$ ${novoTotal}`);
        
        // Emite atualização para o dashboard após recalcular o total
        console.log(`📡 [adicionarItemAoCarrinho] EVENTO: Emitindo atualização para dashboard - restaurante: ${restaurantId}`);
        try { events.emit('update', { type: 'add', id: sanitizedId, carrinho: sanitizeCarrinho ? sanitizeCarrinho(carrinhos[sanitizedId]) : carrinhos[sanitizedId], restaurantId }); } catch(e) {}
        
        console.log(`✅ [adicionarItemAoCarrinho] SUCESSO: Item adicionado com sucesso ao carrinho`);
        return carrinhos[sanitizedId];
    } else {
        console.error(`❌ [adicionarItemAoCarrinho] ERRO: Item do cardápio com ID ${itemId} não encontrado.`);
        return null;
    }
}

/**
 * Atualiza o estado atual do carrinho do cliente em um restaurante específico.
 * @param {string} clienteId ID do cliente.
 * @param {string} novoEstado Novo estado a ser definido para o carrinho.
 * @param {string} restaurantId ID do restaurante (padrão: 'brutus-burger').
 */
function atualizarEstadoDoCarrinho(clienteId, novoEstado, restaurantId = 'brutus-burger') {
    console.log(`🔄 [atualizarEstadoDoCarrinho] INÍCIO: Cliente ${clienteId}, novo estado "${novoEstado}", restaurante: ${restaurantId}`);
    
    const sanitizedId = sanitizeId(clienteId);
    inicializarCarrinho(sanitizedId, restaurantId); // Garante que o carrinho existe
    console.log(`✅ [atualizarEstadoDoCarrinho] CARRINHO: Inicializado para cliente ${sanitizedId} (original: ${clienteId}) no restaurante: ${restaurantId}`);
    
    const carrinhos = getCarrinhos(restaurantId);
    const estadoAnterior = carrinhos[sanitizedId].estado;
    console.log(`📊 [atualizarEstadoDoCarrinho] TRANSIÇÃO: "${estadoAnterior}" → "${novoEstado}"`);
    
    carrinhos[sanitizedId].estado = novoEstado;
    console.log(`✅ [atualizarEstadoDoCarrinho] SUCESSO: Estado atualizado para ${sanitizedId}: ${novoEstado} no restaurante: ${restaurantId}`);
    
    console.log(`📡 [atualizarEstadoDoCarrinho] EVENTO: Emitindo mudança de estado para dashboard`);
    try { events.emit('update', { type: 'state_change', id: sanitizedId, estado: novoEstado, carrinho: sanitizeCarrinho ? sanitizeCarrinho(carrinhos[sanitizedId]) : carrinhos[sanitizedId], restaurantId }); } catch (e) {}
}

/**
 * Gera uma string formatada da visualização do carrinho para o cliente.
 * @param {string} id ID do cliente.
 * @returns {string} String formatada do carrinho.
 */
function carrinhoView(id, restaurantId) {
    const sanitizedId = sanitizeId(id);
    const carrinhos = getCarrinhos(restaurantId);
    if (!carrinhos[sanitizedId]) {
        return '*Seu carrinho está vazio.*';
    }

    const marmitas = carrinhos[sanitizedId].carrinho.filter(item => item.tipo === 'Lanche');
    const bebidas = carrinhos[sanitizedId].carrinho.filter(item => item.tipo === 'Bebida');
    const adicional = carrinhos[sanitizedId].carrinho.filter(item => item.tipo === 'Adicional');
    let msgCarrinhoAtual = '*SEU PEDIDO:* \n';

    if (marmitas.length > 0) {
        msgCarrinhoAtual += marmitas.map(item => `${item.quantidade}x ${item.nome} ${item.preparo ? `(${item.preparo})` : ''}`).join('\n');
        msgCarrinhoAtual += '\n';
    }

    if (bebidas.length > 0) {
        msgCarrinhoAtual += bebidas.map(item => `${item.quantidade}x ${item.nome} ${item.descricao || ''}`).join('\n');
        msgCarrinhoAtual += '\n';
    }
    if (adicional.length > 0) {
        msgCarrinhoAtual += adicional.map(item => `${item.quantidade}x ${item.nome} ${item.descricao}`).join('\n');
        msgCarrinhoAtual += '\n';
    }

    // 👉 Exibe a taxa de entrega se for um pedido de entrega e o valor for maior que zero
    if (carrinhos[sanitizedId].entrega && typeof carrinhos[sanitizedId].valorEntrega === 'number' && carrinhos[sanitizedId].valorEntrega > 0) {
        msgCarrinhoAtual += `\n_+Taxa de entrega: R$ ${carrinhos[sanitizedId].valorEntrega.toFixed(2)}_`;
        msgCarrinhoAtual += `\n`;
    }

    msgCarrinhoAtual += `────────────\nVALOR ATUAL: _*${valorTotal(id, restaurantId).toFixed(2)} R$*_ 💰\n`;
    return msgCarrinhoAtual;
}

/**
 * Reseta o carrinho de um cliente, limpando todos os itens e estados relacionados ao pedido.
 * @param {string} idAtual ID do cliente.
 * @param {object} carrinhoAtual Objeto do carrinho a ser resetado.
 */
function resetCarrinho(idAtual, carrinhoAtual, restaurantId) {
    const carrinhos = getCarrinhos(restaurantId);
    if (!carrinhos[idAtual]) {
        console.warn(`Tentativa de resetar carrinho inexistente para o cliente: ${idAtual}`);
        return;
    }
    carrinhos[idAtual].carrinho = [];
    carrinhos[idAtual].status = null; // Resetar status do pedido
    carrinhos[idAtual].troco = undefined;
    carrinhos[idAtual].alertAdicionado = true;
    carrinhos[idAtual].observacao = undefined;
    carrinhos[idAtual].formaDePagamento = undefined;
    carrinhos[idAtual].observacaoConfirmada = undefined;
    carrinhos[idAtual].entrega = false; // Resetar status de entrega
    carrinhos[idAtual].valorTotal = 0; // Resetar valor total
    carrinhos[idAtual].retirada = false; // Melhor usar false ou null
    carrinhos[idAtual].aprt = true;
    carrinhos[idAtual].idSelect = null; // Limpar idSelect
    // Não atualize o estado para menuInicial aqui, isso deve ser feito pelo fluxo principal
    console.log('Carrinho resetado\n ' + JSON.stringify(carrinhos[idAtual])); // Printa o carrinho resetado
    try { events.emit('update', { type: 'reset', id: idAtual, carrinho: sanitizeCarrinho ? sanitizeCarrinho(carrinhos[idAtual]) : carrinhos[idAtual], restaurantId }); } catch (e) {}
    // Garantir que o estado volte ao menu inicial após reset
    try { atualizarEstadoDoCarrinho(idAtual, stats.menuInicial, restaurantId); } catch (e) { console.error('Erro ao atualizar estado no resetCarrinho:', e); }
}

// Helper para emitir atualizações manuais
function _emitUpdate(type, id, restaurantId) {
    const carrinhos = getCarrinhos(restaurantId);
    try { events.emit('update', { type, id, carrinho: sanitizeCarrinho ? sanitizeCarrinho(carrinhos[id]) : carrinhos[id], restaurantId }); } catch (e) {}
}

/**
 * Retorna o objeto do carrinho para um cliente específico.
 * @param {string} idAtual ID do cliente.
 * @returns {object|null} Objeto do carrinho ou null se não existir.
 */
function getCarrinho(idAtual) {
    const sanitizedId = sanitizeId(idAtual);
    inicializarCarrinho(sanitizedId); // Garante que o carrinho seja inicializado se ainda não foi
    return carrinhos[sanitizedId];
}

/**
 * Remove um item do carrinho por índice ou por nome/id.
 * @param {string} idAtual
 * @param {object} opts - { index, nome, id }
 */
function removerItemDoCarrinho(idAtual, opts, restaurantId) {
    const sanitizedId = sanitizeId(idAtual);
    const carrinhos = getCarrinhos(restaurantId);
    console.log(`🗑️ [removerItemDoCarrinho] INÍCIO: Cliente ${sanitizedId} (original: ${idAtual}), opções:`, opts);
    
    if (!carrinhos[sanitizedId]) {
        console.log(`❌ [removerItemDoCarrinho] ERRO: Carrinho não encontrado para cliente ${sanitizedId}`);
        console.log(`🔍 [removerItemDoCarrinho] DEBUG: Carrinhos existentes:`, Object.keys(carrinhos));
        return false;
    }
    
    const carro = carrinhos[sanitizedId];
    console.log(`📊 [removerItemDoCarrinho] CARRINHO: ${carro.carrinho.length} itens antes da remoção`);
    
    if (typeof opts.index === 'number') {
        console.log(`🎯 [removerItemDoCarrinho] MÉTODO: Remoção por índice ${opts.index}`);
        if (opts.index < 0 || opts.index >= carro.carrinho.length) {
            console.log(`❌ [removerItemDoCarrinho] ERRO: Índice ${opts.index} inválido (0-${carro.carrinho.length - 1})`);
            return false;
        }
        
        const itemRemovido = carro.carrinho[opts.index];
        console.log(`📦 [removerItemDoCarrinho] ITEM A REMOVER:`, itemRemovido);
        
        carro.carrinho.splice(opts.index, 1);
        console.log(`✅ [removerItemDoCarrinho] REMOVIDO: Item removido por índice, ${carro.carrinho.length} itens restantes`);
        
        // Recalcula o valor total após remover o item
        const novoTotal = valorTotal(sanitizedId, restaurantId);
        console.log(`💰 [removerItemDoCarrinho] TOTAL ATUALIZADO: R$ ${novoTotal}`);
        
        try { events.emit('update', { type: 'remove', id: sanitizedId, carrinho: sanitizeCarrinho ? sanitizeCarrinho(carro) : carro, restaurantId }); } catch(e){}
        return true;
    }

    if (opts.nome) {
        console.log(`🎯 [removerItemDoCarrinho] MÉTODO: Remoção por nome "${opts.nome}"`);
        const idx = carro.carrinho.findIndex(i => (i.nome || '').toLowerCase() === opts.nome.toLowerCase());
        if (idx >= 0) {
            const itemRemovido = carro.carrinho[idx];
            console.log(`📦 [removerItemDoCarrinho] ITEM ENCONTRADO: ${itemRemovido.nome} no índice ${idx}`);
            
            carro.carrinho.splice(idx, 1);
            console.log(`✅ [removerItemDoCarrinho] REMOVIDO: Item removido por nome, ${carro.carrinho.length} itens restantes`);
            
            // Recalcula o valor total após remover o item
            const novoTotal = valorTotal(idAtual, restaurantId);
            console.log(`💰 [removerItemDoCarrinho] TOTAL ATUALIZADO: R$ ${novoTotal}`);
            
            try { events.emit('update', { type: 'remove', id: idAtual, carrinho: sanitizeCarrinho ? sanitizeCarrinho(carro) : carro, restaurantId }); } catch(e){}
            return true;
        }
        console.log(`❌ [removerItemDoCarrinho] ERRO: Item com nome "${opts.nome}" não encontrado`);
        return false;
    }

    if (opts.id) {
        console.log(`🎯 [removerItemDoCarrinho] MÉTODO: Remoção por ID "${opts.id}"`);
        const idx = carro.carrinho.findIndex(i => String(i.id) === String(opts.id));
        if (idx >= 0) {
            const itemRemovido = carro.carrinho[idx];
            console.log(`📦 [removerItemDoCarrinho] ITEM ENCONTRADO: ${itemRemovido.nome} (ID: ${itemRemovido.id}) no índice ${idx}`);
            
            carro.carrinho.splice(idx, 1);
            console.log(`✅ [removerItemDoCarrinho] REMOVIDO: Item removido por ID, ${carro.carrinho.length} itens restantes`);
            
            // Recalcula o valor total após remover o item
            const novoTotal = valorTotal(idAtual);
            console.log(`💰 [removerItemDoCarrinho] TOTAL ATUALIZADO: R$ ${novoTotal}`);
            
            try { events.emit('update', { type: 'remove', id: idAtual, carrinho: sanitizeCarrinho ? sanitizeCarrinho(carro) : carro, restaurantId }); } catch(e){}
            return true;
        }
        console.log(`❌ [removerItemDoCarrinho] ERRO: Item com ID "${opts.id}" não encontrado`);
        return false;
    }

    console.log(`❌ [removerItemDoCarrinho] ERRO: Nenhum método de remoção válido especificado`);
    return false;
}

/**
 * Altera a quantidade de um item no carrinho por índice.
 * Se a nova quantidade for <= 0, remove o item.
 * @param {string} idAtual
 * @param {number} index
 * @param {number} delta - incremento (positivo/negativo)
 */
function atualizarQuantidadeDoItem(idAtual, index, delta, restaurantId) {
    const sanitizedId = sanitizeId(idAtual);
    const carrinhos = getCarrinhos(restaurantId);
    if (!carrinhos[sanitizedId]) return false;
    const carro = carrinhos[sanitizedId];
    if (typeof index !== 'number' || index < 0 || index >= carro.carrinho.length) return false;
    const item = carro.carrinho[index];
    const atual = Number(item.quantidade || 0);
    const novo = atual + Number(delta || 0);
    if (isNaN(novo)) return false;
    if (novo <= 0) {
        carro.carrinho.splice(index, 1);
        // Recalcula o valor total após remover o item
        valorTotal(sanitizedId);
    try { events.emit('update', { type: 'remove', id: sanitizedId, carrinho: sanitizeCarrinho ? sanitizeCarrinho(carro) : carro, restaurantId }); } catch (e) {}
        return true;
    }
    item.quantidade = parseInt(novo);
    // Recalcula o valor total após alterar a quantidade
    valorTotal(sanitizedId);
    try { events.emit('update', { type: 'quantity_change', id: sanitizedId, carrinho: sanitizeCarrinho ? sanitizeCarrinho(carro) : carro, restaurantId }); } catch (e) {}
    return true;
}

/**
 * Gera uma string formatada do pedido para o administrador/motoboy.
 * @param {string} id ID do cliente.
 * @returns {string} String formatada do pedido.
 */
function imprimirPedido(id, restaurantId = 'brutus-burger') {
    // Build a pedido record from the in-memory cart and delegate to
    // imprimirPedidoFromRecord so we have a single rendering path.
    try {
        const carrinhosLocal = getCarrinhos(restaurantId);
        const resolvedId = resolveCartId(id, restaurantId) || id;
        const cliente = carrinhosLocal[resolvedId];
        if (!cliente) return '*Pedido não encontrado para o ID do cliente.*';

        const pedidoRecord = {
            id: resolvedId,
            ts: Date.now(),
            total: valorTotal(resolvedId, restaurantId),
            entrega: !!cliente.entrega,
            endereco: cliente.endereco || null,
            estado: cliente.estado || null,
            items: Array.isArray(cliente.carrinho) ? cliente.carrinho : [],
            raw: {
                nome: cliente.nome || null,
                endereco: cliente.endereco || null,
                valorTotal: valorTotal(resolvedId, restaurantId),
                carrinho: Array.isArray(cliente.carrinho) ? cliente.carrinho.map(i => ({ id: i.id, nome: i.nome, quantidade: i.quantidade, preparo: i.preparo, preco: i.preco })) : []
            }
        };
        return imprimirPedidoFromRecord(pedidoRecord);
    } catch (e) {
        console.error('Erro em imprimirPedido:', e && e.message ? e.message : e);
        return '*Erro ao renderizar o pedido.*';
    }
}

// Gera HTML formatado a partir de um registro de pedido (usado quando o PDF foi removido e queremos servir HTML similar)
function imprimirPedidoFromRecord(pedidoRecord) {
    try {
        const clienteNome = (pedidoRecord.raw && pedidoRecord.raw.nome) || pedidoRecord.numero || 'Não informado';
        const id = pedidoRecord.id || pedidoRecord.numero || 'pedido';
        const ts = pedidoRecord.ts || Date.now();
        const items = pedidoRecord.items || [];
        const total = Number(pedidoRecord.total || 0);
        const endereco = pedidoRecord.endereco || '';
        const entrega = !!pedidoRecord.entrega;
        // calcula subtotal de itens
        const subtotal = items.reduce((s, it) => s + (Number(it.preco || 0) * Number(it.quantidade || 1)), 0);
        const taxaEntrega = Math.max(0, Number((total - subtotal).toFixed(2)));
        const formaPagamento = (pedidoRecord.raw && pedidoRecord.raw.formaDePagamento) || (pedidoRecord.raw && pedidoRecord.raw.formaDePagamento) || (pedidoRecord.raw && pedidoRecord.raw.formaDePagamento) || 'Não informado';
        const observacao = (pedidoRecord.raw && pedidoRecord.raw.observacao) || '';

        let html = `<!doctype html><html><head><meta charset="utf-8"><title>Pedido ${id}</title><style>
            /* Thermal receipt optimized for 80mm printers (Epson TM-T20) */
            @page{size:80mm auto;margin:3mm}
            body{font-family:Arial,Helvetica,sans-serif;font-size:22px;margin:0;padding:4px;color:#000;line-height:1.3}
            .receipt{width:74mm;margin:0 auto}
            h1{font-size:26px;text-align:center;margin:4px 0 6px;padding-bottom:4px;font-weight:bold}
            .section-title{font-weight:700;margin-top:6px;border-bottom:1px dashed #000;padding-bottom:4px;font-size:20px}
            ul{list-style:none;padding-left:0;margin:6px 0;font-size:20px}
            li{margin-bottom:4px;line-height:1.4}
            .total{font-weight:900;margin-top:8px;font-size:24px}
            .sep{border-top:1px dashed #000;margin:8px 0}
            .muted{color:#444;font-size:16px}
            p{font-size:20px;line-height:1.3;margin:4px 0}
            strong{font-weight:bold}
        </style></head><body>`;
    html += `<div class="receipt">`;
    html += `<div style="text-align:right;font-size:12px;color:#666">${new Date(Number(ts)).toLocaleString()}</div>`;
    html += `<h1>PEDIDO RECEBIDO</h1><div class="sep"></div>`;
    html += `<p><strong>Cliente:</strong> ${clienteNome}</p>`;
    html += `<p><strong>Contato:</strong> ${String(pedidoRecord.numero||id)}</p>`;
    html += `<p><strong>Data/Hora:</strong> ${new Date(Number(ts)).toLocaleString('pt-BR')}</p>`;
        html += `<div class="section-title">ITENS DO PEDIDO</div><ul>`;
        if (!items || items.length === 0) html += `<li>Nenhum item no carrinho.</li>`;
        else items.forEach(it => {
            const preparo = it.preparo ? ` (${it.preparo})` : '';
            html += `<li>${(it.quantidade||1)}x ${it.nome||it.id}${preparo} - R$ ${(Number(it.preco)||0).toFixed(2)}</li>`;
        });
        html += `</ul>`;
        if (entrega) {
            html += `<div class="section-title">DETALHES DA ENTREGA</div>`;
            html += `<p><strong>Endereço:</strong> ${endereco || 'Não especificado'}</p>`;
            if (taxaEntrega > 0) html += `<p><strong>Taxa de Entrega:</strong> R$ ${taxaEntrega.toFixed(2)}</p>`;
            else html += `<p><strong>Taxa de Entrega:</strong> R$ 0.00</p>`;
        }
        html += `<div class="section-title">PAGAMENTO</div>`;
        html += `<p><strong>Forma:</strong> ${formaPagamento}</p>`;
        if (observacao && String(observacao).trim().length > 0) {
            html += `<div class="section-title">OBSERVAÇÃO</div><p>${observacao}</p>`;
        }
    html += `<div class="sep"></div><p class="total">VALOR TOTAL: R$${total.toFixed(2)}</p>`;
    if (endereco) html += `<div style="margin-top:6px;color:#666">${endereco}</div>`;
    html += `</div>`; // .receipt
    html += `</body></html>`;
        return html;
    } catch (e) { console.error('Erro em imprimirPedidoFromRecord:', e); return '<html><body>Erro ao renderizar pedido</body></html>'; }
}

async function salvarPedido(idAtual, estado, clienteId = 'brutus-burger', forcePrint = false, formaDePagamentoFallback = null) {
    // MODIFICADO: Altera o caminho para ser relativo ao diretório de trabalho atual (writable)
    const ordersDir = path.join(process.cwd(), 'Pedidos');
    const filePath = path.join(ordersDir, `${idAtual}.pdf`);

    // Cria o diretório se não existir
    if (!fs.existsSync(ordersDir)) {
        try {
            fs.mkdirSync(ordersDir, { recursive: true });
            console.log(`Diretório de pedidos criado em: ${ordersDir}`);
        } catch (mkdirError) {
            console.error(`Erro ao criar diretório de pedidos: ${mkdirError.message}`);
            // Se o erro ainda ocorrer, pode ser um problema de permissão ou ambiente
            // Nestes casos, talvez seja necessário configurar a pasta de saída manualmente
            // ou usar um caminho temporário do sistema operacional (os.tmpdir()).
        }
    }

    // Resolve o ID do carrinho com variantes possíveis para garantir que encontramos
    // o carrinho em memória: tenta raw id, id + '@c.us' e a versão sanitizada.
    let resolvedId = resolveCartId(idAtual, clienteId) || idAtual;
    try {
        if (!resolvedId) {
            const withSuffix = String(idAtual) + '@c.us';
            resolvedId = resolveCartId(withSuffix, clienteId) || withSuffix;
        }
    } catch (e) { /* ignore */ }
    try { resolvedId = resolveCartId(String(idAtual)) || resolvedId; } catch(e){}

        // Gera conteúdo HTML do pedido. Se imprimirPedido não encontrar o pedido
        // (retornando a mensagem de 'Pedido não encontrado'), tenta construir o
        // HTML a partir do carrinho em memória usando imprimirPedidoFromRecord.
        // Quando forcePrint === true, forçamos a geração a partir do carrinho em memória
        // para garantir que o PDF represente o pedido atual, não um arquivo antigo.
        let htmlContent = '';
        if (!forcePrint) {
            try { htmlContent = imprimirPedido(resolvedId, clienteId) || ''; } catch(e) { htmlContent = ''; }
        }
        if (!htmlContent || String(htmlContent).toLowerCase().includes('pedido não encontrado')) {
        try {
            const carrinhosLocal = getCarrinhos(clienteId);
            const carrinho = carrinhosLocal[resolvedId] || carrinhosLocal[String(idAtual)] || carrinhosLocal[String(idAtual) + '@c.us'] || null;
            const pedidoRecord = {
                id: resolvedId || idAtual,
                ts: Date.now(),
                total: carrinho ? valorTotal(resolvedId || idAtual, clienteId) : 0,
                entrega: carrinho ? (carrinho.entrega ? 1 : 0) : 0,
                endereco: carrinho ? (carrinho.endereco || null) : null,
                estado: estado || null,
                items: carrinho && Array.isArray(carrinho.carrinho) ? carrinho.carrinho : [],
                raw: carrinho ? {
                    nome: carrinho.nome || null,
                    endereco: carrinho.endereco || null,
                    formaDePagamento: carrinho ? (carrinho.formaDePagamento || null) : null,
                    valorTotal: carrinho ? valorTotal(resolvedId || idAtual, clienteId) : 0,
                    carrinho: carrinho && Array.isArray(carrinho.carrinho) ? carrinho.carrinho.map(i => ({ id: i.id, nome: i.nome, quantidade: i.quantidade, preparo: i.preparo, preco: i.preco })) : []
                } : {}
            };
            // usar imprimirPedidoFromRecord para montar um HTML razoável
            htmlContent = imprimirPedidoFromRecord(pedidoRecord) + `<p>${estado}</p>`;
            console.log('[salvarPedido] Fallback: gerado HTML a partir do carrinho em memória para', resolvedId || idAtual);
        } catch (e) {
            console.error('[salvarPedido] erro ao construir fallback HTML do pedido:', e && e.message ? e.message : e);
            htmlContent = imprimirPedido(idAtual, clienteId) + `<p>${estado}</p>`; // último recurso
        }
    } else {
        htmlContent += `<p>${estado}</p>`; // Adiciona estado ao HTML quando imprimirPedido teve sucesso
    }

    // Tenta localizar um Chrome/Chromium instalado localmente para passar o executablePath
    const chromeCandidates = [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        'C:/Program Files/Chromium/chrome.exe'
    ];
    let chromeExecutablePath = process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || null;
    if (!chromeExecutablePath) {
        for (const p of chromeCandidates) {
            try { if (fs.existsSync(p)) { chromeExecutablePath = p; break; } } catch (e) {}
        }
    }

    // Tenta iniciar o Puppeteer com o caminho explícito quando disponível; caso falhe, grava fallback em HTML
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox'],
            executablePath: chromeExecutablePath || undefined
        });

        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

        try {
            await page.pdf({
                    path: filePath,
                    // Use a narrow width suitable for thermal receipt printers (80mm)
                    width: '80mm',
                    printBackground: true,
                    preferCSSPageSize: true,
                    margin: {
                        top: '3mm',
                        right: '3mm',
                        bottom: '3mm',
                        left: '3mm'
                    }
                });
            console.log('PDF gerado com Puppeteer:', filePath);
        } catch (pdfError) {
            console.error(`Erro ao gerar PDF para ${idAtual}: ${pdfError.message}`);
        }
    } catch (launchError) {
        console.error('Falha ao iniciar o Puppeteer/Chrome:', launchError && launchError.message ? launchError.message : launchError);
        // Fallback: grava o HTML em vez do PDF para não bloquear o fluxo
        try {
            const fallbackPath = filePath.replace(/\.pdf$/i, '.html');
            fs.writeFileSync(fallbackPath, htmlContent, 'utf8');
            console.log(`Fallback: HTML salvo em ${fallbackPath}. Instale o Chrome ou rode 'npx puppeteer install chrome' para habilitar geração de PDF.`);
        } catch (writeErr) {
            console.error('Falha ao gravar fallback HTML:', writeErr);
        }
    } finally {
        try { if (browser) await browser.close(); } catch (e) {}
    }

    // Automatic printing is disabled. We intentionally skip any attempts to
    // send the PDF to a local printer from the server process. Files are kept
    // for manual printing from the admin UI (Conversa -> Imprimir).
    let printSuccess = false;
    console.log('[salvarPedido] Impressão automática desabilitada; arquivos mantidos em:', filePath);

    // Persistir o pedido no banco de dados para histórico e cálculos futuros
    try {
        const carrinhosLocal = getCarrinhos(clienteId);
        const resolvedId = resolveCartId(idAtual, clienteId) || idAtual;
        const cliente = carrinhosLocal[resolvedId] || {};
        // Sanitize raw object to avoid circular references (timeouts, internals, etc.)
        const rawSanitized = {
            nome: cliente.nome || null,
            endereco: cliente.endereco || null,
            lat: cliente.lat || null,
            lng: cliente.lng || null,
            entrega: !!cliente.entrega,
            valorEntrega: (typeof cliente.valorEntrega === 'number') ? cliente.valorEntrega : null,
            // Prefer explicit cliente.formaDePagamento; fallback to value passed by caller when available
            formaDePagamento: (typeof cliente.formaDePagamento !== 'undefined' && cliente.formaDePagamento) ? cliente.formaDePagamento : (formaDePagamentoFallback || null),
            observacao: cliente.observacao || null,
            troco: (typeof cliente.troco !== 'undefined') ? cliente.troco : null,
            valorTotal: valorTotal(resolvedId, clienteId),
            carrinho: Array.isArray(cliente.carrinho) ? cliente.carrinho.map(i => ({ id: i.id, nome: i.nome, quantidade: i.quantidade, preparo: i.preparo, preco: i.preco, tipo: i.tipo })) : []
        };
        const pedidoRecord = {
            id: resolvedId,
            ts: Date.now(),
            total: valorTotal(resolvedId, clienteId),
            entrega: !!cliente.entrega,
            endereco: cliente.endereco || null,
            estado: estado || null,
            items: cliente.carrinho || [],
            raw: rawSanitized
        };
        if (typeof adicionarPedido === 'function') {
            // Ensure we pass the clienteId (restaurant identifier) to the DB layer
            try {
                const targetClienteId = clienteId || 'brutus-burger';
                console.log('[salvarPedido] Chamando adicionarPedido com clienteId=', targetClienteId, 'numero=', String(resolvedId).replace(/[^0-9]/g,''));
                adicionarPedido(String(resolvedId).replace(/[^0-9]/g,''), pedidoRecord, targetClienteId);
            } catch (e) {
                console.warn('[salvarPedido] adicionarPedido falhou:', e && e.message ? e.message : e);
            }
        }
    } catch (dbErr) {
        console.error('Erro ao persistir pedido no DB:', dbErr && dbErr.message ? dbErr.message : dbErr);
    }

    // Após persistir e tentar imprimir, remover arquivos gerados (PDF/HTML) SOMENTE se a impressão foi bem sucedida
    try {
        const pdfExists = fs.existsSync(filePath);
        const htmlFallback = filePath.replace(/\.pdf$/i, '.html');
        const htmlExists = fs.existsSync(htmlFallback);
        if (printSuccess) {
            if (pdfExists) {
                try { fs.unlinkSync(filePath); console.log('PDF removido:', filePath); } catch(e) { console.warn('Falha ao remover PDF:', e); }
            }
            if (htmlExists) {
                try { fs.unlinkSync(htmlFallback); console.log('HTML fallback removido:', htmlFallback); } catch(e) { console.warn('Falha ao remover HTML fallback:', e); }
            }
        } else {
            // Se a impressão falhou, manter os arquivos gerados para inspeção manual
            console.log('[salvarPedido] Impressão falhou; mantendo arquivos para inspeção:');
            if (pdfExists) console.log('  PDF:', filePath);
            if (htmlExists) console.log('  HTML:', htmlFallback);
        }
    } catch (remErr) {
        console.error('Erro ao tentar remover arquivos gerados:', remErr && remErr.message ? remErr.message : remErr);
    }
    // Retorna uma representação HTML do pedido (útil se arquivo já foi removido)
    try {
        const pedidoFromDb = typeof obterPedidoPorId === 'function' ? obterPedidoPorId(idAtual, clienteId) : null;
        if (pedidoFromDb) {
            // montar um HTML simples a partir do registro salvo
            let html = `<html><head><meta charset="utf-8"><title>Pedido ${idAtual}</title></head><body>`;
            html += `<h1>Pedido ${idAtual}</h1>`;
            html += `<p><strong>Cliente:</strong> ${pedidoFromDb.numero || idAtual}</p>`;
            html += `<p><strong>Data:</strong> ${new Date(Number(pedidoFromDb.ts)||Date.now()).toLocaleString()}</p>`;
            html += `<p><strong>Total:</strong> R$ ${Number(pedidoFromDb.total||0).toFixed(2)}</p>`;
            if (pedidoFromDb.items && Array.isArray(pedidoFromDb.items)) {
                html += `<ul>`;
                for (const it of pedidoFromDb.items) {
                    html += `<li>${(it.quantidade||1)}x ${it.nome || it.id} - R$ ${(Number(it.preco)||0).toFixed(2)}</li>`;
                }
                html += `</ul>`;
            }
            html += `</body></html>`;
            return html;
        }
    } catch (e) { /* ignore */ }
    return null;
}


function carrinhoAdm(id, restaurantId) {
    const carrinhos = getCarrinhos(restaurantId);

    // Usa helper para resolver o ID do carrinho (compatibilidade entre formatos)
    const resolvedId = resolveCartId(id, restaurantId);
    if (!resolvedId) return '*Pedido não encontrado para o ID do cliente.*';

    const marmitas = (carrinhos[resolvedId].carrinho || []).filter(item => item.tipo === 'Lanche');
    const bebidas = (carrinhos[resolvedId].carrinho || []).filter(item => item.tipo === 'Bebida');
    const adicional = (carrinhos[resolvedId].carrinho || []).filter(item => item.tipo === 'Adicional');
    // A entrega agora é uma flag e um valor separado
    let msgCarrinhoAtual = '*NOVO PEDIDO:*\n';

    if (marmitas.length > 0) {
        msgCarrinhoAtual += '*LANCHES*:\n';
        msgCarrinhoAtual += marmitas.map(item => `${item.quantidade}x ${item.nome} ${item.preparo ? `(${item.preparo})` : ''}`).join('\n');
        msgCarrinhoAtual += '\n';
    }

    if (bebidas.length > 0) {
        msgCarrinhoAtual += '*BEBIDAS*:\n';
        msgCarrinhoAtual += bebidas.map(item => `${item.quantidade}x ${item.nome} ${item.descricao || ''}`).join('\n');
        msgCarrinhoAtual += '\n';
    }
    if (adicional.length > 0) {
        msgCarrinhoAtual += '*ADICIONAIS*:\n';
        msgCarrinhoAtual += adicional.map(item => `${item.quantidade}x ${item.nome} ${item.descricao}`).join('\n');
        msgCarrinhoAtual += '\n';
    }

    if (carrinhos[resolvedId].entrega) {
        msgCarrinhoAtual += `\n*ENDEREÇO DE ENTREGA:*\n`;
        msgCarrinhoAtual += `_Endereço: ${carrinhos[resolvedId].endereco || 'Não especificado'}_`;
        if (carrinhos[resolvedId].endereco === "LOCALIZAÇÃO" && carrinhos[resolvedId].lat && carrinhos[resolvedId].lng) {
            const linkLocalizacao = `https://www.google.com/maps/search/?api=1&query=${carrinhos[resolvedId].lat},${carrinhos[resolvedId].lng}`;
            msgCarrinhoAtual += `\nVer no Mapa: ${linkLocalizacao}\n\n`;
        }
        // 👉 Adiciona o valor da entrega
        if (typeof carrinhos[resolvedId].valorEntrega === 'number' && carrinhos[resolvedId].valorEntrega > 0) {
            msgCarrinhoAtual += `\n_Taxa de Entrega: R$ ${carrinhos[resolvedId].valorEntrega.toFixed(2)}_`;
        }
        msgCarrinhoAtual += '\n';
    } else if (carrinhos[resolvedId].retirada) {
        msgCarrinhoAtual += `\n*MODO DE ENTREGA: RETIRADA NO LOCAL*\n`;
    }

    if (carrinhos[resolvedId].observacao) {
        msgCarrinhoAtual += `\n*Observação:* _${carrinhos[resolvedId].observacao}_`;
        msgCarrinhoAtual += '\n';
    }

    msgCarrinhoAtual += `\n*Valor Total:* _*R$ ${valorTotal(resolvedId).toFixed(2)}*_ 💰\n`;
    msgCarrinhoAtual += `Nome: ${carrinhos[resolvedId].nome || 'Não informado'}\n`;
    // Exibir contato usando o número sanitizado do resolvedId
    const contatoLink = sanitizeId(resolvedId);
    msgCarrinhoAtual += `Contato: wa.me/${contatoLink}\n`;
    return msgCarrinhoAtual;
}

// Helper: resolve o ID do carrinho tentando variações comuns (raw, raw+'@c.us', sanitizado)
function resolveCartId(rawId, restaurantId = 'brutus-burger') {
    if (!rawId) return null;
    const carrinhos = getCarrinhos(restaurantId);
    if (carrinhos[rawId]) return rawId;
    const withSuffix = rawId + '@c.us';
    if (carrinhos[withSuffix]) return withSuffix;
    const s = sanitizeId(rawId);
    if (carrinhos[s]) return s;
    // Try also reversed: maybe rawId already contains @c.us and sanitized helps
    // (sanitizeId already handles removing such suffixes)
    return null;
}


module.exports = {
    stats,
    adicionarItemAoCarrinho,
    atualizarEstadoDoCarrinho,
    obterInformacoesCliente,
    atualizarEnderecoCliente,
    carrinhos,
    resetCarrinho,
    valorTotal,
    carrinhoView,
    carrinhoAdm, // Mantém carrinhoAdm se for usada em outros lugares, mas imprimirPedido é mais completa para PDF
    inicializarCarrinho,
    initCarrinho,
    getCarrinho,
    removerItemDoCarrinho,
    atualizarQuantidadeDoItem,
    imprimirPedido, // Exporta a função para ser usada onde o PDF é gerado
    salvarPedido,
    imprimirPedidoFromRecord,
    events,
    _emitUpdate,
    buscarItemCardapio, // Função centralizada para busca de itens
    getCarrinhos, // Função para obter carrinhos específicos de um restaurante
    getBotStatus, // Função para obter status do bot de um restaurante
    setBotStatus, // Função para definir status do bot de um restaurante
    resolveCartId,
};
