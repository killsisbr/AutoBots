/**
 * Sistema de Autenticação Automática
 * Brutus Bot - Multi-Tenant
 */

class AutoAuth {
    constructor() {
        this.isAuthenticated = false;
        this.clienteId = null;
        this.init();
    }

    // Verificar se já está autenticado
    checkExistingAuth() {
        // MÁXIMA PRIORIDADE: Usar forcedClienteId se definido
        if (window.forcedClienteId) {
            console.log('🚀 [AUTO-AUTH] USANDO FORCED CLIENT ID:', window.forcedClienteId);
            this.clienteId = window.forcedClienteId;
            this.isAuthenticated = true;
            sessionStorage.setItem('clienteId', window.forcedClienteId);
            return true;
        }
        
        // PRIORIZAR o clienteId da URL atual
        const urlClienteId = this.extractClienteIdFromUrl();
        
        // Se conseguiu extrair da URL, usar esse valor
        if (urlClienteId && urlClienteId !== 'brutus-burger') {
            console.log('🎯 Usando clienteId da URL:', urlClienteId);
            this.clienteId = urlClienteId;
            this.isAuthenticated = true;
            sessionStorage.setItem('clienteId', urlClienteId);
            return true;
        }
        
        // Fallback para valores armazenados
        const clienteId = sessionStorage.getItem('clienteId') || localStorage.getItem('clienteId');
        if (clienteId) {
            this.clienteId = clienteId;
            this.isAuthenticated = true;
            return true;
        }
        return false;
    }

    // Fazer login automático com credenciais padrão
    async autoLogin() {
        try {
            console.log('🔐 Fazendo login automático...');
            
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    email: 'admin@brutus.com', 
                    senha: 'admin123' 
                })
            });
            
            if (response.ok) {
                const data = await response.json();
                this.clienteId = data.cliente.id;
                this.isAuthenticated = true;
                
                // Salvar na sessão
                sessionStorage.setItem('clienteId', this.clienteId);
                
                console.log('✅ Login automático realizado com sucesso!', data.cliente);
                return true;
            } else {
                const error = await response.json();
                console.error('❌ Erro no login automático:', error);
                return false;
            }
        } catch (error) {
            console.error('❌ Erro na requisição de login automático:', error);
            return false;
        }
    }

    // Inicializar autenticação
    async init() {
        // Verificar se já está autenticado
        if (this.checkExistingAuth()) {
            console.log('✅ Já autenticado como:', this.clienteId);
            return true;
        }

        // Tentar login automático
        const loginSuccess = await this.autoLogin();
        
        if (!loginSuccess) {
            console.warn('⚠️ Falha na autenticação automática. Usando fallback.');
            // Fallback: extrair clienteId da URL atual
            this.clienteId = this.extractClienteIdFromUrl();
            sessionStorage.setItem('clienteId', this.clienteId);
        }

        return this.isAuthenticated;
    }

    // Obter ID do cliente
    getClienteId() {
        // MÁXIMA PRIORIDADE: forcedClienteId
        if (window.forcedClienteId) {
            console.log('🚀 [GET-CLIENTE-ID] USANDO FORCED:', window.forcedClienteId);
            return window.forcedClienteId;
        }
        
        return this.clienteId || sessionStorage.getItem('clienteId') || 'brutus-burger';
    }

    // Extrair clienteId da URL atual
    extractClienteIdFromUrl() {
        const pathname = window.location.pathname;
        const urlParams = new URLSearchParams(window.location.search);
        
        // Tentar extrair do parâmetro restaurant
        const restaurantParam = urlParams.get('restaurant');
        if (restaurantParam) {
            console.log('📍 ClienteId extraído do parâmetro restaurant:', restaurantParam);
            return restaurantParam;
        }
        
        // Tentar extrair do nome do arquivo (pedidos-CLIENTEID.html)
        const match = pathname.match(/\/pedidos-([^.]+)\.html/);
        if (match) {
            console.log('📍 ClienteId extraído do nome do arquivo:', match[1]);
            return match[1];
        }
        
        // Fallback final
        console.warn('⚠️ Não foi possível extrair clienteId da URL. Usando brutus-burger como fallback.');
        return 'brutus-burger';
    }

    // Verificar se está autenticado
    isAuth() {
        return this.isAuthenticated || !!sessionStorage.getItem('clienteId');
    }
}

// Criar instância global
window.autoAuth = new AutoAuth();

// Aguardar autenticação antes de carregar outros scripts
window.autoAuth.init().then(() => {
    console.log('🚀 Sistema de autenticação inicializado');
    
    // Disparar evento personalizado para outros scripts
    window.dispatchEvent(new CustomEvent('authReady', {
        detail: { clienteId: window.autoAuth.getClienteId() }
    }));
});