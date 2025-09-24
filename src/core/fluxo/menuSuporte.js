const { mensagem } = require('../../utils/mensagens');
const resp = mensagem;

function menuSuporte(msg, idAtual, suporte) {
    switch (suporte) {
        case 'novo':
        case 'pedir':
        case 'Pedir':
        case 'Novo':
            console.log('novoajuda');
            resetCarrinho(idAtual, carrinhoAtual);
            atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
            msg.reply(resp.msgMenuInicial);
            break;
        case 'continuar':
        case 'Continuar':
        case 'volta':
        case 'voltar':
        case 'Voltar':
        case 'Volta':
        case 'v':
            if (carrinhoAtual.status !== 'finalizado') {
                if (carrinhoAtual.carrinho.length === 0) {
                    msg.reply("Seu carrinho está vazio. Vamos começar um novo pedido!\n" + resp.msgMenuMarmitas);
                    atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
                } else {
                    msg.reply(`Seu Carrinho Atualizado:\n${carrinhoView(idAtual)} ${resp.msgmenuInicialSub}`);
                    atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
                }
            } else {
                msg.reply('*Você ja finalizou seu carrinho..* \n' + 'Digite *Novo* para iniciar outro Pedido!.');
            }
            break;
    }
}

module.exports = { menuSuporte };