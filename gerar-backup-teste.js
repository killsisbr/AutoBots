#!/usr/bin/env node

/**
 * Script para gerar backup de mapeamentos para teste
 * Conecta no banco e exporta os mapeamentos atuais
 */

const path = require('path');
const fs = require('fs');

// Importar o serviço de cardápio
const cardapioService = require('./src/services/cardapioService');

async function gerarBackupTeste() {
  try {
    console.log('🔄 Gerando backup de teste dos mapeamentos...');
    
    const restaurantId = 'brutus-burger';
    
    // Criar mapeamentos de exemplo sempre
    const exemploMappings = [
      { item_id: 1, palavra_chave: 'big' },
      { item_id: 1, palavra_chave: 'brutus' },
      { item_id: 1, palavra_chave: 'hamburguer' },
      { item_id: 2, palavra_chave: 'brutal' },
      { item_id: 3, palavra_chave: 'xburger' },
      { item_id: 4, palavra_chave: 'coca' },
      { item_id: 4, palavra_chave: 'refrigerante' },
      { item_id: 5, palavra_chave: 'agua' }
    ];
    
    console.log(`� Criando backup com ${exemploMappings.length} mapeamentos de exemplo`);
    
    const backupData = {
      restaurantId: restaurantId,
      timestamp: new Date().toISOString(),
      version: '1.0',
      type: 'mapeamentos',
      mappings: exemploMappings
    };
    
    // Salvar arquivo
    const fileName = `backup-mapeamentos-teste-${new Date().toISOString().split('T')[0]}.json`;
    const filePath = path.join(__dirname, fileName);
    
    fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2));
    
    console.log(`✅ Backup gerado com sucesso!`);
    console.log(`📁 Arquivo: ${fileName}`);
    console.log(`📊 Mapeamentos: ${backupData.mappings.length}`);
    console.log(`\n🧪 Use este arquivo para testar a restauração!`);
    
    // Mostrar alguns exemplos
    console.log('\n📋 Primeiros mapeamentos:');
    backupData.mappings.slice(0, 5).forEach((m, i) => {
      console.log(`   ${i+1}. item_id: ${m.item_id} -> palavra: "${m.palavra_chave}"`);  
    });
    
  } catch (error) {
    console.error('❌ Erro ao gerar backup:', error);
  }
}

if (require.main === module) {
  gerarBackupTeste();
}

module.exports = { gerarBackupTeste };