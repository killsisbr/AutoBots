const multiTenantService = require('../services/multiTenantService');
const path = require('path');

class RestaurantMiddleware {
    constructor(multiTenantService) {
        console.log('[DEBUG] RestaurantMiddleware - construtor iniciado');
        console.log('[DEBUG] RestaurantMiddleware - multiTenantService:', !!multiTenantService);
        this.multiTenantService = multiTenantService;
        this.restaurantes = new Map();
        this.initializeDefaultRestaurants();
        console.log('[DEBUG] RestaurantMiddleware - construtor finalizado, restaurantes:', Array.from(this.restaurantes.keys()));
    }

    // Inicializar restaurantes padrão
    initializeDefaultRestaurants() {
        const defaultRestaurants = [
            {
                id: 'brutus-burger',
                nome: 'Brutus Burger',
                slug: 'brutus',
                tema: 'dark',
                logo: '/images/brutus-logo.png',
                cores: {
                    primaria: '#ff6b35',
                    secundaria: '#2c3e50',
                    fundo: '#1a1a1a'
                },
                ativo: true
            },
            {
                id: 'killsis-pizza',
                nome: 'Killsis Pizza',
                slug: 'killsis',
                tema: 'light',
                logo: '/images/killsis-logo.png',
                cores: {
                    primaria: '#e74c3c',
                    secundaria: '#34495e',
                    fundo: '#ffffff'
                },
                ativo: true
            },
            {
                id: 'degust-175863158714o',
                nome: 'Degust Restaurante',
                slug: 'degust',
                tema: 'light',
                logo: '/images/degust-logo.png',
                cores: {
                    primaria: '#27ae60',
                    secundaria: '#2c3e50',
                    fundo: '#ffffff'
                },
                ativo: true
            },
            {
                id: 'degust-1758631587140',
                nome: 'Degust Restaurante Alt',
                slug: 'degust-alt',
                tema: 'light',
                logo: '/images/degust-logo.png',
                cores: {
                    primaria: '#27ae60',
                    secundaria: '#2c3e50',
                    fundo: '#ffffff'
                },
                ativo: true
            }
        ];

        defaultRestaurants.forEach(restaurant => {
            this.restaurantes.set(restaurant.id, restaurant);
        });
    }

    // Middleware principal para identificar restaurante
    identifyRestaurant() {
        return (req, res, next) => {
            console.log('[DEBUG] ===== MIDDLEWARE identifyRestaurant CHAMADO =====');
            console.log('[DEBUG] identifyRestaurant - iniciando');
            console.log('[DEBUG] identifyRestaurant - req.path:', req.path);
            console.log('[DEBUG] identifyRestaurant - req.method:', req.method);
            console.log('[DEBUG] identifyRestaurant - req.headers:', req.headers);
            
            // Extrair ID do restaurante da URL
            const restaurantId = this.extractRestaurantId(req);
            console.log('[DEBUG] identifyRestaurant - restaurantId extraído:', restaurantId);
            
            if (restaurantId) {
                const restaurant = this.restaurantes.get(restaurantId);
                if (restaurant && restaurant.ativo) {
                    req.restaurant = restaurant;
                    req.restaurantId = restaurantId;
                    
                    try {
                        // Configurar banco de dados específico do restaurante
                        req.db = {
                            main: this.multiTenantService.getClientDatabase(restaurantId, 'main'),
                            cardapio: this.multiTenantService.getClientDatabase(restaurantId, 'cardapio'),
                            mensagens: this.multiTenantService.getClientDatabase(restaurantId, 'mensagens')
                        };
                        
                        return next();
                    } catch (error) {
                        console.error('[ERROR] Erro ao configurar banco de dados para restaurante:', restaurantId, error);
                        return next(error);
                    }
                }
            }
            
            try {
                // Se não encontrou restaurante válido, usar padrão
                req.restaurant = this.restaurantes.get('brutus-burger');
                req.restaurantId = 'brutus-burger';
                req.db = {
                    main: this.multiTenantService.getClientDatabase('brutus-burger', 'main'),
                    cardapio: this.multiTenantService.getClientDatabase('brutus-burger', 'cardapio'),
                    mensagens: this.multiTenantService.getClientDatabase('brutus-burger', 'mensagens')
                };
                
                next();
            } catch (error) {
                console.error('[ERROR] Erro ao configurar banco de dados padrão:', error);
                next(error);
            }
        };
    }

    // Extrair ID do restaurante da URL
    extractRestaurantId(req) {
        // Verificar header X-Restaurant-ID primeiro
        console.log('[DEBUG] extractRestaurantId - header x-restaurant-id:', req.headers['x-restaurant-id']);
        if (req.headers['x-restaurant-id']) {
            console.log('[DEBUG] extractRestaurantId - usando header:', req.headers['x-restaurant-id']);
            return req.headers['x-restaurant-id'];
        }
        
        // Formato: /r/{restaurantId}/... ou /restaurant/{restaurantId}/...
        const urlParts = req.path.split('/');
        
        if (urlParts[1] === 'r' && urlParts[2]) {
            return urlParts[2];
        }
        
        if (urlParts[1] === 'restaurant' && urlParts[2]) {
            return urlParts[2];
        }
        
        // Formato direto: /{restaurantId}/... (ex: /brutus-burger/pedidos.html)
        if (urlParts[1] && this.restaurantes.has(urlParts[1])) {
            return urlParts[1];
        }
        
        // Verificar query parameter
        if (req.query.restaurant) {
            return req.query.restaurant;
        }

        // compat: some clients send restaurant_id
        if (req.query.restaurant_id) {
            console.log('[DEBUG] extractRestaurantId - query restaurant_id found:', req.query.restaurant_id);
            return req.query.restaurant_id;
        }
        
        // Verificar subdomain (se aplicável)
        const host = req.get('host');
        if (host) {
            const subdomain = host.split('.')[0];
            if (this.restaurantes.has(subdomain)) {
                return subdomain;
            }
        }
        
        return null;
    }

    // Middleware para servir arquivos estáticos personalizados
    serveCustomAssets() {
        return (req, res, next) => {
            if (!req.restaurant) return next();
            
            const restaurantId = req.restaurant.id;
            const assetPath = req.path;
            
            // Verificar se existe versão personalizada do arquivo
            const customPath = path.join(process.cwd(), 'public', 'restaurants', restaurantId, assetPath);
            const fs = require('fs');
            
            if (fs.existsSync(customPath)) {
                return res.sendFile(customPath);
            }
            
            next();
        };
    }

    // Adicionar novo restaurante
    addRestaurant(restaurantData) {
        const restaurant = {
            id: restaurantData.id,
            nome: restaurantData.nome,
            slug: restaurantData.slug || restaurantData.id,
            tema: restaurantData.tema || 'light',
            logo: restaurantData.logo || '/images/default-logo.png',
            cores: restaurantData.cores || {
                primaria: '#3498db',
                secundaria: '#2c3e50',
                fundo: '#ffffff'
            },
            ativo: restaurantData.ativo !== false
        };
        
        this.restaurantes.set(restaurant.id, restaurant);
        
        // Criar bancos de dados para o novo restaurante
        multiTenantService.getClientDatabase(restaurant.id, 'main');
        multiTenantService.getClientDatabase(restaurant.id, 'cardapio');
        multiTenantService.getClientDatabase(restaurant.id, 'mensagens');
        
        return restaurant;
    }

    // Obter todos os restaurantes
    getAllRestaurants() {
        return Array.from(this.restaurantes.values());
    }

    // Obter restaurante por ID
    getRestaurant(id) {
        return this.restaurantes.get(id);
    }

    // Atualizar restaurante
    updateRestaurant(id, updates) {
        const restaurant = this.restaurantes.get(id);
        if (restaurant) {
            Object.assign(restaurant, updates);
            this.restaurantes.set(id, restaurant);
            return restaurant;
        }
        return null;
    }

    // Desativar restaurante
    deactivateRestaurant(id) {
        const restaurant = this.restaurantes.get(id);
        if (restaurant) {
            restaurant.ativo = false;
            this.restaurantes.set(id, restaurant);
            return true;
        }
        return false;
    }

    // Middleware para validar se o restaurante existe
    validateRestaurant() {
        return (req, res, next) => {
            try {
                // Procurar restaurantId em várias fontes.
                // Important: do NOT accidentally use req.params.id (resource id) if a real restaurant id is provided
                const candidates = [req.params.restaurantId, req.query.restaurant, req.query.restaurant_id, req.restaurantId];
                // prefer the first candidate that exists in known restaurants
                let restaurantId = null;
                for (const c of candidates) {
                    if (!c) continue;
                    if (this.restaurantes.has(String(c))) { restaurantId = String(c); break; }
                }
                // fallback: if none matched, allow req.params.id as last resort (for routes that embed restaurant in URL)
                if (!restaurantId && req.params && req.params.id) restaurantId = String(req.params.id);

                console.log('[DEBUG] validateRestaurant - selected restaurantId:', restaurantId);
                console.log('[DEBUG] validateRestaurant - req.params:', req.params);
                console.log('[DEBUG] validateRestaurant - req.query.restaurant:', req.query.restaurant);
                console.log('[DEBUG] validateRestaurant - req.restaurantId:', req.restaurantId);
                console.log('[DEBUG] validateRestaurant - restaurantes disponíveis:', Array.from(this.restaurantes.keys()));

                const restaurant = restaurantId ? this.restaurantes.get(restaurantId) : null;
                console.log('[DEBUG] validateRestaurant - restaurant found:', !!restaurant);
                
                if (!restaurant) {
                    return res.status(404).json({ error: 'Restaurante não encontrado' });
                }

                if (!restaurant.ativo) {
                    return res.status(403).json({ error: 'Restaurante inativo' });
                }

                // Adiciona as informações do restaurante ao request
                req.restaurant = restaurant;
                req.restaurantId = restaurantId;
                next();
            } catch (error) {
                console.error('Erro ao validar restaurante:', error);
                res.status(500).json({ error: 'Erro interno do servidor' });
            }
        };
    }
}

module.exports = RestaurantMiddleware;