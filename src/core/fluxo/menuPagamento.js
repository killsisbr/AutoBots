const { createClientMensagem } = require('../../utils/mensagens');
const { chavepix, idChatGrupo } = require('../../utils/config');
const { adicionarItemAoCarrinho, atualizarEstadoDoCarrinho, valorTotal, carrinhoAdm, salvarPedido, stats } = require('../../services/carrinhoService');
const { obterInformacoesCliente } = require('../../services/clienteService');


function menuPagamento(idAtual, carrinhoAtual, formaDePagamento, msg, client, clienteId = 'brutus-burger') {
    const resp = createClientMensagem(clienteId);
    switch (formaDePagamento) {
        case 'Dinheiro':
        case 'dinheiro':
        case '1': //dinheiro //pergutar se precisa de troco
            msg.reply(resp.msgTroco);
            atualizarEstadoDoCarrinho(idAtual, stats.menuTroco);
            break;
        case 'pix':
        case 'Pix':
        case '2': //pix
            carrinhoAtual.formaDePagamento = 'PIX';
            carrinhoAtual.formaDePagamentoConfirmada = true;
            msg.reply(`*PEDIDO ANOTADO* ✍🏻\n ${carrinhoAtual.nome}, ${resp.msgPedidoAnotado} \nChave pix: ${resp.msgChavePix}`);
            client.sendMessage(idChatGrupo, `${carrinhoAdm(idAtual)}Pagamento: *PIX*`);
                // Gera o PDF e tenta imprimir, e marca o pedido como finalizado
                salvarPedido(idAtual, carrinhoAtual.endereco, clienteId);
                try { atualizarEstadoDoCarrinho(idAtual, stats.menuFinalizado); } catch (e) {}
            break;
        case 'cartão':
        case 'debito':
        case 'credito':
        case 'cartao':
        case 'Cartão':
        case 'cartão':
        case 'Debito':
        case 'Débito':
        case '3': //cartao
            carrinhoAtual.formaDePagamento = 'CARTÃO';
            carrinhoAtual.formaDePagamentoConfirmada = true;
            client.sendMessage(idChatGrupo, `${carrinhoAdm(idAtual)}Pagamento: *CARTÃO*`);
            msg.reply(`*PEDIDO ANOTADO* ✍🏻\n ${carrinhoAtual.nome}, ${resp.msgPedidoAnotado}`);
                // Gera o PDF e tenta imprimir, e marca o pedido como finalizado
                salvarPedido(idAtual, carrinhoAtual.endereco, clienteId);
                try { atualizarEstadoDoCarrinho(idAtual, stats.menuFinalizado); } catch (e) {}
            break;
        case 'voltar':
        case 'Voltar':
        case 'v':
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
                msg.reply('Você ja finalizou seu pedido, pode pedir novamente: \nDigite *Novo*');
            }
            break;
    }
}

module.exports = { menuPagamento };