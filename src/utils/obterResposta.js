
function esperarResposta(carrinhoAtual) {
    return new Promise((resolve, reject) => {
        let tentativas = 0;
        const maxTentativas = 10; // Máximo 10 tentativas (50 segundos)
        
        let aguardarResposta = () => {
            tentativas++;
            
            // Suponha que 'respostaUsuario' seja a resposta do usuário
            let respostaUsuario = carrinhoAtual.respUser || carrinhoAtual.lastMsg;
            try {
                // Log debug information to understand why responses may be missing or malformed
                if (respostaUsuario) {
                    console.log(`[DEBUG][esperarResposta] encontrada resposta para carrinho ${carrinhoAtual && (carrinhoAtual.id||carrinhoAtual.numero || carrinhoAtual.cliente) ? (carrinhoAtual.id||carrinhoAtual.numero || carrinhoAtual.cliente) : '(unknown)'} -> '${String(respostaUsuario).replace(/\n/g,'\\n')}'`);
                } else {
                    console.log(`[DEBUG][esperarResposta] sem resposta ainda para carrinho ${carrinhoAtual && (carrinhoAtual.id||carrinhoAtual.numero || carrinhoAtual.cliente) ? (carrinhoAtual.id||carrinhoAtual.numero || carrinhoAtual.cliente) : '(unknown)'} - tentativas=${tentativas}`);
                }
            } catch(e) {}
  
            if (respostaUsuario) {
                resolve(respostaUsuario);
            } else if (tentativas >= maxTentativas) {
                // Timeout após máximo de tentativas
                console.warn('Timeout na esperarResposta para carrinho:', carrinhoAtual);
                resolve(carrinhoAtual.lastMsg || ''); // Resolve com lastMsg ou string vazia
            } else {
                // Se a resposta do usuário não estiver disponível, esperar e verificar novamente
                setTimeout(aguardarResposta, 5000); // Verificar a cada 5 segundos
            }
        };
        aguardarResposta(); // Iniciar o processo de espera
    });
  }
  

  module.exports = {
    esperarResposta,
  }