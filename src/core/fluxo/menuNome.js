const { atualizarEstadoDoCarrinho,carrinhoAdm, salvarPedido, valorTotal, stats } = require('../../services/carrinhoService');
const { adicionarCliente } = require('../../services/clienteService');
const { createClientMensagem } = require('../../utils/mensagens');
const idChatGrupo = require('../../utils/config').idChatGrupo;



async function menuNome(idAtual, carrinhoAtual, msg, nome, client, clienteId = 'brutus-burger') {
    const resp = createClientMensagem(clienteId);
    
    // Extrair apenas o número do WhatsApp (remover @c.us)
    const numeroLimpo = idAtual.replace('@c.us', '');
    
    carrinhoAtual.nome = nome;
    
    if (carrinhoAtual.endereco) {
        // Cliente com endereço (entrega)
        adicionarCliente(numeroLimpo, nome, carrinhoAtual.endereco, null, null, clienteId);
    } else {
        // Cliente sem endereço (retirada)
        adicionarCliente(numeroLimpo, nome, null, null, null, clienteId);
    }
    
    // SEMPRE perguntar forma de pagamento, seja entrega ou retirada
    msg.reply(`*VALOR TOTAL: ${valorTotal(idAtual)} REAIS.*\n${resp.msgFormaDePagamento}`);
    atualizarEstadoDoCarrinho(idAtual, stats.menuPagamento);
}


module.exports = { menuNome };