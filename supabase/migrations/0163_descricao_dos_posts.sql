-- A descrição das fotos dos posts do Instagram, corrigida pela equipe (itens menores da conferência
-- de 20/10, parte 5). A descrição automática pode errar o produto, a cor ou o sabor: a equipe
-- corrige na lista dos posts (Base de conhecimento → Posts do Instagram → Ver e corrigir os posts)
-- e os trechos do post são refeitos com o texto novo, marcado como revisado. A leitura de 6 em 6
-- horas nunca descreve de novo um post que já está na base, então a correção fica. Idempotente.

alter table public.instagram_posts add column if not exists description_edited_at timestamptz;
alter table public.instagram_posts add column if not exists description_edited_by text;
