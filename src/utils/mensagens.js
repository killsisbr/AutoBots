// Sistema de mensagens integrado com banco de dados
const mensagensService = require('../services/mensagensService');

// Cache das mensagens para melhor performance
let mensagensCache = {};
let lastCacheUpdate = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

// Função para carregar mensagens do banco
async function loadMensagensFromDB() {
    try {
        const now = Date.now();
        
        // Verifica se o cache ainda é válido
        if (now - lastCacheUpdate < CACHE_DURATION && Object.keys(mensagensCache).length > 0) {
            return mensagensCache;
        }
        
        const mensagens = await mensagensService.getAllMensagens();
        mensagensCache = {};
        
        // Converte array de mensagens para objeto com chaves
        mensagens.forEach(msg => {
            if (msg.ativo) {
                mensagensCache[msg.chave] = msg.conteudo;
            }
        });
        
        lastCacheUpdate = now;
        return mensagensCache;
    } catch (error) {
        console.error('[MENSAGENS] Erro ao carregar do banco:', error);
        
        // Fallback para mensagens padrão em caso de erro
        return {
            "msgChavePix": "42998302047 GERIAM DE AZEVEDO",
            "msgEnderecoConfirma": "_*ESTA CERTO O ENDEREÇO ABAIXO?*_\n",
            "msgMenuPagamento": "*Forma de pagamento?*\r\n\r\n1 - Dinheiro. \r\n2 - Pix. \r\n3 - Cartão (Crédito/Debito). \r\n\r\n*informe o número da opção desejada.*",
            "msgPedindoNome": "*SEU NOME?*\r\n\r\n_Para facilitar a identificação_ \r\n\r\nDigite seu *NOME*.",
            "msgMenuFinal": "Opa, como posso te ajudar?\r\n\r\n*Ajuda* - falar com uma atendente.\r\n*Reiniciar* - Fazer um novo pedido!",
            "msgTroco": "💰 *Precisa de troco?*\r\n\r\nSe você vai pagar em *DINHEIRO*, informe o valor para o qual precisa de troco.\r\n\r\n💡 *Exemplo:* Se seu pedido deu R$ 25,00 e você tem uma nota de R$ 50,00, digite: *50*\r\n\r\nSe não precisar de troco, digite: *NÃO*",
            "msgAjuda": "_ENCAMINHANDO_\r\n\r\n_Enquanto esperamos, conte qual sua duvida e como podemos ajudar_\r\n\r\n*Opções do menu:*\r\n*Voltar* - _retornar ao menu *INICIAL*.\r\n*Reiniciar* - _limpa seu carrinho._",
            "msgPedidoAnotado": "_Seu pedido foi recebido pelo restaurante, e esta em preparo.._ \r\n_Caso tenha duvidas, pode digitar as opções a seguir..._ \r\n\r\n*Reiniciar* - Pedir novamente.\r\n*Ajuda* - Falar com um suporte.",
            "msgObs": "*OBSERVAÇÃO FINAL:*\r\n\r\n_Ponto da carne?_\r\n_Horário especefico?_\r\n_Montagem?_\r\n\r\n🤖 Quer anotar alguma observação?",
            "msgQuantidade": "_Adicionar quantas ao seu pedido_?",
            "msgMenuBebidas": "*CARDÁPIO DE BEBIDAS:*\n\n*Coca-Cola Lata* - R$ 6.00\n*Coca-Cola Lata Zero* - R$ 6.00\n*Coca-Cola 2L* - R$ 13.00\n*Coca-Cola 2L Zero* - R$ 13.00\n*Guaraná Lata* - R$ 5.00\n*Guaraná 2l* - R$ 13.00\n\n🤖: anotar algo ? ✍🏻",
            "msgmenuInicialSub": "🤖 Certinho acima? ☝🏻\r\nanotar algo mais? ✍🏻\r\n\r\n*B* - _Abrir lista bebidas_.\r\n*C* - _Cancelar ultimo item do carrinho_.\r\n*F* - _*Finalizar pedido.*_",
            "msgEntrega": "*TAXA FIXA*\r\n\r\n*R$7.00* para região urbana.\r\nNosso delivery é rápido. (20-40min)\r\n\r\n📍 Se for interior ou locais afastados, *envie sua localização*.",
            "msgAvisoEntrega": "*AVISO IMPORTANTE:*\r\n_Entregas começam apartir das 18:00._\r\n_Mas pode pedir deixar seu pedido encomendado._",
            "msgApresentacao": "🍔 *BEM-VINDO AO BRUTUS BURGER!* 🍔\r\n\r\n👋 Olá! Seja muito bem-vindo(a) ao nosso atendimento automático!\r\n\r\n📱 Aqui você pode fazer seu pedido de forma rápida e prática.\r\n\r\n🕐 *Horário de Funcionamento:*\r\n▪️ Segunda a Domingo: 18:00 às 23:30\r\n\r\n🛵 *Delivery disponível!*\r\n\r\nPara começar, digite *CARDÁPIO* ou clique no botão abaixo! 👇",
            "msgFormaDePagamento": "*Forma de pagamento?*\r\n\r\n1 - Dinheiro. \r\n2 - Pix. \r\n3 - Cartão (Crédito/Debito). \r\n\r\n*informe o número da opção desejada.*",
            "msgMenuEntregaRetirada": "*COMO VOCÊ QUER RECEBER SEU PEDIDO?*\r\n\r\n1️⃣ - 🚚 *Entrega* (Taxa de R$ 7,00)\r\n2️⃣ - 🏪 *Retirada no balcão* (Sem taxa)\r\n\r\n*Digite 1 ou 2:*",
            "msgPedindoEndereco": "'*ENDEREÇO OU LOCALIZAÇÃO*\r\n\r\n_Em uma frase, digite seu endereço completo ou envie sua localização._\r\n*Exemplo: Rua 1, 123, Bairro Centro*\r\n\r\n📍Se for interior ou locais afastados, *envie sua localização*."
        };
    }
}

// Função para criar proxy específico para um cliente
function createClientMensagem(clienteId) {
    return new Proxy({}, {
        get: function(target, prop) {
            // Se a propriedade já está no cache, retorna
            if (mensagensCache[prop]) {
                return mensagensCache[prop];
            }
            
            // Se não está no cache, tenta carregar sincronamente do serviço
            try {
                const mensagemDoBanco = mensagensService.getMensagemByChave(clienteId, prop);
                if (mensagemDoBanco && mensagemDoBanco.ativo) {
                    mensagensCache[prop] = mensagemDoBanco.conteudo;
                    return mensagemDoBanco.conteudo;
                }
            } catch (error) {
                console.error(`[MENSAGENS] Erro ao buscar ${prop} para cliente ${clienteId}:`, error);
            }
            
            // Fallback para mensagens padrão
        const fallbackMensagens = {
            "msgChavePix": "42998302047 GERIAM DE AZEVEDO",
            "msgEnderecoConfirma": "_*ESTA CERTO O ENDEREÇO ABAIXO?*_\n",
            "msgMenuPagamento": "*Forma de pagamento?*\r\n\r\n1 - Dinheiro. \r\n2 - Pix. \r\n3 - Cartão (Crédito/Debito). \r\n\r\n*informe o número da opção desejada.*",
            "msgPedindoNome": "*SEU NOME?*\r\n\r\n_Para facilitar a identificação_ \r\n\r\nDigite seu *NOME*.",
            "msgMenuFinal": "Opa, como posso te ajudar?\r\n\r\n*Ajuda* - falar com uma atendente.\r\n*Reiniciar* - Fazer um novo pedido!",
            "msgTroco": "💰 *Precisa de troco?*\r\n\r\nSe você vai pagar em *DINHEIRO*, informe o valor para o qual precisa de troco.\r\n\r\n💡 *Exemplo:* Se seu pedido deu R$ 25,00 e você tem uma nota de R$ 50,00, digite: *50*\r\n\r\nSe não precisar de troco, digite: *NÃO*",
            "msgAjuda": "_ENCAMINHANDO_\r\n\r\n_Enquanto esperamos, conte qual sua duvida e como podemos ajudar_\r\n\r\n*Opções do menu:*\r\n*Voltar* - _retornar ao menu *INICIAL*.\r\n*Reiniciar* - _limpa seu carrinho._'",
            "msgPedidoAnotado": "_Seu pedido foi recebido pelo restaurante, e esta em preparo.._ \r\n_Caso tenha duvidas, pode digitar as opções a seguir..._ \r\n\r\n*Reiniciar* - Pedir novamente.\r\n*Ajuda* - Falar com um suporte.",
            "msgObs": "*OBSERVAÇÃO FINAL:*\r\n\r\n_Ponto da carne?_\r\n_Horário especefico?_\r\n_Montagem?_\r\n\r\n🤖 Quer anotar alguma observação?",
            "msgQuantidade": "_Adicionar quantas ao seu pedido_?",
            "msgMenuBebidas": "*CARDÁPIO DE BEBIDAS:*\n\n*Coca-Cola Lata* - R$ 6.00\n*Coca-Cola Lata Zero* - R$ 6.00\n*Coca-Cola 2L* - R$ 13.00\n*Coca-Cola 2L Zero* - R$ 13.00\n*Guaraná Lata* - R$ 5.00\n*Guaraná 2l* - R$ 13.00\n\n🤖: anotar algo ? ✍🏻",
            "msgmenuInicialSub": "🤖 Certinho acima? ☝🏻\r\nanotar algo mais? ✍🏻\r\n\r\n*B* - _Abrir lista bebidas_.\r\n*C* - _Cancelar ultimo item do carrinho_.\r\n*F* - _*Finalizar pedido.*_",
            "msgEntrega": "*TAXA FIXA*\r\n\r\n*R$7.00* para região urbana.\r\nNosso delivery é rápido. (20-40min)\r\n\r\n📍 Se for interior ou locais afastados, *envie sua localização*.",
            "msgAvisoEntrega": "*AVISO IMPORTANTE:*\r\n_Entregas começam apartir das 18:00._\r\n_Mas pode pedir deixar seu pedido encomendado._",
            "msgApresentacao": "🍔 *BEM-VINDO AO BRUTUS BURGER!* 🍔\r\n\r\n👋 Olá! Seja muito bem-vindo(a) ao nosso atendimento automático!\r\n\r\n📱 Aqui você pode fazer seu pedido de forma rápida e prática.\r\n\r\n🕐 *Horário de Funcionamento:*\r\n▪️ Segunda a Domingo: 18:00 às 23:30\r\n\r\n🛵 *Delivery disponível!*\r\n\r\nPara começar, digite *CARDÁPIO* ou clique no botão abaixo! 👇",
            "msgFormaDePagamento": "*Forma de pagamento?*\r\n\r\n1 - Dinheiro. \r\n2 - Pix. \r\n3 - Cartão (Crédito/Debito). \r\n\r\n*informe o número da opção desejada.*",
            "msgPedindoEndereco": "*ENDEREÇO OU LOCALIZAÇÃO*\r\n\r\n_Em uma frase, digite seu endereço completo ou envie sua localização._\r\n*Exemplo: Rua 1, 123, Bairro Centro*\r\n\r\n📍Se for interior ou locais afastados, *envie sua localização*.",
            "msgMenuEntregaRetirada": "*COMO VOCÊ QUER RECEBER SEU PEDIDO?*\r\n\r\n1️⃣ - 🚚 *Entrega* (Taxa de R$ 7,00)\r\n2️⃣ - 🏪 *Retirada no balcão* (Sem taxa)\r\n\r\n*Digite 1 ou 2:*",
            "msgMenuMarmitas": "🍔 *CARDÁPIO BRUTUS BURGER* 🍔\r\n\r\nEscolha seu lanche favorito:\r\n\r\n*1* - Brutus Clássico - R$ 25,00\r\n*2* - Brutus Bacon - R$ 28,00\r\n*3* - Brutus Duplo - R$ 32,00\r\n*4* - Brutus Especial - R$ 35,00\r\n\r\n*Digite o número do lanche desejado*",
            "msgMenuInicial": "🍔 *BRUTUS BURGER* 🍔\r\n\r\nOlá! Como posso ajudá-lo hoje?\r\n\r\n*CARDÁPIO* - Ver nossos lanches\r\n*BEBIDAS* - Ver bebidas disponíveis\r\n*AJUDA* - Falar com atendente\r\n\r\nDigite uma das opções acima!",
            "msgFollowup": "Olá! Notei que você começou um pedido e não respondeu. Precisa de ajuda para finalizar ou quer continuar pedindo?",
            "msgPreparo": "*PONTO DA CARNE:*\r\n\r\n1 - Mal passada\r\n2 - Ao ponto\r\n3 - Bem passada\r\n\r\n*Digite o número da opção desejada.*"
        };
        
        if (fallbackMensagens[prop]) {
            mensagensCache[prop] = fallbackMensagens[prop];
            return fallbackMensagens[prop];
        }
        
            // Retorna valor padrão se não encontrar
            return `[Mensagem ${prop} não encontrada]`;
        }
    });
}

// Proxy padrão para compatibilidade (usa fallback)
const mensagem = createClientMensagem(null);

// Função para forçar atualização do cache
function refreshMensagens() {
    lastCacheUpdate = 0;
    mensagensCache = {};
}

// Não inicializa o cache imediatamente para evitar problemas de ordem de inicialização
// O cache será carregado na primeira chamada da função mensagem()

module.exports = { 
    mensagem,
    createClientMensagem,
    refreshMensagens,
    loadMensagensFromDB
};