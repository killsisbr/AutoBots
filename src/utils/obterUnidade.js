const { stats } = require('../services/carrinhoService');
const { atualizarEstadoDoCarrinho } = require('../services/carrinhoService');
const { resp } = require('./mensagens');

async function obterUnidade(msg, carrinhoAtual, unidade, idAtual) {
    console.log('Puxando unidade:', unidade);
    if (!isNaN(unidade)) {
        console.log(unidade);
        carrinhoAtual.quantidade = unidade;
        atualizarEstadoDoCarrinho(idAtual, stats.menuDescrição);
        msg.reply(resp.msgPreparo);
    } else {
        if (carrinhoAtual.alertUnidade === undefined) {
            carrinhoAtual.alertUnidade = 0;
        }

        switch (carrinhoAtual.alertUnidade) {
            case 0:
                carrinhoAtual.alertUnidade = 1;
                break;
            case 1:
                msg.reply('Digite um valor *NUMÉRICO*, de *QUANTIDADE*!');
                carrinhoAtual.alertUnidade = 2;
                //console.log('1' +carrinhoAtual.alertUnidade);
                break;
            case 2:
                carrinhoAtual.alertUnidade = 3;
                //console.log('2' +carrinhoAtual.alertUnidade);
                msg.reply('Olá, digite um numero como 1 2 3, para referenciar a *QUANTIDADE*');
                break;
            case 3:
                carrinhoAtual.alertUnidade = 4;
                //console.log('3' +carrinhoAtual.alertUnidade);
                msg.reply('Olá, digite um numero como 1 2 3, para referenciar a *QUANTIDADE*');
                // ajuda(idAtual);
                break;
        }
    }
}

module.exports = {
    obterUnidade,
};