-- BoaVoz · E1 (Lojas de Instagram), parte 2: o contexto de story e de post no direct.
-- Idempotente.
--
-- instagram_media_notes: o que foi lido na hora de um story ou de um post da loja que não está na
-- fonte do Instagram (o story respondido some em 24 horas; o post pode ser velho demais para a
-- fonte). Uma linha por mídia do chatbot: cem respostas ao mesmo story descrevem uma vez. Só a
-- descrição, a legenda e o link (nunca a imagem). Só o servidor lê; a limpeza diária apaga depois
-- de 30 dias.

create table if not exists public.instagram_media_notes (
  bot_id uuid not null references public.bots(id) on delete cascade,
  media_id text not null,
  kind text not null check (kind in ('story', 'post', 'reel')),
  caption text,
  description text,
  permalink text,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (bot_id, media_id)
);
create index if not exists instagram_media_notes_created_idx on public.instagram_media_notes (created_at);
alter table public.instagram_media_notes enable row level security;

notify pgrst, 'reload schema';
