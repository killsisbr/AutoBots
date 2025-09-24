// Importa módulos e funções necessárias
const { createClientMensagem } = require('../../utils/mensagens'); // Módulo de mensagens para respostas padronizadas
const idChatGrupo = require('../../utils/config').idChatGrupo; // ID do grupo para mensagens de suporte
const { analisarLocalizacao } = require('../menuEndereço'); // Função para gerenciar o fluxo de entrega/retirada
const { retiradaBalcaoConfig } = require('../../utils/config');
const menuEntregaRetirada = require('./menuEntregaRetirada'); // Função para gerenciar escolha entre entrega e retirada
const { obterInformacoesCliente, buscarEnderecoCliente, atualizarEnderecoCliente: atualizarEnderecoClienteDB } = require('../../services/clienteService'); // Serviço para obter informações do cliente
const { atualizarEstadoDoCarrinho, resetCarrinho, carrinhoView, valorTotal, stats } = require('../../services/carrinhoService'); // Serviços de carrinho
const path = require('path'); // Módulo 'path' para lidar com caminhos de arquivo
const fs = require('fs'); // Módulo 'fs' para verificar a existência de arquivos
const analisePalavras = require('../analisePalavras'); // Módulo para análise de palavras e reconhecimento de itens
const cardapioService = require('../../services/cardapioService');

/**
 * Processa as interações do cliente no menu inicial, gerenciando o estado do carrinho
 * e direcionando para as próximas etapas (pedido, ajuda, finalizar, etc.).
 * @param {string} idAtual O ID do chat (cliente) atual.
 * @param {object} carrinhoAtual O objeto do carrinho do cliente atual.
 * @param {object} msg O objeto da mensagem recebida do WhatsApp.
 * @param {object} client O objeto do cliente WhatsApp para enviar mensagens.
 * @param {object} MessageMedia O módulo MessageMedia para lidar com envio de arquivos.
 * @param {string} clienteId O ID do cliente/restaurante.
 */
async function menuInicial(idAtual, carrinhoAtual, msg, client, MessageMedia, clienteId = 'brutus-burger') {
    console.log(`\n🍔 ===== MENU INICIAL =====`);
    console.log(`👤 [menuInicial] Cliente: ${idAtual}`);
    console.log(`🏪 [menuInicial] ClienteId: ${clienteId}`);
    console.log(`💬 [menuInicial] Mensagem recebida: "${msg.body}"`);
    console.log(`📊 [menuInicial] Estado carrinho: ${carrinhoAtual.estado}`);
    console.log(`🛒 [menuInicial] Itens no carrinho: ${carrinhoAtual.carrinho.length}`);
    
    // Cria objeto de mensagens específico para este cliente
    const resp = createClientMensagem(clienteId);
    
    // Define o limite máximo de distância para entrega em KM
    const LIMITE_KM = 70; // Exemplo: 70 km - Ajuste conforme sua necessidade

    // Converte a última mensagem do cliente para minúsculas para facilitar a comparação
    const lastMsgLower = (carrinhoAtual.lastMsg || msg.body || '').toLowerCase();
    console.log(`🔤 [menuInicial] Mensagem normalizada: "${lastMsgLower}"`);

    // Marca que uma ação no menu inicial foi processada para evitar repetições
    //carrinhoAtual.aprt = true;

    console.log(`🔀 [menuInicial] Iniciando análise do switch para: "${lastMsgLower}"`);
    
    switch (lastMsgLower) {

        // --- Opções para Iniciar/Reiniciar Pedido ---
        case 'novo':
        case 'reiniciar':
        case 'pedir':
            console.log(`🔄 [menuInicial] GATILHO: Reiniciar pedido ativado`);
            console.log('Iniciando/Reiniciando pedido para o ID:', idAtual);
            resetCarrinho(idAtual, carrinhoAtual); // Limpa o carrinho do cliente

            // Verifica se o carrinho está vazio para dar a mensagem correta
            if (carrinhoAtual.carrinho.length === 0) {
                msg.reply('Seu carrinho foi reiniciado. \n' + resp.msgmenuInicialSub);
            } else {
                msg.reply(`${carrinhoView(idAtual)}\n${resp.msgmenuInicialSub}`);
            }
            // Garante que o estado volte ao menu inicial após reiniciar
            break;

        // --- Opções para Ajuda/Suporte ---
        case 'ajuda':
        case 'socorro':
        case 'help':
            console.log(`🆘 [menuInicial] GATILHO: Ajuda/Suporte ativado`);
            console.log('Cliente solicitando ajuda:', idAtual);
            atualizarEstadoDoCarrinho(idAtual, stats.menuSuporte); // Altera o estado do carrinho para suporte
            msg.reply(resp.msgAjuda); // Envia mensagem de ajuda ao cliente
            // Notifica o grupo de suporte sobre o pedido de ajuda
            client.sendMessage(idChatGrupo, `*Cliente pedindo ajuda !!*\nWa.me/${idAtual}`);
            break;

        // --- Opções para Finalizar Pedido ---
        case 'finalizar':
        case 'f':
            console.log(`✅ [menuInicial] GATILHO: Finalizar pedido ativado`);
            console.log('Cliente finalizando pedido:', idAtual);
            // Verifica se o carrinho está vazio antes de finalizar
            if (carrinhoAtual.carrinho.length === 0) {
                msg.reply('Seu carrinho está vazio. \n' + resp.msgmenuInicialSub);
                return; // Sai da função se o carrinho estiver vazio
            }

            // Verifica se a retirada no balcão está habilitada
            if (retiradaBalcaoConfig.habilitada) {
                // Mostra opções de entrega e retirada
                atualizarEstadoDoCarrinho(idAtual, stats.menuEntregaRetirada);
                msg.reply(resp.msgMenuEntregaRetirada);
                return;
            }
            
            const enderecoSalvo = await buscarEnderecoCliente(idAtual, clienteId);
            // Normaliza e valida o endereço salvo: pode ser string, objeto {endereco,lat,lng} ou vazio ({}).
            let enderecoValido = false;
            let enderecoTexto = null;
            if (enderecoSalvo) {
                if (typeof enderecoSalvo === 'string') {
                    const s = enderecoSalvo.trim();
                    if (s.length > 0 && s !== '{}' && s !== 'null') {
                        enderecoValido = true;
                        enderecoTexto = s;
                    }
                } else if (typeof enderecoSalvo === 'object') {
                    // objeto vazio => não é válido
                    if (Object.keys(enderecoSalvo).length > 0) {
                        // se tiver campo endereco não vazio, use-o
                        if (typeof enderecoSalvo.endereco === 'string' && enderecoSalvo.endereco.trim().length > 0 && enderecoSalvo.endereco.trim() !== '{}') {
                            enderecoValido = true;
                            enderecoTexto = enderecoSalvo.endereco.trim();
                        } else {
                            // aceita coordenadas apenas se forem números reais
                            const lat = enderecoSalvo.lat;
                            const lng = enderecoSalvo.lng;
                            if (lat !== null && lng !== null && lat !== undefined && lng !== undefined && !Number.isNaN(Number(lat)) && !Number.isNaN(Number(lng))) {
                                enderecoValido = true;
                                enderecoTexto = 'LOCALIZAÇÃO';
                            }
                        }
                    }
                }
            }

            if (enderecoValido) {
                // preserva coords se houver
                if (enderecoSalvo && typeof enderecoSalvo === 'object') {
                    if (enderecoSalvo.lat !== undefined) carrinhoAtual.lat = enderecoSalvo.lat;
                    if (enderecoSalvo.lng !== undefined) carrinhoAtual.lng = enderecoSalvo.lng;
                }
                carrinhoAtual.endereco = enderecoTexto;
                console.log('Endereço encontrado para o cliente:', enderecoTexto);
                // If delivery/address was already confirmed earlier, skip re-confirming and proceed
                // directly to the order confirmation step (observations). This allows admin "finalizar"
                // to resume where the user left off when they already answered 'S'.
                if (carrinhoAtual.entregaConfirmada === true) {
                    try {
                        msg.reply(resp.msgObs);
                    } catch (e) { /* ignore reply errors */ }
                    // Só altera para confirmar pedido se não estiver já finalizado
                    try {
                        const menuFinalizadoStat = (carrinhoService && carrinhoService.stats && carrinhoService.stats.menuFinalizado) || 'finalizado';
                        const estadoAtual = carrinhos[idAtual] && carrinhos[idAtual].estado;
                        if (!estadoAtual || String(estadoAtual) !== String(menuFinalizadoStat)) {
                            atualizarEstadoDoCarrinho(idAtual, stats.menuConfirmandoPedido);
                        } else {
                            console.log(`[INFO] Carrinho ${idAtual} já estava finalizado; não alterando estado ao pular endereço.`);
                        }
                    } catch (e) { atualizarEstadoDoCarrinho(idAtual, stats.menuConfirmandoPedido); }
                    return;
                }
                // Se for um endereço do tipo LOCALIZAÇÃO com coords, delega para analisarLocalizacao
                if (enderecoTexto === 'LOCALIZAÇÃO' && carrinhoAtual.lat && carrinhoAtual.lng) {
                    try {
                        analisarLocalizacao(idAtual, carrinhoAtual, msg, client, MessageMedia, clienteId);
                    } catch (e) { console.error('Erro ao analisar localização salva:', e); }
                } else {
                    // Calcula taxa de entrega e total e mostra uma confirmação como no fluxo quando o usuário envia endereço
                    carrinhoAtual.valorEntrega = 7;
                    let totalCarrinho = valorTotal(idAtual);
                    let totalGeral = totalCarrinho + carrinhoAtual.valorEntrega;
                    carrinhoAtual.valorTotal = totalGeral;
                    msg.reply(
                        `${resp.msgEnderecoConfirma} \n➥ _${carrinhoAtual.endereco}_\n\n` +
                        `_Por favor, caso de interior envie *LOCALIZAÇÃO*._\n` +
                        `💸 Taxa de entrega: R$ ${carrinhoAtual.valorEntrega.toFixed(2)}\n` +
                        `🛒 *VALOR FINAL*: R$ ${totalGeral.toFixed(2)}\n\n` +
                        `Digite *S* para confirmar ou envie outro endereço.`
                    );
                }
                atualizarEstadoDoCarrinho(idAtual, stats.menuEndereço); // Chama o menu de endereço para confirmar com sim ou digitar novo endereço.
                return;
            }
            // Se havia um endereço salvo no DB, mas ele não passou na validação, limpar o valor no DB
            if (enderecoSalvo && !enderecoValido) {
                try {
                    console.warn(`[WARN] Endereço inválido no DB para ${idAtual}:`, enderecoSalvo, ' — limpando registro.');
                    if (typeof atualizarEnderecoClienteDB === 'function') {
                        atualizarEnderecoClienteDB(idAtual, null, null, null);
                    }
                } catch (e) { console.error('Erro ao limpar endereço inválido no DB:', e); }
                // Também garantir que o carrinho não tenha endereço para forçar coleta
                try { carrinhoAtual.endereco = null; } catch (e) {}
            }
            if (carrinhoAtual.endereco === undefined || carrinhoAtual.endereco === null) {
                // Se o endereço não foi definido, solicita ao cliente
                console.log('Solicitando endereço ao cliente:', idAtual);
                msg.reply(resp.msgPedindoEndereco);
                atualizarEstadoDoCarrinho(idAtual, stats.menuEndereço); // Chama o menu
                return; // Sai da função para aguardar o endereço
            }
            //calcular distancia pela longitude e latitude
            if (carrinhoAtual.lat && carrinhoAtual.lng && carrinhoAtual.endereco === 'LOCALIZAÇÃO') {
                analisarLocalizacao(idAtual, carrinhoAtual, msg, client, MessageMedia, clienteId);
            } else {
                carrinhoAtual.valorEntrega = 7;
                let totalCarrinho = valorTotal(idAtual);
                let totalGeral = totalCarrinho + carrinhoAtual.valorEntrega;
                carrinhoAtual.valorTotal = totalGeral;
                // Se o endereço não for uma localização, chama o menu de endereço
                msg.reply(
                    `${resp.msgEnderecoConfirma} \n➥ _${carrinhoAtual.endereco}_\n\n` +
                    `_Por favor, caso de interior envie *LOCALIZAÇÃO*._\n` +
                    `💸 Taxa de entrega: R$ ${carrinhoAtual.valorEntrega.toFixed(2)}\n` +
                    `🛒 *VALOR FINAL*: R$ ${totalGeral.toFixed(2)}\n\n` +
                    `Digite *S* para confirmar ou envie outro endereço.`
                );
            }
            atualizarEstadoDoCarrinho(idAtual, stats.menuEndereço); // Chama o menu de endereço
            break; // Fim do 'case 'finalizar''
        // --- Opções para Cancelar Último Item do Carrinho ---
        case 'c':
        case 'cancelar':
            console.log('Cliente cancelando último item do carrinho:', idAtual);
            if (carrinhoAtual.carrinho.length > 0) {
                carrinhoAtual.carrinho.pop(); // Remove o último item do carrinho
                if (carrinhoAtual.carrinho.length === 0) {
                    msg.reply('Seu carrinho está vazio. \n' + resp.msgmenuInicialSub);
                } else {
                    msg.reply(`${carrinhoView(idAtual)}${resp.msgmenuInicialSub}`);
                }
            } else {
                msg.reply('Seu carrinho já está vazio. \n' + resp.msgmenuInicialSub);
            }
            break;
        // --- Opções para o Menu de Bebidas ---
        case 'bebida':
        case 'beber':
        case 'bebidas':
        case 'b':
            try {
                console.log('Cliente solicitou lista de bebidas:', idAtual);
                // Buscar bebidas disponíveis via cardapioService
                await cardapioService.init();
                const items = cardapioService.getItems(clienteId) || [];
                const bebidas = items.filter(i => String(i.tipo).toLowerCase() === 'bebida');
                if (bebidas.length === 0) {
                    msg.reply('No momento não temos bebidas cadastradas.');
                } else {
                    let texto = `*BEBIDAS DISPONÍVEIS:*`;
                    bebidas.forEach((b) => {
                        const preco = (typeof b.preco === 'number') ? b.preco.toFixed(2) : (b.preco || '0.00');
                        texto += `\n- ${b.nome} - R$ ${preco}`;
                    });
                    texto += `\n\nVocê pode pedir digitando apenas o *nome* da bebida (ex: "coca zero").`;
                    msg.reply(texto);
                }
                // Mantém o estado como menuInicial para permitir gatilhos por palavra (nome da bebida)
                atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
            } catch (e) {
                console.error('[menuInicial] Erro ao listar bebidas:', e && e.message ? e.message : e);
                msg.reply(resp.msgMenuBebidas);
                atualizarEstadoDoCarrinho(idAtual, stats.menuBebidas);
            }
            break;

        // --- Saudações e Mensagens de Início ---
        case 'oi':
        case 'olá':
        case 'ola':
        case 'hello':
        case 'hi':
        case 'bom dia':
        case 'boa tarde':
        case 'boa noite':
        case 'cardapio':
        case 'cardápio':
        case 'menu':
        case 'começar':
        case 'comecar':
        case 'iniciar':
        case 'start':
            console.log(`👋 [menuInicial] GATILHO: Saudação reconhecida: "${lastMsgLower}"`);
            // Força a apresentação do cardápio mesmo se já foi apresentado antes
            carrinhoAtual.aprt = false;
            // Continua para o caso padrão para mostrar o cardápio
            
        // --- Default: Exibir Cardápio e Mensagem Inicial ---
        default:
            console.log(`🎯 [menuInicial] CASO PADRÃO: Analisando mensagem: "${lastMsgLower}"`);
            
            // Primeiro, tenta reconhecer se a mensagem é um item do cardápio
            try {
                console.log(`🔍 [menuInicial] Tentando reconhecer item do cardápio...`);
                console.log(`📝 [menuInicial] Mensagem: "${lastMsgLower}" | Cliente: ${clienteId}`);
                
                const itemId = await analisePalavras.getItemIdByName(lastMsgLower, clienteId);
                console.log(`🔍 [menuInicial] getItemIdByName resultado: ${itemId} (tipo: ${typeof itemId})`);
                
                if (itemId) {
                    console.log(`✅ [menuInicial] ITEM RECONHECIDO: "${lastMsgLower}" -> ID ${itemId}`);
                    console.log(`🔄 [menuInicial] Processando item através do analisePalavras...`);
                    
                    // Chama analisarPalavras para processar o item
                    const palavras = analisePalavras.separarMensagem(msg.body);
                    console.log(`📝 [menuInicial] Palavras separadas: [${palavras.join(', ')}]`);
                    
                    const resultado = await analisePalavras.analisarPalavras(palavras, carrinhoAtual, msg, idAtual, client, MessageMedia, clienteId);
                    console.log(`📊 [menuInicial] analisarPalavras resultado: ${JSON.stringify(resultado)}`);
                    
                    if (resultado && resultado.length > 0) {
                        console.log(`✅ [menuInicial] Item processado com SUCESSO!`);
                        console.log(`🍔 ===== FIM MENU INICIAL (ITEM PROCESSADO) =====\n`);
                        return; // Sai da função após processar o item
                    } else {
                        console.log(`🔍 [DEBUG] analisarPalavras não retornou resultado válido`);
                    }
                } else {
                    console.log(`🔍 [DEBUG] Item NÃO reconhecido: "${lastMsgLower}"`);
                }
            } catch (error) {
                console.log(`🔍 [DEBUG] Erro ao tentar reconhecer item: ${error.message}`);
                console.log(`🔍 [DEBUG] Stack trace:`, error.stack);
            }
            
            if (carrinhoAtual.aprt === false) {
                carrinhoAtual.aprt = true;
                // Usando path.resolve para construir um caminho absoluto robusto para a raiz do projeto
                const rootPath = path.resolve(__dirname, '..', '..', '..');
                const cardapioPath = path.join(rootPath, 'cardapio.jpg');
                const cardapioPath2 = path.join(rootPath, 'cardapio2.jpg');
                const cardapioPath3 = path.join(rootPath, 'cardapio3.jpg');
                try {
                    // Verifica se o arquivo existe antes de tentar carregar
                    if (fs.existsSync(cardapioPath) && fs.existsSync(cardapioPath2) && fs.existsSync(cardapioPath3)) {
                        try {
                            console.log('Verificando arquivos do cardápio:', cardapioPath, cardapioPath2, cardapioPath3);
                            const cardapioMedia3 = MessageMedia.fromFilePath(cardapioPath3);
                            const cardapioMedia = MessageMedia.fromFilePath(cardapioPath);
                            const cardapioMedia2 = MessageMedia.fromFilePath(cardapioPath2);
                            // Envia as imagens do cardápio
                            await client.sendMessage(msg.from, cardapioMedia3);
                            await client.sendMessage(msg.from, cardapioMedia, { caption: `${resp.msgApresentacao}` });
                            await client.sendMessage(msg.from, cardapioMedia2);
                            console.log('✅ Cardápio enviado com sucesso');
                        } catch (mediaError) {
                            console.error('❌ Erro ao serializar/enviar imagens do cardápio:', mediaError);
                            await msg.reply(`${resp.msgApresentacao}\n\n[Erro ao processar as imagens do cardápio. Verifique se os arquivos estão íntegros e acessíveis.]`);
                        }
                    } else {
                        // Se o arquivo não existe, lança um erro para ser pego pelo catch
                        throw new Error('Arquivos de cardápio não encontrados no diretório raiz do projeto.');
                    }
                } catch (error) {
                    console.error('❌ Erro ao enviar imagens do cardápio:', error);
                    // Em caso de erro, envia uma mensagem de texto alternativa
                    await msg.reply(`${resp.msgApresentacao}\n\n[As imagens do cardápio não puderam ser enviadas. Por favor, verifique se os arquivos estão na pasta correta.]`);
                }
            } else {
                // Se já foi apresentado, envia apenas a mensagem inicial
                console.log('📱 [menuInicial] Enviando apenas mensagem inicial (já apresentado)');
                await msg.reply(resp.msgmenuInicialSub || 'Olá! Como posso ajudá-lo?');
            }
            break;
    }
    
    console.log(`✅ [menuInicial] Processamento concluído`);
    console.log(`🍔 ===== FIM MENU INICIAL =====\n`);
}

/**
 * Retorna a hora atual.
 * @returns {number} A hora atual (0-23).
 */
function Hora() {
    return new Date().getHours();
}

// Exporta a função principal do menu inicial
module.exports = menuInicial;
