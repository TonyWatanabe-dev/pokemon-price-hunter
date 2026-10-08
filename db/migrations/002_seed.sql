-- Dados de referência (idempotente). Mudanças futuras entram como novas linhas, sem mudar o esquema.
SET search_path = hunter;

-- Jogos: todos cadastrados; coleta automática só onde collect_enabled = true
INSERT INTO tcg (id, name, collect_enabled, sort) VALUES
  ('pokemon', 'Pokémon', true, 10),
  ('magic', 'Magic: The Gathering', false, 20),
  ('yugioh', 'Yu-Gi-Oh!', false, 30),
  ('onepiece', 'One Piece', false, 40),
  ('digimon', 'Digimon', false, 50),
  ('lorcana', 'Disney Lorcana', false, 60),
  ('dragonball', 'Dragon Ball Super', false, 70),
  ('riftbound', 'Riftbound', false, 80),
  ('other', 'Outros', false, 999)
ON CONFLICT (id) DO NOTHING;

-- Categorias: grupo → tipo
INSERT INTO category (id, parent_id, name, kind, sort) VALUES
  ('sealed', NULL, 'Selados', 'group', 10),
  ('cards', NULL, 'Cartas', 'group', 20),
  ('protection', NULL, 'Proteção', 'group', 30),
  ('organization', NULL, 'Organização', 'group', 40),
  ('gameplay', NULL, 'Gameplay', 'group', 50),
  ('transport', NULL, 'Transporte', 'group', 60),
  ('display', NULL, 'Exposição', 'group', 70),
  ('other', NULL, 'Outros', 'group', 999)
ON CONFLICT (id) DO NOTHING;

INSERT INTO category (id, parent_id, name, kind, sort) VALUES
  ('sealed.booster', 'sealed', 'Booster', 'type', 10),
  ('sealed.booster_bundle', 'sealed', 'Combo / Booster Bundle', 'type', 20),
  ('sealed.booster_box', 'sealed', 'Booster Box', 'type', 30),
  ('sealed.display', 'sealed', 'Display', 'type', 40),
  ('sealed.etb', 'sealed', 'Treinador Avançado (ETB)', 'type', 50),
  ('sealed.collection_box', 'sealed', 'Box de Coleção', 'type', 60),
  ('sealed.premium_collection', 'sealed', 'Coleção Premium', 'type', 70),
  ('sealed.special_collection', 'sealed', 'Coleção Especial', 'type', 80),
  ('sealed.blister', 'sealed', 'Blister', 'type', 90),
  ('sealed.tin', 'sealed', 'Lata', 'type', 100),
  ('sealed.mini_tin', 'sealed', 'Mini Lata', 'type', 110),
  ('sealed.deck', 'sealed', 'Deck', 'type', 120),
  ('sealed.starter_deck', 'sealed', 'Deck Inicial', 'type', 130),
  ('cards.single', 'cards', 'Carta avulsa', 'type', 10),
  ('protection.sleeve', 'protection', 'Sleeve', 'type', 10),
  ('protection.inner_sleeve', 'protection', 'Inner Sleeve', 'type', 20),
  ('protection.perfect_fit', 'protection', 'Perfect Fit', 'type', 30),
  ('protection.top_loader', 'protection', 'Top Loader', 'type', 40),
  ('protection.semi_rigid', 'protection', 'Semi-rígido', 'type', 50),
  ('protection.card_saver', 'protection', 'Card Saver', 'type', 60),
  ('protection.magnetic_holder', 'protection', 'Magnetic Holder', 'type', 70),
  ('protection.acrylic_case', 'protection', 'Case de acrílico', 'type', 80),
  ('protection.uv_case', 'protection', 'Case UV', 'type', 90),
  ('organization.binder', 'organization', 'Fichário', 'type', 10),
  ('organization.pages_4', 'organization', 'Páginas 4 bolsos', 'type', 20),
  ('organization.pages_9', 'organization', 'Páginas 9 bolsos', 'type', 30),
  ('organization.pages_12', 'organization', 'Páginas 12 bolsos', 'type', 40),
  ('organization.deck_box', 'organization', 'Deck Box', 'type', 50),
  ('organization.storage_box', 'organization', 'Caixa de armazenamento', 'type', 60),
  ('organization.dividers', 'organization', 'Divisórias', 'type', 70),
  ('gameplay.playmat', 'gameplay', 'Playmat', 'type', 10),
  ('gameplay.dice', 'gameplay', 'Dados', 'type', 20),
  ('gameplay.damage_counter', 'gameplay', 'Marcadores de dano', 'type', 30),
  ('gameplay.condition_marker', 'gameplay', 'Marcadores de condição', 'type', 40),
  ('gameplay.token', 'gameplay', 'Tokens', 'type', 50),
  ('gameplay.coin', 'gameplay', 'Moeda', 'type', 60),
  ('transport.case', 'transport', 'Case', 'type', 10),
  ('transport.backpack', 'transport', 'Mochila', 'type', 20),
  ('transport.bag', 'transport', 'Bolsa', 'type', 30),
  ('transport.pouch', 'transport', 'Estojo', 'type', 40),
  ('transport.briefcase', 'transport', 'Maleta', 'type', 50),
  ('display.stand', 'display', 'Suporte / Stand', 'type', 10),
  ('display.frame', 'display', 'Quadro', 'type', 20),
  ('display.case', 'display', 'Expositor', 'type', 30),
  ('other.book', 'other', 'Livros e guias', 'type', 10),
  ('other.accessory', 'other', 'Acessórios diversos', 'type', 20),
  ('other.collectible', 'other', 'Colecionáveis', 'type', 30)
ON CONFLICT (id) DO NOTHING;

INSERT INTO marketplace (id, name, kind, base_url, api_enabled) VALUES
  ('direct', 'Site próprio da loja', 'direct', NULL, false),
  ('mercadolivre', 'Mercado Livre', 'marketplace', 'https://www.mercadolivre.com.br', true),
  ('amazon', 'Amazon Brasil', 'marketplace', 'https://www.amazon.com.br', false),
  ('shopee', 'Shopee', 'marketplace', 'https://shopee.com.br', false),
  ('magalu', 'Magalu', 'marketplace', 'https://www.magazineluiza.com.br', false)
ON CONFLICT (id) DO NOTHING;

-- Afiliados: onda 1 preparada, nada ativo até as contas existirem
INSERT INTO affiliate_program (id, marketplace_id, name, status) VALUES
  ('mercadolivre', 'mercadolivre', 'Mercado Livre Afiliados', 'pending'),
  ('amazon', 'amazon', 'Amazon Associados', 'pending')
ON CONFLICT (id) DO NOTHING;

-- Papéis e permissões
INSERT INTO role (id, name, rank) VALUES
  ('SUPER_ADMIN', 'Super administrador', 100),
  ('ADMIN', 'Administrador', 80),
  ('OPERATOR', 'Operador', 50),
  ('VIEWER', 'Leitura', 10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO permission (id, description) VALUES
  ('admin.access', 'Entrar no /admin'),
  ('health.read', 'Ver saúde do sistema, jobs e eventos'),
  ('review.read', 'Ver a fila de revisão'),
  ('review.decide', 'Aprovar ou rejeitar itens da fila de revisão'),
  ('catalog.write', 'Criar e editar produtos, coleções e categorias'),
  ('reference.write', 'Registrar e verificar preços de referência'),
  ('store.write', 'Cadastrar, pausar e editar lojas'),
  ('affiliate.write', 'Configurar programas e links de afiliado'),
  ('jobs.run', 'Disparar e reprocessar jobs'),
  ('users.manage', 'Gerenciar usuários e papéis')
ON CONFLICT (id) DO NOTHING;

INSERT INTO role_permission (role_id, permission_id)
SELECT 'SUPER_ADMIN', id FROM permission
UNION ALL SELECT 'ADMIN', id FROM permission WHERE id <> 'users.manage'
UNION ALL SELECT 'OPERATOR', id FROM permission WHERE id IN ('admin.access', 'health.read', 'review.read', 'review.decide', 'jobs.run')
UNION ALL SELECT 'VIEWER', id FROM permission WHERE id IN ('admin.access', 'health.read', 'review.read')
ON CONFLICT DO NOTHING;
