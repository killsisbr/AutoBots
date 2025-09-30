/**
 * Componente para exibir informações do restaurante
 * Sistema Multi-Tenant - Brutus Bot
 */

class RestaurantInfo {
    constructor() {
        this.restaurantData = null;
        this.isLoaded = false;
    }

    // Função para obter o ID do cliente da sessão
    getClienteId() {
        // MÁXIMA PRIORIDADE: forcedClienteId
        if (window.forcedClienteId) {
            console.log('🚀 [RESTAURANT-INFO] USANDO FORCED CLIENT ID:', window.forcedClienteId);
            return window.forcedClienteId;
        }
        
        // PRIORIZAR o clienteId da URL atual
        const urlClienteId = this.extractClienteIdFromUrl();
        if (urlClienteId && urlClienteId !== 'brutus-burger') {
            console.log('🎯 RestaurantInfo usando clienteId da URL:', urlClienteId);
            return urlClienteId;
        }
        
        // Fallback para valores armazenados
        return sessionStorage.getItem('clienteId') || 
               localStorage.getItem('clienteId') || 
               'brutus-burger'; // fallback para o cliente padrão
    }

    // Extrair clienteId da URL atual
    extractClienteIdFromUrl() {
        const pathname = window.location.pathname;
        const urlParams = new URLSearchParams(window.location.search);
        
        // Tentar extrair do parâmetro restaurant
        const restaurantParam = urlParams.get('restaurant');
        if (restaurantParam) {
            return restaurantParam;
        }
        
        // Tentar extrair do nome do arquivo (pedidos-CLIENTEID.html)
        const match = pathname.match(/\/pedidos-([^.]+)\.html/);
        if (match) {
            return match[1];
        }
        
        return null;
    }

    // Função para construir URLs da API com clienteId
    buildApiUrl(endpoint) {
        const clienteId = this.getClienteId();
        return `/api/${endpoint}?clienteId=${encodeURIComponent(clienteId)}`;
    }

    // Carregar informações do restaurante
    async loadRestaurantInfo() {
        try {
            const url = this.buildApiUrl('restaurant/current');
            console.log('[DEBUG] Fazendo requisição para:', url);
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`Erro ${response.status}: ${response.statusText}`);
            }
            
            this.restaurantData = await response.json();
            this.isLoaded = true;
            return this.restaurantData;
        } catch (error) {
            console.error('Erro ao carregar informações do restaurante:', error);
            // Fallback para dados padrão
            this.restaurantData = {
                id: this.getClienteId(),
                nome: 'Restaurante',
                email: 'admin@restaurante.com',
                ativo: true,
                dataCriacao: new Date().toISOString()
            };
            this.isLoaded = true;
            return this.restaurantData;
        }
    }

    // Criar elemento visual para exibir informações do restaurante
    createRestaurantInfoElement(options = {}) {
        const {
            showId = true,
            showName = true,
            showEmail = false,
            showStatus = true,
            compact = false,
            className = 'restaurant-info'
        } = options;

        const container = document.createElement('div');
        container.className = className;
        
        if (compact) {
            container.classList.add('compact');
        }

        // Estilos inline para garantir que funcione em qualquer página
        if (compact) {
            // Compact / pill style for header placement
            container.style.cssText = `
                background: rgba(0,0,0,0.24);
                color: white;
                padding: 6px 10px;
                border-radius: 999px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                font-size: 12px;
                box-shadow: none;
                border: 1px solid rgba(255,255,255,0.06);
                margin: 0;
                display: flex;
                align-items: center;
                gap: 8px;
            `;
        } else {
            container.style.cssText = `
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 12px 16px;
                border-radius: 8px;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                font-size: 14px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.15);
                margin: 10px 0;
                display: flex;
                align-items: center;
                gap: 8px;
            `;
        }

        // Ícone do restaurante
        const icon = document.createElement('span');
        icon.innerHTML = '🏪';
        icon.style.fontSize = compact ? '16px' : '20px';
        container.appendChild(icon);

        // Container de texto
        const textContainer = document.createElement('div');
        textContainer.style.flex = '1';
        
        if (!this.isLoaded) {
            textContainer.innerHTML = '<span style="opacity: 0.8;">Carregando...</span>';
            container.appendChild(textContainer);
            return container;
        }

        const info = [];
        
        if (showName && this.restaurantData.nome) {
            info.push(`<strong>${this.restaurantData.nome}</strong>`);
        }
        
        if (showId) {
            info.push(`ID: <code style="background: rgba(255,255,255,0.2); padding: 2px 6px; border-radius: 4px; font-family: monospace;">${this.restaurantData.id}</code>`);
        }
        
        if (showEmail && this.restaurantData.email) {
            info.push(`📧 ${this.restaurantData.email}`);
        }

        textContainer.innerHTML = info.join(compact ? ' • ' : '<br>');
        container.appendChild(textContainer);

        // Status indicator
        if (showStatus) {
            const statusIndicator = document.createElement('div');
            statusIndicator.style.cssText = `
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background-color: ${this.restaurantData.ativo ? '#4CAF50' : '#f44336'};
                flex-shrink: 0;
            `;
            statusIndicator.title = this.restaurantData.ativo ? 'Ativo' : 'Inativo';
            container.appendChild(statusIndicator);
        }

        return container;
    }

    // Inserir informações do restaurante em um elemento específico
    async renderInElement(elementId, options = {}) {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`Elemento com ID '${elementId}' não encontrado`);
            return;
        }

        if (!this.isLoaded) {
            await this.loadRestaurantInfo();
        }

        // Avoid duplicate inserts: remove previous .restaurant-info children
        try {
            const existing = element.querySelectorAll('.' + (options.className || 'restaurant-info'));
            existing.forEach(n => n.remove());
        } catch (e) {
            // ignore
        }

        // If the target placeholder is inside a header.header-slim, prefer compact rendering
        const inSlimHeader = element.closest && element.closest('header.header-slim');
        const renderOptions = Object.assign({}, options, { compact: (options.compact || !!inSlimHeader) });

        const infoElement = this.createRestaurantInfoElement(renderOptions);
        element.appendChild(infoElement);
    }

    // Inserir informações no cabeçalho da página
    async renderInHeader(options = {}) {
        let header = document.querySelector('header');
        if (!header) {
            // Criar header se não existir
            header = document.createElement('header');
            header.style.cssText = 'position: relative; z-index: 1000;';
            document.body.insertBefore(header, document.body.firstChild);
        }

        if (!this.isLoaded) {
            await this.loadRestaurantInfo();
        }

        const infoElement = this.createRestaurantInfoElement({
            compact: true,
            showEmail: false,
            ...options
        });
        
        infoElement.style.position = 'fixed';
        infoElement.style.top = '10px';
        infoElement.style.right = '10px';
        infoElement.style.zIndex = '9999';
        
        header.appendChild(infoElement);
    }

    // Atualizar título da página com nome do restaurante
    async updatePageTitle(suffix = '') {
        if (!this.isLoaded) {
            await this.loadRestaurantInfo();
        }

        const originalTitle = document.title;
        const newTitle = suffix 
            ? `${this.restaurantData.nome} - ${suffix}`
            : `${this.restaurantData.nome} - ${originalTitle}`;
        
        document.title = newTitle;
    }

    // Método de conveniência para inicialização rápida
    async quickSetup(options = {}) {
        console.log('[DEBUG] quickSetup chamado com opções:', options);
        const {
            showInHeader = true,
            updateTitle = true,
            titleSuffix = '',
            headerOptions = {}
        } = options;

        console.log('[DEBUG] Chamando loadRestaurantInfo...');
        await this.loadRestaurantInfo();

        // If a specific placeholder exists in the page, prefer rendering there
        // to avoid duplicate fixed header widgets. This avoids showing the
        // same restaurant info twice (inline + fixed). If no placeholder is
        // present and showInHeader is true, render the fixed header.
        const placeholder = document.getElementById('restaurant-info');
        if (placeholder) {
            // Render into the existing element (more context-aware)
            await this.renderInElement('restaurant-info', {
                showEmail: headerOptions.showEmail || false,
                compact: headerOptions.compact || false,
                showId: headerOptions.showId !== false, // default true
                showStatus: headerOptions.showStatus !== false
            });
        } else if (showInHeader) {
            await this.renderInHeader(headerOptions);
        }

        if (updateTitle) {
            await this.updatePageTitle(titleSuffix);
        }

        // No status element handling here (removed per UI simplification)

        return this.restaurantData;
    }
}

// Instância global
window.restaurantInfo = new RestaurantInfo();

// Auto-inicialização quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
    console.log('[DEBUG] DOMContentLoaded - Inicializando RestaurantInfo');
    
    // Aguardar autenticação antes de carregar informações
    if (window.autoAuth && window.autoAuth.isAuth()) {
        console.log('[DEBUG] Usuário já autenticado, chamando quickSetup imediatamente');
        // Já autenticado, carregar imediatamente
        window.restaurantInfo.quickSetup({
            showInHeader: true,
            updateTitle: true
        });
            // Nota: quickSetup já renderiza no placeholder se ele existir.
    } else {
        console.log('[DEBUG] Usuário não autenticado, aguardando evento authReady');
        // Aguardar evento de autenticação
        window.addEventListener('authReady', () => {
            console.log('[DEBUG] Evento authReady recebido, chamando quickSetup');
            window.restaurantInfo.quickSetup({
                showInHeader: true,
                updateTitle: true
            });
            // Nota: quickSetup já renderiza no placeholder se ele existir.
        });
    }
});

// Exportar para uso em módulos
if (typeof module !== 'undefined' && module.exports) {
    module.exports = RestaurantInfo;
}