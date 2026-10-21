-- Caixa de entrada, parte 2 (20/10/2026): disponibilidade de quem atende, para o rodízio dos setores.
-- "Disponível" é a escolha da pessoa (Disponível ou Ausente, no perfil e na Caixa de entrada);
-- "com o painel aberto" é o last_seen_at, renovado pelo painel e pela área do cliente a cada poucos
-- minutos. O rodízio só manda conversa para quem está disponível e com o painel aberto.

alter table public.agency_members add column if not exists available boolean not null default true;
alter table public.agency_members add column if not exists last_seen_at timestamptz;
alter table public.client_members add column if not exists available boolean not null default true;
alter table public.client_members add column if not exists last_seen_at timestamptz;
