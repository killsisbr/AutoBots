const { carrinhoView, atualizarEstadoDoCarrinho, obterCarrinho } = require('../../services/carrinhoService');
const { stats } = require('../../services/carrinhoService');
const { retiradaBalcaoConfig } = require('../../utils/config');
const resp = require('../../utils/mensagens');
const esperarResposta = require('../../utils/obterResposta').esperarResposta;

/**
 * Menu para escolha entre entrega e retirada no balcão
 * @param {string} idAtual - ID do cliente
 * @param {object} carrinhoAtual - Carrinho atual do cliente
 * @param {object} msg - Objeto da mensagem do WhatsApp
 * @param {object} client - Cliente do WhatsApp
 */
async function menuEntregaRetirada(idAtual, carrinhoAtual, msg, client) {
    const msgTexto = await esperarResposta(carrinhoAtual);
    
    // Opção 1 - Entrega
    if (msgTexto === '1' || msgTexto === 'entrega') {
        // Marca como entrega
        carrinhoAtual.entrega = true;
        carrinhoAtual.retirada = false;
        
        // Vai para o menu de endereço
        atualizarEstadoDoCarrinho(idAtual, stats.menuEndereço);
        
        // Verifica se já tem endereço salvo
        if (carrinhoAtual.endereco) {
            const enderecoTexto = typeof carrinhoAtual.endereco === 'string' 
                ? carrinhoAtual.endereco 
                : `${carrinhoAtual.endereco.endereco || 'Localização'} (${carrinhoAtual.lat}, ${carrinhoAtual.lng})`;
            
            msg.reply(`🚚 *Entrega selecionada!*\n\nEndereço salvo: ${enderecoTexto}\n\n*S* - Confirmar este endereço\n*N* - Digitar novo endereço`);
        } else {
            msg.reply('🚚 *Entrega selecionada!*\n\nPor favor, digite seu endereço completo para calcularmos a taxa de entrega:');
        }
        return;
    }
    
    // Opção 2 - Retirada no balcão
    if (msgTexto === '2' || msgTexto === 'retirada' || msgTexto === 'balcao' || msgTexto === 'balcão') {
        // Marca como retirada
        carrinhoAtual.entrega = false;
        carrinhoAtual.retirada = true;
        carrinhoAtual.valorEntrega = 0; // Zera taxa de entrega
        
        // Vai direto para confirmação do pedido
        atualizarEstadoDoCarrinho(idAtual, stats.menuConfirmandoPedido);
        
        const valorTotal = carrinhoAtual.carrinho.reduce((total, item) => total + (item.valor * item.quantidade), 0);
        carrinhoAtual.valorTotal = valorTotal;
        
        msg.reply(`🏪 *Retirada no balcão selecionada!*\n\n${carrinhoView(idAtual)}\n\n*Confirmar pedido?*\n*S* - Sim, confirmar\n*N* - Não, voltar ao carrinho`);
        return;
    }
    
    // Opção inválida
    msg.reply(`❌ Opção inválida!\n\n${retiradaBalcaoConfig.mensagem}\n\nDigite *1* ou *2*:`);
}

module.exports = menuEntregaRetirada;