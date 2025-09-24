const { createClientMensagem } = require('../utils/mensagens');
const { atualizarEnderecoCliente } = require('../services/clienteService');
const { atualizarEstadoDoCarrinho, carrinhoView, stats, valorTotal } = require('../services/carrinhoService');
const { normalizarTexto, limparDescricao } = require('../utils/normalizarTexto');

const axios = require('axios');

// Coordenadas do restaurante (EXEMPLO)
const RESTAURANTE_COORDENADAS = {
    lat: -25.236655,
    lng: -50.601611
};

// Chave da API OpenRouteService (coloque a sua chave real)
// ATENÇÃO: Substitua 'SUA_CHAVE_AQUI' pela sua chave API real do OpenRouteService.
// A chave '5b3ce3597851110001cf6248cfa0914bbad64af78bc4d5aad8b296fb' é de exemplo e pode não funcionar.
const ORS_API_KEY = '5b3ce3597851110001cf6248cfa0914bbad64af78bc4d5aad8b296fb'; // Substitua com sua chave do OpenRouteService

/**
 * Calcula a distância em KM entre o restaurante e o destino usando a API OpenRouteService.
 * @param {number} destinoLat Latitude do destino.
 * @param {number} destinoLng Longitude do destino.
 * @returns {Promise<number>} Distância em KM. Retorna 0 em caso de erro ou resposta inválida.
 */
async function calcularDistanciaKm(destinoLat, destinoLng) {
    try {
        // Verifica se as coordenadas de destino são válidas antes de fazer a requisição
        if (isNaN(destinoLat) || isNaN(destinoLng) || destinoLat === null || destinoLng === null) {
            console.error('Erro: Coordenadas de destino inválidas para calcular distância.');
            return 0; // Retorna 0 se as coordenadas forem inválidas
        }

        const url = 'https://api.openrouteservice.org/v2/directions/driving-car';
        const coords = {
            coordinates: [
                [RESTAURANTE_COORDENADAS.lng, RESTAURANTE_COORDENADAS.lat],
                [destinoLng, destinoLat]
            ]
        };

        const res = await axios.post(url, coords, {
            headers: {
                'Authorization': ORS_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        // Verifica se a resposta tem dados de rota válidos
        if (res.data && res.data.routes && res.data.routes[0] && res.data.routes[0].summary) {
            const metros = res.data.routes[0].summary.distance;
            return metros / 1000; // Converte metros para km
        } else {
            console.error('Erro: Resposta inesperada da API OpenRouteService - sem dados de rota.');
            return 0; // Retorna 0 se não houver dados de rota válidos
        }
    } catch (error) {
        console.error('Erro ao calcular distância com OpenRouteService:', error.message);
        // Pode verificar error.response.data para mais detalhes da API
        if (error.response && error.response.data) {
            console.error('Detalhes do erro da API:', error.response.data);
            // Mensagem mais específica para o cliente se o erro for relevante
            if (error.response.status === 404 || error.response.status === 403) {
                console.error('Verifique sua chave da API OpenRouteService ou o formato da requisição.');
            }
        }
        return 0; // Retorna 0 em caso de erro na API
    }
}

/**
 * Analisa a localização recebida do cliente e calcula os valores de entrega.
 * @param {string} idAtual ID do cliente atual.
 * @param {object} carrinhoAtual Objeto do carrinho do cliente.
 * @param {object} msg Objeto da mensagem do WhatsApp (contém msg.location).
 * @param {object} client Instância do cliente WhatsApp.
 * @param {object} MessageMedia Classe para mídia do WhatsApp.
 */
async function analisarLocalizacao(idAtual, carrinhoAtual, msg, client, MessageMedia, clienteId = 'brutus-burger') {
    const resp = createClientMensagem(clienteId);
    // Garante que lat e lng estão preenchidas antes de chamar calcularDistanciaKm
    if (!carrinhoAtual.lat || !carrinhoAtual.lng) {
        console.error('Erro: Coordenadas do carrinho não preenchidas em analisarLocalizacao.');
        msg.reply('Não foi possível obter sua localização para calcular o frete. Por favor, tente enviar sua localização novamente ou digite seu endereço.');
        carrinhoAtual.valorEntrega = calcularValorEntrega(0); // Aplica taxa mínima
        return;
    }

    // Verifica se a localização está em Imbituva usando geocodificação reversa
    const cidadeValida = await verificarSeEstaEmImbituva(carrinhoAtual.lat, carrinhoAtual.lng);
    
    if (!cidadeValida) {
        msg.reply('❌ *Atendemos apenas em Imbituva!*\n\nSua localização não está em Imbituva, PR. Por favor, digite um endereço em Imbituva ou verifique se sua localização está correta.\n\n_Exemplo: Rua das Flores, 123, Centro, Imbituva_');
        return;
    }

    const distancia = await calcularDistanciaKm(carrinhoAtual.lat, carrinhoAtual.lng);

    let valorEntrega;
    let mensagemParaCliente = '';

    if (distancia === 0) { // Se a distância não pôde ser calculada (erro na API ou coordenadas inválidas)
        console.warn('Distância não pôde ser calculada. Usando valor mínimo de entrega.');
        valorEntrega = calcularValorEntrega(0); // Força o valor mínimo
        mensagemParaCliente += `⚠️ Não foi possível calcular a distância exata. Será cobrado o valor mínimo de entrega.\n\n`;
    } else {
        valorEntrega = calcularValorEntrega(distancia);
        mensagemParaCliente += `*ENTREGAR NA ÚLTIMA LOCALIZAÇÃO ENVIADA?*\n➥ (Localização no mapa)`;
    }

    // Validação de segurança: se o valor da entrega for maior que R$ 100, força R$ 7
    if (valorEntrega > 65) {
        console.log(`Valor de entrega muito alto (R$ ${valorEntrega}). Forçando valor mínimo de R$ 7.`);
        valorEntrega = 7;
    }

    carrinhoAtual.valorEntrega = valorEntrega;

    let totalCarrinho = valorTotal(idAtual);
    let totalGeral = totalCarrinho + carrinhoAtual.valorEntrega;
    carrinhoAtual.valorTotal = totalGeral;

    // CORREÇÃO: Removido o '$' extra na template string
    const linkLocalizacao = `https://www.google.com/maps/search/?api=1&query=${carrinhoAtual.lat},${carrinhoAtual.lng}`;
    mensagemParaCliente += `\nVer no Mapa: ${linkLocalizacao}\n\n`;

    msg.reply(
        `${mensagemParaCliente}` +
        `💸 Taxa de entrega: R$ ${carrinhoAtual.valorEntrega.toFixed(2)}\n` +
        `🛒 *VALOR FINAL*: R$ ${totalGeral.toFixed(2)}\n\n` +
        `Digite *S* para confirmar ou envie outro endereço.`
    );
}

/**
 * Calcula o valor da entrega com base na distância em KM.
 * @param {number} distanciaKm Distância em quilômetros.
 * @returns {number} Valor da entrega.
 */
function calcularValorEntrega(distanciaKm) {
    const valorMinimo = 7;
    const limite = 4; // KM
    const porKm = 2; // Valor por KM excedente
    const valorMaximo = 65; // Valor máximo da entrega

    if (distanciaKm <= limite) {
        return valorMinimo;
    }

    const excedente = distanciaKm - limite;
    const valor = valorMinimo + (excedente * porKm);
    const valorCalculado = Math.round(valor); // arredonda

    // Se o valor calculado for maior que R$ 100, retorna R$ 7 (valor mínimo)
    if (valorCalculado > valorMaximo) {
        console.log(`Valor de entrega muito alto (R$ ${valorCalculado}). Aplicando valor mínimo de R$ ${valorMinimo}.`);
        return valorMinimo;
    }

    return valorCalculado;
}

/**
 * Verifica se as coordenadas fornecidas estão em Imbituva usando geocodificação reversa.
 * @param {number} lat Latitude.
 * @param {number} lng Longitude.
 * @returns {Promise<boolean>} true se estiver em Imbituva, false caso contrário.
 */
async function verificarSeEstaEmImbituva(lat, lng) {
    try {
        const url = `https://api.openrouteservice.org/geocode/reverse`;
        const res = await axios.get(url, {
            params: {
                api_key: ORS_API_KEY,
                'point.lon': lng,
                'point.lat': lat,
                size: 1
            }
        });

        if (res.data && res.data.features && res.data.features.length > 0) {
            const feature = res.data.features[0];
            const endereco = feature.properties.label || '';
            
            // Verifica se o endereço contém "Imbituva"
            if (endereco.toLowerCase().includes('imbituva')) {
                console.log(`Localização válida em Imbituva: ${endereco}`);
                return true;
            } else {
                console.log(`Localização fora de Imbituva: ${endereco}`);
                return false;
            }
        }
        
        console.warn('Geocodificação reversa não retornou resultados.');
        return false;
    } catch (error) {
        console.error('Erro na verificação de cidade:', error.message);
        // Em caso de erro na API, assume que está em Imbituva para não bloquear o serviço
        return true;
    }
}

/**
 * Lida com a entrada do endereço do cliente (texto ou localização).
 * @param {string} idAtual ID do cliente atual.
 * @param {object} carrinhoAtual Objeto do carrinho do cliente.
 * @param {string|object} entrega Mensagem do cliente (endereço texto ou objeto de localização).
 * @param {object} msg Objeto da mensagem do WhatsApp.
 */
async function analisarEndereço(idAtual, carrinhoAtual, entrega, msg, clienteId = 'brutus-burger') {
    const resp = createClientMensagem(clienteId);
    const LIMITE_KM_ENTREGA = 70; // Define um limite máximo para a distância de entrega

    const entregaNormalizada = typeof entrega === 'string' ? normalizarTexto(entrega) : '';

    // Lida com comandos de confirmação
    if (['s', 'sim', 'a', 'isso', 'correto'].includes(entregaNormalizada)) {
        carrinhoAtual.entregaConfirmada = true;
        carrinhoAtual.entrega = true;

        atualizarEnderecoCliente(idAtual, carrinhoAtual.endereco, carrinhoAtual.lat, carrinhoAtual.lng, clienteId);
        msg.reply(`${resp.msgObs}`);
        // Só atualiza o estado para confirmação do pedido se não estiver finalizado
        try {
            const menuFinalizadoStat = (typeof stats !== 'undefined' && stats.menuFinalizado) ? stats.menuFinalizado : 'finalizado';
            if (!carrinhoAtual.estado || String(carrinhoAtual.estado) !== String(menuFinalizadoStat)) {
                atualizarEstadoDoCarrinho(idAtual, stats.menuConfirmandoPedido);
            } else {
                console.log(`[INFO] Carrinho ${idAtual} já estava em estado finalizado; não alterando estado.`);
            }
        } catch (e) { try { atualizarEstadoDoCarrinho(idAtual, stats.menuConfirmandoPedido); } catch (ee) {} }
        return; // Sai da função após o tratamento
    }

    // Lida com comandos de "voltar"
    if (['voltar', 'v', 'volta', 'retornar'].includes(entregaNormalizada)) {
        msg.reply(carrinhoView(idAtual) + resp.msgmenuInicialSub);
        atualizarEstadoDoCarrinho(idAtual, stats.menuInicial);
        return; // Sai da função após o tratamento
    }

    // Lida com mensagem de localização
    if (msg.type === 'location') {
        const { latitude, longitude } = msg.location;
        console.log(`Localização recebida: ${latitude}, ${longitude}`);

        // Verifica se a localização está em Imbituva
        const cidadeValida = await verificarSeEstaEmImbituva(latitude, longitude);
        
        if (!cidadeValida) {
            msg.reply('❌ *Atendemos apenas em Imbituva!*\n\nSua localização não está em Imbituva, PR. Por favor, digite um endereço em Imbituva.\n\n_Exemplo: Rua das Flores, 123, Centro, Imbituva_');
            return;
        }

        carrinhoAtual.lat = latitude;
        carrinhoAtual.lng = longitude;
        carrinhoAtual.endereco = 'LOCALIZAÇÃO'; // Endereço genérico quando vem de localização

        // Calcula distância
        const distanciaKm = await calcularDistanciaKm(latitude, longitude);

        let valorEntrega;
        let mensagemParaCliente = `📦 *Entrega com base na sua localização*\n`;

        if (distanciaKm === 0) {
            valorEntrega = calcularValorEntrega(0); // Força o mínimo
            mensagemParaCliente += `⚠️ Não foi possível calcular a distância exata. Será cobrado o valor mínimo de entrega.\n\n`;
        } else if (distanciaKm > LIMITE_KM_ENTREGA) {
            valorEntrega = calcularValorEntrega(0); // Força o valor mínimo para distâncias muito longas
            mensagemParaCliente += `⚠️ A distância para sua localização é muito longa (${distanciaKm.toFixed(1)} km). Será cobrado o valor mínimo de entrega.\n\n`;
        } else {
            valorEntrega = calcularValorEntrega(distanciaKm);
        }

        // Validação de segurança: se o valor da entrega for maior que R$ 100, força R$ 7
        if (valorEntrega > 100) {
            console.log(`Valor de entrega muito alto (R$ ${valorEntrega}). Forçando valor mínimo de R$ 7.`);
            valorEntrega = 7;
        }

        carrinhoAtual.valorEntrega = valorEntrega;

        // CORREÇÃO: Removido o '$' extra na template string
        const linkLocalizacao = `https://www.google.com/maps/search/?api=1&query=${carrinhoAtual.lat},${carrinhoAtual.lng}`;
        mensagemParaCliente += `Ver no Mapa: ${linkLocalizacao}\n\n`;

        msg.reply(
            `${mensagemParaCliente}` +
            `💸 Valor da entrega: *R$ ${valorEntrega.toFixed(2)}*\n\n` +
            `_Se estiver tudo certo, digite *S* para confirmar._`
        );
    } else {
        // Lida com endereço de texto
        console.log(`Endereço de texto recebido: ${entrega}`);
        carrinhoAtual.endereco = entrega; // Armazena o endereço de texto

        // Tenta geocodificar o endereço de texto
        const geocodeResult = await geocodificarEnderecoORS(entrega);

        let distanciaKm = 0; // Inicializa com 0 para caso de falha
        let valorEntrega = calcularValorEntrega(0); // Valor mínimo por padrão
        let mensagemParaCliente = `${resp.msgEnderecoConfirma} \n➥ _${carrinhoAtual.endereco}_\n\n`;

        if (geocodeResult) {
            carrinhoAtual.lat = geocodeResult.lat;
            carrinhoAtual.lng = geocodeResult.lng;
            //rrinhoAtual.endereco = geocodeResult.formatted_address || entrega; // Usa endereço formatado se disponível

            distanciaKm = await calcularDistanciaKm(carrinhoAtual.lat, carrinhoAtual.lng);

            if (distanciaKm === 0) {
                   mensagemParaCliente += `⚠️ Por favor, se estiver em área rural, envie sua *LOCALIZAÇÃO* do WhatsApp.\n\n`;
            } else if (distanciaKm > LIMITE_KM_ENTREGA) {
                valorEntrega = 7; // Força o valor mínimo por ser em xique xique bahia (comentário original)
                mensagemParaCliente += `⚠️ Por favor, se estiver em área rural, envie sua *LOCALIZAÇÃO* do WhatsApp.\n\n`;
            } else {
                valorEntrega = calcularValorEntrega(distanciaKm);
            }
        } else {
            carrinhoAtual.lat = null; // Garante que não há coordenadas inválidas
            carrinhoAtual.lng = null;
            mensagemParaCliente += `❌ *Atendemos apenas em Imbituva!*\n\nO endereço informado não foi encontrado em Imbituva. Por favor:\n• Verifique se digitou o endereço corretamente\n• Inclua rua, número e bairro\n• Ou envie sua *LOCALIZAÇÃO* do WhatsApp\n\n_Exemplo: Rua das Flores, 123, Centro_\n\n`;
        }

        // Validação de segurança: se o valor da entrega for maior que R$ 65, força R$ 7
        if (valorEntrega > 65) {
            console.log(`Valor de entrega muito alto (R$ ${valorEntrega}). Forçando valor mínimo de R$ 7.`);
            valorEntrega = 7;
        }

        carrinhoAtual.valorEntrega = valorEntrega;
        let totalCarrinho = valorTotal(idAtual);
        let totalGeral = totalCarrinho + carrinhoAtual.valorEntrega;
        carrinhoAtual.valorTotal = totalGeral;

        msg.reply(
            `${mensagemParaCliente}` +
            `💸 Taxa de entrega: R$ ${carrinhoAtual.valorEntrega.toFixed(2)}\n` +
            `🛒 *VALOR FINAL*: R$ ${totalGeral.toFixed(2)}\n\n` +
            `Digite *S* para confirmar ou envie outro endereço.`
        );
    }

    // Sempre mantém o estado para entrada de endereço, seja uma nova tentativa ou uma confirmação
    atualizarEstadoDoCarrinho(idAtual, stats.menuEndereço);
}

/**
 * Geocodifica um endereço de texto usando a API OpenRouteService.
 * Restrito apenas para endereços em Imbituva, PR.
 * @param {string} endereco O endereço de texto a ser geocodificado.
 * @returns {Promise<object|null>} Objeto com lat, lng e formatted_address, ou null em caso de falha.
 */
async function geocodificarEnderecoORS(endereco) {
    try {
        // Normaliza o endereço e adiciona "Imbituva, PR" se não estiver presente
        const enderecoNormalizado = limparDescricao(endereco);
        let enderecoCompleto = endereco;
        if (!enderecoNormalizado.includes('imbituva')) {
            enderecoCompleto = `${endereco}, Imbituva, PR, Brasil`;
        }

        const url = `https://api.openrouteservice.org/geocode/search`;
        const res = await axios.get(url, {
            params: {
                api_key: ORS_API_KEY,
                text: enderecoCompleto,
                size: 5, // Aumenta para 5 resultados para verificar se algum é de Imbituva
            }
        });

        if (res.data && res.data.features && res.data.features.length > 0) {
            // Procura por um resultado que seja especificamente de Imbituva
            for (const feature of res.data.features) {
                const coords = feature.geometry.coordinates; // [lng, lat]
                const formatted = feature.properties.label || '';
                
                // Verifica se o endereço geocodificado é realmente de Imbituva
                const formattedNormalizado = normalizarTexto(formatted);
                if (formattedNormalizado.includes('imbituva')) {
                    return {
                        lat: coords[1],
                        lng: coords[0],
                        formatted_address: formatted
                    };
                }
            }
            
            // Se chegou aqui, nenhum resultado foi de Imbituva
            console.warn(`Endereço "${endereco}" não encontrado em Imbituva.`);
            return null;
        }
        console.warn(`Geocodificação para "${endereco}" não encontrou resultados.`);
        return null;
    } catch (error) {
        console.error('Erro na geocodificação ORS:', error.message);
        if (error.response && error.response.data) {
            console.error('Detalhes do erro da API de Geocodificação:', error.response.data);
            if (error.response.status === 404 || error.response.status === 403) {
                console.error('Verifique sua chave da API OpenRouteService ou o formato da requisição de geocodificação.');
            }
        }
        return null;
    }
}

module.exports = { analisarEndereço, calcularDistanciaKm, calcularValorEntrega, geocodificarEnderecoORS, analisarLocalizacao, verificarSeEstaEmImbituva };
