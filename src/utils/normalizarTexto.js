/**
 * Utilitário para normalização consistente de texto em todo o sistema
 * Centraliza as regras de limpeza e formatação de strings
 */

/**
 * Normaliza texto removendo pontuação, convertendo para minúsculas e removendo espaços extras
 * @param {string} texto - Texto a ser normalizado
 * @returns {string} - Texto normalizado
 */
function normalizarTexto(texto) {
  if (!texto || typeof texto !== 'string') {
    return '';
  }
  
  return String(texto)
    .toLowerCase()
    .replace(/[\-]/g, ' ')    // Substitui hífens por espaços
    .replace(/[.,!?]/g, '')   // Remove pontuação
    .replace(/\s+/g, ' ')     // Substitui múltiplos espaços por um único
    .trim();                  // Remove espaços no início e fim
}

/**
 * Normaliza texto para busca, removendo também stopwords comuns
 * @param {string} texto - Texto a ser normalizado
 * @returns {string} - Texto normalizado para busca
 */
function normalizarParaBusca(texto) {
  const textoNormalizado = normalizarTexto(texto);
  
  // Stopwords comuns que podem ser removidas em buscas
  const stopwords = ['um', 'uma', 'o', 'a', 'de', 'do', 'da', 'em', 'no', 'na', 'por', 'pra', 'praç', 'e'];
  
  return textoNormalizado
    .split(' ')
    .filter(palavra => palavra && !stopwords.includes(palavra))
    .join(' ');
}

/**
 * Limpa descrição removendo palavras irrelevantes para o contexto do restaurante
 * @param {string} descricao - Descrição a ser limpa
 * @returns {string} - Descrição limpa
 */
function limparDescricao(descricao) {
  if (!descricao || typeof descricao !== 'string') {
    return '';
  }
  
  // Palavras irrelevantes para descrições de produtos
  const palavrasIrrelevantes = [
    'uma', 'um', 'de', 'brutus', 'entregar', 'casa', 'aqui', 'zero',
    'porçã', 'porç', 'porção', 'pocao', 'entrega', 'e', 'o', 'com',
    'coca', 'lata', 'guarana', 'guárana', 'guaraná', 'coca-cola',
    'cola', 'garaná', '-', 'da', 'do', 'grande', 'gelada'
  ];
  
  // Criar regex para remover todas as palavras irrelevantes de uma vez
  const regexPalavrasIrrelevantes = new RegExp(
    '\\b(' + palavrasIrrelevantes.join('|') + ')\\b',
    'gi'
  );
  
  return normalizarTexto(descricao)
    .replace(regexPalavrasIrrelevantes, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Separa mensagem em palavras normalizadas
 * @param {string} mensagem - Mensagem a ser separada
 * @returns {string[]} - Array de palavras normalizadas
 */
function separarMensagem(mensagem) {
  if (!mensagem || typeof mensagem !== 'string') {
    return [];
  }
  
  return mensagem
    .toLowerCase()
    .replace(/\bmarmita\b/g, '') // Remove palavra específica 'marmita'
    .replace(/[.,]/g, '')       // Remove pontuação específica
    .split(/\s+/)               // Separa por espaços
    .filter(palavra => palavra); // Remove strings vazias
}

/**
 * Gera todas as combinações possíveis de palavras até um tamanho máximo
 * @param {string[]} palavras - Array de palavras
 * @param {number} tamanhoMaximo - Tamanho máximo das combinações (padrão: 4)
 * @returns {string[]} - Array de combinações ordenadas por especificidade (mais longas primeiro)
 */
function gerarCombinacoesPalavras(palavras, tamanhoMaximo = 4) {
  if (!Array.isArray(palavras) || palavras.length === 0) {
    return [];
  }
  
  const combinacoes = [];
  
  for (let i = 0; i < palavras.length; i++) {
    for (let tamanho = Math.min(tamanhoMaximo, palavras.length - i); tamanho >= 1; tamanho--) {
      const combinacao = palavras.slice(i, i + tamanho).join(' ');
      if (combinacao.trim()) {
        combinacoes.push({
          texto: combinacao.trim(),
          tamanho: tamanho,
          indice: i
        });
      }
    }
  }
  
  // Ordenar por tamanho (mais específicas primeiro) e depois por índice
  return combinacoes
    .sort((a, b) => {
      if (a.tamanho !== b.tamanho) {
        return b.tamanho - a.tamanho; // Maior tamanho primeiro
      }
      return a.indice - b.indice; // Menor índice primeiro em caso de empate
    })
    .map(combo => combo.texto);
}

/**
 * Encontra o melhor match em um mapeamento priorizando especificidade
 * @param {string} entrada - Texto de entrada
 * @param {Object} mapeamentos - Objeto com mapeamentos {chave: valor}
 * @returns {Object|null} - {chave, valor, tamanho} do melhor match ou null
 */
function encontrarMelhorMatch(entrada, opcoes) {
  if (!entrada || !Array.isArray(opcoes) || opcoes.length === 0) {
    return null;
  }
  
  const entradaNormalizada = normalizarTexto(entrada);
  let melhorMatch = null;
  let melhorScore = 0;
  
  opcoes.forEach((opcao, index) => {
    const opcaoNormalizada = normalizarTexto(opcao);
    
    // Calcular score baseado em correspondência de palavras
    const palavrasEntrada = entradaNormalizada.split(' ');
    const palavrasOpcao = opcaoNormalizada.split(' ');
    
    let matches = 0;
    palavrasEntrada.forEach(palavra => {
      if (palavrasOpcao.includes(palavra)) {
        matches++;
      }
    });
    
    const score = matches / Math.max(palavrasEntrada.length, palavrasOpcao.length);
    
    if (score > melhorScore) {
      melhorScore = score;
      melhorMatch = { index, score, opcao };
    }
  });
  
  return melhorMatch;
}

module.exports = {
  normalizarTexto,
  normalizarParaBusca,
  limparDescricao,
  separarMensagem,
  gerarCombinacoesPalavras,
  encontrarMelhorMatch
};