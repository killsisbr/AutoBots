// Cardápio estático - array de itens do menu
// Este arquivo é usado como fallback quando o SQLite não está disponível

const cardapio = [
  // Lanches principais
  { id: 51, nome: 'Brutus Burguer', descricao: 'Hambúrguer especial da casa', preco: 18.90, tipo: 'Lanche' },
  { id: 61, nome: 'X-Burguer', descricao: 'Hambúrguer com queijo', preco: 16.90, tipo: 'Lanche' },
  { id: 19, nome: 'X-Salada', descricao: 'Hambúrguer com salada', preco: 16.90, tipo: 'Lanche' },
  { id: 24, nome: 'X-Tudo', descricao: 'Hambúrguer completo', preco: 22.90, tipo: 'Lanche' },
  
  // Bebidas
  { id: 1031, nome: 'Coca-Cola Lata', descricao: 'Refrigerante 350ml', preco: 5.00, tipo: 'Bebida' },
  { id: 1032, nome: 'Guaraná Lata', descricao: 'Refrigerante 350ml', preco: 5.00, tipo: 'Bebida' },
  { id: 1033, nome: 'Fanta Lata', descricao: 'Refrigerante 350ml', preco: 5.00, tipo: 'Bebida' },
  
  // Acompanhamentos
  { id: 68, nome: 'Batata Palito', descricao: 'Porção de batata frita', preco: 12.00, tipo: 'Acompanhamento' },
  { id: 69, nome: 'Batata Rústica', descricao: 'Porção de batata rústica', preco: 14.00, tipo: 'Acompanhamento' },
  
  // Adicionais
  { id: 20, nome: 'Queijo', descricao: 'Adicional de queijo', preco: 6.00, tipo: 'Adicional' },
  { id: 3, nome: 'Bacon', descricao: 'Adicional de bacon', preco: 7.00, tipo: 'Adicional' },
  { id: 21, nome: 'Catupiry', descricao: 'Adicional de catupiry', preco: 8.00, tipo: 'Adicional' },
  { id: 22, nome: 'Molho Cheddar', descricao: 'Adicional de molho cheddar', preco: 8.00, tipo: 'Adicional' }
];

module.exports = cardapio;