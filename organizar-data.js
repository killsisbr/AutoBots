const fs = require('fs');
const path = require('path');

// 🗂️ Script para Organizar Pasta Data - Manter apenas Brutus Burger
// Remove arquivos duplicados, temporários e de outros restaurantes

const dataDir = './data';
const backupDir = './data-backup-antes-limpeza';

// Arquivos que devem ser mantidos (Brutus Burger + essenciais)
const arquivosParaManter = [
    // Brutus Burger - arquivos principais
    'brutus-burger_main.sqlite',
    'brutus-burger_cardapio.sqlite', 
    'brutus-burger_mensagens.sqlite',
    
    // Arquivos de configuração global
    'gatilhos.json',
    
    // Killsis Pizza - manter estrutura vazia para futuro uso
    'killsis-pizza_main.sqlite',
    'killsis-pizza_cardapio.sqlite',
    'killsis-pizza_mensagens.sqlite'
];

// Padrões de arquivos para remover
const padroesParaRemover = [
    // Arquivos temporários SQLite
    /.*\.sqlite-shm$/,
    /.*\.sqlite-wal$/,
    
    // Arquivos de teste e desenvolvimento
    /^teste-.*$/,
    /^debug-.*$/,
    /^default_.*$/,
    /^main\.sqlite$/,
    /^cardapio\.sqlite$/,
    /^mensagens\.sqlite$/,
    
    // Restaurantes de teste/outros
    /^degust-.*$/,
    /^qdelicia-.*$/,
    /^xxx-.*$/,
    /^554191798537.*$/,
    /^msgmenuInicialSub.*$/,
    
    // Killsis com timestamps (manter apenas o padrão)
    /^killsis-\d+.*$/
];

function criarBackup() {
    console.log('📁 Criando backup da pasta data...');
    
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
    }
    
    const arquivos = fs.readdirSync(dataDir);
    let contadorBackup = 0;
    
    arquivos.forEach(arquivo => {
        if (arquivo !== 'data-backup-antes-limpeza') {
            const origem = path.join(dataDir, arquivo);
            const destino = path.join(backupDir, arquivo);
            
            if (fs.lstatSync(origem).isFile()) {
                fs.copyFileSync(origem, destino);
                contadorBackup++;
            }
        }
    });
    
    console.log(`✅ Backup criado: ${contadorBackup} arquivos salvos em ${backupDir}`);
}

function analisarArquivos() {
    console.log('\n📊 Analisando arquivos na pasta data...\n');
    
    const arquivos = fs.readdirSync(dataDir);
    const analise = {
        manter: [],
        remover: [],
        temporarios: [],
        outros: []
    };
    
    arquivos.forEach(arquivo => {
        if (arquivo === 'data-backup-antes-limpeza') return;
        
        // Verificar se deve manter
        if (arquivosParaManter.includes(arquivo)) {
            analise.manter.push(arquivo);
            return;
        }
        
        // Verificar arquivos temporários SQLite
        if (arquivo.endsWith('.sqlite-shm') || arquivo.endsWith('.sqlite-wal')) {
            analise.temporarios.push(arquivo);
            return;
        }
        
        // Verificar padrões para remover
        let deveRemover = false;
        for (const padrao of padroesParaRemover) {
            if (padrao.test(arquivo)) {
                analise.remover.push(arquivo);
                deveRemover = true;
                break;
            }
        }
        
        if (!deveRemover) {
            analise.outros.push(arquivo);
        }
    });
    
    return analise;
}

function mostrarAnalise(analise) {
    console.log('🟢 ARQUIVOS PARA MANTER:');
    analise.manter.forEach(arquivo => {
        const caminho = path.join(dataDir, arquivo);
        const stats = fs.existsSync(caminho) ? fs.statSync(caminho) : null;
        const tamanho = stats ? (stats.size / 1024).toFixed(1) + 'KB' : 'N/A';
        console.log(`   ✅ ${arquivo} (${tamanho})`);
    });
    
    console.log('\n🔴 ARQUIVOS PARA REMOVER:');
    analise.remover.forEach(arquivo => {
        const caminho = path.join(dataDir, arquivo);
        const stats = fs.existsSync(caminho) ? fs.statSync(caminho) : null;
        const tamanho = stats ? (stats.size / 1024).toFixed(1) + 'KB' : 'N/A';
        console.log(`   ❌ ${arquivo} (${tamanho})`);
    });
    
    console.log('\n🟡 ARQUIVOS TEMPORÁRIOS:');
    analise.temporarios.forEach(arquivo => {
        console.log(`   🗑️  ${arquivo}`);
    });
    
    if (analise.outros.length > 0) {
        console.log('\n🔵 OUTROS ARQUIVOS:');
        analise.outros.forEach(arquivo => {
            console.log(`   ❓ ${arquivo}`);
        });
    }
    
    console.log('\n📈 RESUMO:');
    console.log(`   Manter: ${analise.manter.length} arquivos`);
    console.log(`   Remover: ${analise.remover.length} arquivos`);
    console.log(`   Temporários: ${analise.temporarios.length} arquivos`);
    console.log(`   Outros: ${analise.outros.length} arquivos`);
    console.log(`   Total: ${analise.manter.length + analise.remover.length + analise.temporarios.length + analise.outros.length} arquivos`);
}

function executarLimpeza(analise) {
    console.log('\n🧹 Executando limpeza...\n');
    
    let removidos = 0;
    let erros = 0;
    
    // Remover arquivos marcados para exclusão
    [...analise.remover, ...analise.temporarios].forEach(arquivo => {
        try {
            const caminho = path.join(dataDir, arquivo);
            if (fs.existsSync(caminho)) {
                fs.unlinkSync(caminho);
                console.log(`   🗑️  Removido: ${arquivo}`);
                removidos++;
            }
        } catch (error) {
            console.log(`   ❌ Erro ao remover ${arquivo}: ${error.message}`);
            erros++;
        }
    });
    
    // Verificar se arquivos essenciais existem, se não, criar estrutura básica
    arquivosParaManter.forEach(arquivo => {
        const caminho = path.join(dataDir, arquivo);
        if (!fs.existsSync(caminho) && arquivo.endsWith('.sqlite')) {
            console.log(`   📝 Arquivo essencial não encontrado: ${arquivo}`);
        }
    });
    
    console.log('\n✅ LIMPEZA CONCLUÍDA!');
    console.log(`   Arquivos removidos: ${removidos}`);
    console.log(`   Erros: ${erros}`);
    console.log(`   Backup salvo em: ${backupDir}`);
    
    return { removidos, erros };
}

function verificarEstrutura() {
    console.log('\n🔍 Verificando estrutura final...\n');
    
    const arquivos = fs.readdirSync(dataDir);
    const arquivosRestantes = arquivos.filter(a => a !== 'data-backup-antes-limpeza');
    
    console.log('📁 ESTRUTURA FINAL:');
    arquivosRestantes.forEach(arquivo => {
        const caminho = path.join(dataDir, arquivo);
        const stats = fs.statSync(caminho);
        const tamanho = (stats.size / 1024).toFixed(1) + 'KB';
        const tipo = arquivo.includes('main') ? '👥 Clientes' : 
                    arquivo.includes('cardapio') ? '🍔 Cardápio' :
                    arquivo.includes('mensagens') ? '💬 Mensagens' :
                    arquivo === 'gatilhos.json' ? '⚡ Gatilhos' : '📄 Outros';
        
        console.log(`   ${tipo} ${arquivo} (${tamanho})`);
    });
    
    console.log(`\n📊 Total de arquivos: ${arquivosRestantes.length}`);
}

// Função principal
function main() {
    console.log('🗂️  ORGANIZADOR DA PASTA DATA - BRUTUS BURGER');
    console.log('============================================\n');
    
    // Verificar se pasta data existe
    if (!fs.existsSync(dataDir)) {
        console.log('❌ Pasta data não encontrada!');
        return;
    }
    
    // Verificar argumentos da linha de comando
    const args = process.argv.slice(2);
    const executar = args.includes('--executar');
    
    if (!executar) {
        console.log('🔍 MODO ANÁLISE (apenas visualização)');
        console.log('Para executar a limpeza, use: node organizar-data.js --executar\n');
    } else {
        console.log('🧹 MODO EXECUÇÃO (limpeza será realizada)\n');
    }
    
    // Criar backup antes de qualquer coisa
    if (executar) {
        criarBackup();
    }
    
    // Analisar arquivos
    const analise = analisarArquivos();
    mostrarAnalise(analise);
    
    if (executar) {
        console.log('\n⚠️  ATENÇÃO: A limpeza será executada em 3 segundos...');
        console.log('Pressione Ctrl+C para cancelar');
        
        setTimeout(() => {
            const resultado = executarLimpeza(analise);
            verificarEstrutura();
            
            console.log('\n🎉 ORGANIZAÇÃO CONCLUÍDA!');
            console.log('A pasta data agora contém apenas os arquivos do Brutus Burger.');
            console.log('Backup disponível em: data-backup-antes-limpeza/');
        }, 3000);
        
    } else {
        console.log('\n💡 Para executar a limpeza, use:');
        console.log('   node organizar-data.js --executar');
    }
}

// Executar se chamado diretamente
if (require.main === module) {
    main();
}

module.exports = { main, analisarArquivos, executarLimpeza };