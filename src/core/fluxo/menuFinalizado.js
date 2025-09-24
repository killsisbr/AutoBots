const { mensagem } = require('../../utils/mensagens');
const resp = mensagem;
const idChatGrupo = require('../../utils/config').idChatGrupo;
const { resetCarrinho, atualizarEstadoDoCarrinho, carrinhoView, stats } = require('../../services/carrinhoService');

function menuFinalizado(idAtual, carrinhoAtual, msg, msgfinal, client) {
    switch (msgfinal) {
        case 'pix':
        case 'Pix':
        case '2': //pix
            msg.reply(`*Chave pix:* ${resp.msgChavePix}`);
            break;
        case 'Help':
        case 'ajuda':
        case 'Ajuda':
            atualizarEstadoDoCarrinho(idAtual, stats.menuSuporte);
            msg.reply(resp.msgAjuda);
            client.sendMessage(idChatGrupo, `*Cliente pedindo ajuda !!*\nWa.me/${idAtual}`);
            break;
        case 'reiniciar':
        case 'novo':
        case 'Novo':
            resetCarrinho(idAtual, carrinhoAtual);
            if (carrinhoAtual.carrinho.length === 0) {
                msg.reply('Seu carrinho foi reiniciado. \n' + resp.msgmenuInicialSub);
            } else {
                msg.reply(`${carrinhoView(idAtual)}\n${resp.msgmenuInicialSub}`);
            }
            break;

    }
}

module.exports = { menuFinalizado };