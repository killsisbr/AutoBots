const { mensagem } = require('../../utils/mensagens');
const resp = mensagem;
const idChatGrupo = require('../../utils/config').idChatGrupo;
const { atualizarEstadoDoCarrinho, salvarPedido, carrinhoAdm, valorTotal } = require('../../services/carrinhoService');
const cmdNAO = ['N', 'n', 'Não', 'nao', 'não', 'Nao'];
const stats = require('../../services/carrinhoService').stats;

function menuTroco(idAtual, carrinhoAtual, troco, msg, client, clienteId = 'brutus-burger') {
    if (cmdNAO.includes(troco)) {
        client.sendMessage(idChatGrupo, `${carrinhoAdm(idAtual)} Pagamento: *DINHEIRO - S/Troco*`);
        carrinhoAtual.formaDePagamentoConfirmada = true;
        msg.reply(`*PEDIDO ANOTADO* ✍🏻\n ${carrinhoAtual.nome}, ${resp.msgPedidoAnotado}`);
    carrinhoAtual.formaDePagamento = 'Tem trocado.';
    // Não gerar/imprimir PDF automaticamente; impressão manual via painel
    atualizarEstadoDoCarrinho(idAtual, stats.menuFinalizado);
    } else {
        // Verifica se troco é um número válido
        if (isNaN(troco) || troco <= 0) {
            msg.reply(`*OPS, VALOR INVÁLIDO.*\n\n_Tente novamente com um valor válido._`);
            return;
        }

        // Verifica se o troco é menor que o valor total
        if (troco < valorTotal(idAtual)) {
            msg.reply(`*OPS, OS VALORES NÃO BATEM.*\n\n_Seu pedido ficou em_ R$${valorTotal(idAtual)}.\n${resp.msgMenuPagamento}`);
            atualizarEstadoDoCarrinho(idAtual, stats.menuPagamento);
            return;
        } else {
            client.sendMessage(idChatGrupo, `${carrinhoAdm(idAtual)} Pagamento: *Dinheiro - Troco p/${troco}* (${troco - valorTotal(idAtual)})`);
            carrinhoAtual.formaDePagamento = `TROCO p ${troco}`;
            carrinhoAtual.formaDePagamentoConfirmada = true;
            msg.reply(`*PEDIDO ANOTADO* ✍🏻\n ${carrinhoAtual.nome}, ${resp.msgPedidoAnotado}`);
            // Não gerar/imprimir PDF automaticamente; impressão manual via painel
            atualizarEstadoDoCarrinho(idAtual, stats.menuFinalizado);
        }
    }
}

module.exports = { menuTroco };
