const { mensagem } = require('../../utils/mensagens');
const resp = mensagem;


const { atualizarEstadoDoCarrinho, carrinhoView, stats } = require('../../services/carrinhoService');


function menuAdicionais(idAtual, carrinhoAtual, adicional, msg) {
    switch (adicional) {
        case 'maionese':
        case 'Maionese':
        case '1':
            carrinhoAtual.idSelect = 52;
            msg.reply(resp.msgQuantidade);
            atualizarEstadoDoCarrinho(idAtual, stats.menuQuantidadeAdicionais);
            break;
        case 'salada':
        case 'Salada':
        case '2':
            carrinhoAtual.idSelect = 53;
            msg.reply(resp.msgQuantidade);
            atualizarEstadoDoCarrinho(idAtual, stats.menuQuantidadeAdicionais);
            break;
        case 'salada':
        case 'Salada':
        case '2':
            carrinhoAtual.idSelect = 53;
            msg.reply(resp.msgQuantidade);
            atualizarEstadoDoCarrinho(idAtual, stats.menuQuantidadeAdicionais);
            break;
        case 'sobremesa':
        case '3':
            carrinhoAtual.idSelect = 54;
            msg.reply(resp.msgQuantidade);
            atualizarEstadoDoCarrinho(idAtual, stats.menuQuantidadeAdicionais);
            break;
        case 'c':
        case 'C':
        case 'cancelar':
        case 'Cancelar':
            if (carrinhoAtual.carrinho.length > 0) {
                carrinhoAtual.carrinho.pop();
                let mensagemCarrinhoAtualizada = carrinhoAtual.carrinho.map(item => `${item.quantidade}x ${item.item.nome} ➥ ${item.preparo}`).join('\n');
                if (carrinhoAtual.carrinho.length === 0) {
                    msg.reply('Seu carrinho está vazio. \n' + msgMenuInicial);
                } else {
                    msg.reply(`Seu Carrinho Atualizado:\n${mensagemCarrinhoAtualizada} \n${resp.msgmenuInicialSub}`);
                }
            } else {
                msg.reply('Seu carrinho está vazio. ' + msgMenuInicial);
            }
            break;
        case 'n':
        case 'N':
        case 'Não':
        case 'Nao':
        case 'não':
        case 'voltar':
        case 'v':
        case 'volta':
        case 'retornar':
            msg.reply(carrinhoView(idAtual) + resp.msgmenuInicialSub);
            atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
            break;
    }
}

module.exports = { menuAdicionais };