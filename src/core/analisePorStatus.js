const mensagens = require('../utils/mensagens');
const carrinhoService = require('../services/carrinhoService');
const resp = mensagens.mensagem;
const atualizarEstadoDoCarrinho = carrinhoService.atualizarEstadoDoCarrinho;
const menuInicial = require('./fluxo/menuGlobal');
const menuTroco = require('./fluxo/menuTroco').menuTroco;
const menuSuporte = require('./fluxo/menuSuporte').menuSuporte;
const { menuFinalizado } = require('./fluxo/menuFinalizado');
const { menuNome } = require('./fluxo/menuNome');
const { obterObservacao } = require('./fluxo/menuObservação');
const { analisarEndereço, analisarLocalizacao } = require('./menuEndereço');
const menuEntregaRetirada = require('./fluxo/menuEntregaRetirada');
const adicionarItemAoCarrinho = carrinhoService.adicionarItemAoCarrinho;
const menuFormaPagamento = require('./fluxo/menuPagamento').menuPagamento;
const carrinhoView = carrinhoService.carrinhoView;
const stats = carrinhoService.stats;
const esperarResposta = require('../utils/obterResposta').esperarResposta;
const analisePalavras = require('./analisePalavras');

async function analisePorStatus(carrinhoAtual, msg, idAtual, client, MessageMedia, clienteId = 'brutus-burger') {
    try {
        // Criar proxy de mensagens específico para este cliente
        const clientResp = mensagens.createClientMensagem(clienteId);
        
        console.log(`\n🎯 ===== ANÁLISE POR STATUS =====`);
        console.log(`👤 [analisePorStatus] Cliente: ${idAtual}`);
        console.log(`🏪 [analisePorStatus] ClienteId: ${clienteId}`);
        console.log(`📊 [analisePorStatus] Estado atual: ${carrinhoAtual.estado}`);
        console.log(`💬 [analisePorStatus] Mensagem: "${msg.body}"`);
        console.log(`🛒 [analisePorStatus] Itens no carrinho: ${carrinhoAtual.carrinho.length}`);
        
        // Mapear estados para nomes legíveis
        const estadosMap = {
            [stats.menuInicial]: 'MENU_INICIAL',
            [stats.menuBebidas]: 'MENU_BEBIDAS',
            [stats.menuEndereço]: 'MENU_ENDERECO',
            [stats.menuPagamento]: 'MENU_PAGAMENTO',
            [stats.menuFinalizado]: 'MENU_FINALIZADO'
        };
        
        const estadoNome = estadosMap[carrinhoAtual.estado] || `DESCONHECIDO(${carrinhoAtual.estado})`;
        console.log(`🔄 [analisePorStatus] Processando estado: ${estadoNome}`);
        
        // DEBUG: Verificar se o estado é menuConfirmandoPedido
        if (carrinhoAtual.estado === stats.menuConfirmandoPedido) {
            console.log(`🎯 [DEBUG] Estado CONFIRMADO como menuConfirmandoPedido`);
            console.log(`🎯 [DEBUG] stats.menuConfirmandoPedido: "${stats.menuConfirmandoPedido}"`);
            console.log(`🎯 [DEBUG] carrinhoAtual.estado: "${carrinhoAtual.estado}"`);
        }
        
        switch (carrinhoAtual.estado) { //tratamento da mensagem por estado do carrinho.
            case stats.menuInicial:
                console.log(`🍔 [analisePorStatus] ➡️ Direcionando para menuInicial`);
                menuInicial(idAtual, carrinhoAtual, msg, client, MessageMedia, clienteId);
                break;
            case stats.menuBebidas: //escolhe qual bebida
                console.log(`🥤 [analisePorStatus] ➡️ Direcionando para menuBebidas`);
                let idBebida = (msg.body || '').trim();
                console.log(`🥤 [menuBebidas] Resposta obtida: "${idBebida}"`);
                // Não pedir números para bebida; aceitar nome ou número (compatibilidade)
                try {
                    // Primeiro, se for número e corresponder a um item do cardápio, tratar como índice
                    if (!isNaN(idBebida) && idBebida !== null) {
                        const cardapioService = require('../services/cardapioService');
                        await cardapioService.init();
                        const items = cardapioService.getItems(clienteId) || [];
                        const bebidasList = items.filter(i => String(i.tipo).toLowerCase() === 'bebida');
                        const idx = parseInt(idBebida, 10) - 1; // interface mostra 1-based
                        if (idx >= 0 && idx < bebidasList.length) {
                            const item = bebidasList[idx];
                            await adicionarItemAoCarrinho(idAtual, item.id, 1, item.nome, 'Bebida', undefined, clienteId);
                            atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
                            msg.reply(`${carrinhoView(idAtual)}${clientResp.msgmenuInicialSub}`);
                            break;
                        }
                        // se número inválido, cai para tentativa por nome
                    }
                    // Se não for número (ou número inválido), tentar resolver pelo nome
                    const nome = String(idBebida || '').trim();
                    if (nome.length > 0) {
                        const itemId = await analisePalavras.getItemIdByName(nome, clienteId);
                        if (itemId) {
                            await adicionarItemAoCarrinho(idAtual, itemId, 1, nome, 'Bebida', undefined, clienteId);
                            atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
                            msg.reply(`${carrinhoView(idAtual)}${clientResp.msgmenuInicialSub}`);
                            break;
                        }
                    }
                } catch (e) {
                    console.warn('[menuBebidas] erro ao processar bebida:', e && e.message ? e.message : e);
                }
                // Se chegou aqui, não conseguiu resolver
                console.log(`❌ [menuBebidas] Não foi possível identificar a bebida: "${idBebida}"`);
                msg.reply('Opção inválida. Digite o nome da bebida desejada.');
                break;
                let unidadeBebida = await esperarResposta(carrinhoAtual);
                if (!isNaN(unidadeBebida) && unidadeBebida !== null) {
                    adicionarItemAoCarrinho(idAtual, carrinhoAtual.idSelect, unidadeBebida, "", 'Bebida', undefined, clienteId);
                    //console.log(carrinhoAtual.carrinho)
                    atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
                    msg.reply(`${carrinhoView(idAtual)}${clientResp.msgmenuInicialSub}`);
                } else {
                    if (carrinhoAtual.alertUnidadeBebida !== true) {
                        msg.reply("Você precisa digitar uma quantia valida!");
                        carrinhoAtual.alertUnidadeBebida = true;
                    }
                }
                break;
            case stats.menuEntregaRetirada:
                menuEntregaRetirada(idAtual, carrinhoAtual, msg, client);
                break;
            case stats.menuEndereço:
                console.log(`📬 [analisePorStatus] MENU_ENDERECO: Recebendo endereço do cliente`);
                console.log(`📝 [analisePorStatus] MENU_ENDERECO: Mensagem recebida: "${msg.body}"`);
                analisarEndereço(idAtual, carrinhoAtual, msg.body, msg, clienteId);
                break;
            case stats.menuQuantidadeAdicionais:
                let quantidadeAdicionais = await esperarResposta(carrinhoAtual);
                if (!isNaN(quantidadeAdicionais) && quantidadeAdicionais !== null) {
                    adicionarItemAoCarrinho(idAtual, carrinhoAtual.idSelect, quantidadeAdicionais, '', 'Adicional', undefined, clienteId);
                    msg.reply(`${carrinhoView(idAtual)}${clientResp.msgmenuInicialSub}`);
                    console.log(carrinhoAtual.carrinho);
                    atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
                } else {
                    msg.reply("Digite um número válido para a quantidade de adicionais.");
                }
                break;
            case stats.menuConfirmandoPedido:
                console.log(`🎯 [DEBUG] ENTROU NO CASE menuConfirmandoPedido!`);
                let observacao = await esperarResposta(carrinhoAtual);
                console.log(`🎯 [DEBUG] Observação obtida: "${observacao}"`);
                console.log(`🎯 [DEBUG] Chamando obterObservacao...`);
                obterObservacao(idAtual, carrinhoAtual, observacao, msg, client, clienteId);
                console.log(`🎯 [DEBUG] obterObservacao executada com sucesso`);
                break;
            case stats.menuPagamento:
                let formaDePagamento = await esperarResposta(carrinhoAtual);
                menuFormaPagamento(idAtual, carrinhoAtual, formaDePagamento, msg, client, clienteId);
                break;
            case stats.menuFinalizado:
                let msgfinal = await esperarResposta(carrinhoAtual);
                menuFinalizado(idAtual, carrinhoAtual, msg, msgfinal, client);
                break;
            case stats.menuSuporte: //menu suporte
                let suporte = await esperarResposta(carrinhoAtual);
                menuSuporte(msg, idAtual, suporte);
                break;
            case stats.menuNome: //resposta do nome
                let nome = await esperarResposta(carrinhoAtual);
                menuNome(idAtual, carrinhoAtual, msg, nome, client, clienteId);
                break;
            case stats.menuTroco:
                let troco = await esperarResposta(carrinhoAtual);
                menuTroco(idAtual, carrinhoAtual, troco, msg, client, clienteId);
                break;
            default:
                console.log(`⚠️ [analisePorStatus] Estado não reconhecido: "${carrinhoAtual.estado}"`);
                console.log(`🔍 [DEBUG] Todos os estados disponíveis:`, Object.keys(stats));
                console.log(`🔍 [DEBUG] Valores dos estados:`, stats);
                
                // Se for confirmandoPedido, forçar execução da obterObservacao
                if (carrinhoAtual.estado === 'confirmandoPedido') {
                    console.log(`🔧 [FIX] Forçando execução de obterObservacao para confirmandoPedido`);
                    let observacao = await esperarResposta(carrinhoAtual);
                    obterObservacao(idAtual, carrinhoAtual, observacao, msg, client, clienteId);
                }
                break;
        };
        
        console.log(`✅ [analisePorStatus] Processamento concluído com sucesso`);
        console.log(`🎯 ===== FIM ANÁLISE POR STATUS =====\n`);
        
    } catch (error) {
        console.error(`❌ [analisePorStatus] ERRO ao analisar estado do carrinho:`, error);
        console.log(`🎯 ===== FIM ANÁLISE POR STATUS (ERRO) =====\n`);
    }
}
module.exports = analisePorStatus;