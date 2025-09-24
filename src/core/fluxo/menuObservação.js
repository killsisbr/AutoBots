const { createClientMensagem } = require('../../utils/mensagens');
const { adicionarItemAoCarrinho, atualizarEstadoDoCarrinho, salvarPedido, carrinhoAdm, carrinhoView, stats } = require('../../services/carrinhoService');
const { obterInformacoesCliente } = require('../../services/clienteService');
const idChatGrupo = require('../../utils/config').idChatGrupo;


async function obterObservacao(idAtual, carrinhoAtual, observacao, msg, client, clienteId = 'brutus-burger') {
    const resp = createClientMensagem(clienteId);
    if (observacao.toLowerCase() === 'voltar') { // Corrected to use function call .toLowerCase()
        if (carrinhoAtual.status !== 'finalizado') {
            if (carrinhoAtual.carrinho.length === 0) {
                msg.reply("Seu carrinho está vazio. Vamos começar um novo pedido!");
                msg.reply(resp.msgMenuMarmitas);
                atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
            } else {
                let mensagemCarrinhoAtualizada = carrinhoAtual.carrinho.map(item => `${item.quantidade}x ${item.nome} ${item.preparo}`).join('\n');
                msg.reply(`Seu Carrinho Atualizado:\n${mensagemCarrinhoAtualizada} \n${resp.msgmenuInicialSub}`);
                atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
            }
        } else {
            msg.reply('Você já finalizou seu pedido, pode pedir novamente: \nDigite *Novo*');
        }
        return; // Exit the function after handling 'voltar'
    }

    carrinhoAtual.observacaoConfirmada = true;
    carrinhoAtual.observacao = observacao;
    
    // Atualizar status para finalizado e localização para retirada na confirmação
    carrinhoAtual.status = 'finalizado';
    carrinhoAtual.retirada = true;

    // Extrair apenas o número do WhatsApp (remover @c.us)
    const numeroLimpo = idAtual.replace('@c.us', '');
    
    obterInformacoesCliente(numeroLimpo, (err, dados) => {
        // First, check for an error returned by obterInformacoesCliente
        if (err) {
            console.error("Error obtaining client information:", err);
            msg.reply("Ocorreu um erro ao buscar suas informações. Por favor, tente novamente.");
            // Decide what state to set here, perhaps back to asking for name or initial menu
            atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
            return;
        }

        // Now, safely check if 'dados' is null or undefined before accessing properties
        if (dados && dados.nome) { // This safely checks if dados is not null/undefined AND if dados.nome exists
            carrinhoAtual.nome = dados.nome;
            
            // CORREÇÃO: Sempre perguntar forma de pagamento antes de finalizar
            msg.reply(`${resp.msgFormaDePagamento}`);
            atualizarEstadoDoCarrinho(idAtual, stats.menuPagamento);
        } else {
            // If 'dados' is null/undefined or 'dados.nome' is missing
            msg.reply(`${resp.msgPedindoNome}`);
            atualizarEstadoDoCarrinho(idAtual, stats.menuNome);
        }
    }, clienteId);
}

module.exports = { obterObservacao };