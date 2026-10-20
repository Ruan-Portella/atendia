-- BoaVoz · E1 (Lojas de Instagram), parte 4a: os comentários dos posts.
-- Idempotente.
--
-- instagram_comments: cada comentário que chegou pelo webhook (campo "comments") e o que o BoaVoz
-- fez com ele: a resposta privada no direct (uma por comentário, até 7 dias), a resposta pública
-- e o motivo (a palavra-chave; na parte 4b, a IA). O texto e as respostas vão cifrados com a chave
-- do cliente (são dados de quem comentou). contact_id leva o comentário junto quando o contato é
-- apagado (pedido do titular); a limpeza diária apaga depois de 90 dias. Só o servidor lê.

create table if not exists public.instagram_comments (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  comment_id text not null,
  media_id text,
  parent_id text,
  contact_id uuid references public.contacts(id) on delete cascade,
  -- quem comentou: HMAC do id do Instagram (uma resposta privada por pessoa e post a cada 24 h)
  author_hash text,
  username text,
  text_enc text,
  action text not null default 'nenhuma' check (action in ('privada', 'publica', 'privada_publica', 'nenhuma', 'ignorado', 'erro')),
  reason text,
  private_reply_enc text,
  public_reply_enc text,
  public_reply_id text,
  error text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (bot_id, comment_id)
);
create index if not exists instagram_comments_bot_idx on public.instagram_comments (bot_id, created_at desc);
create index if not exists instagram_comments_author_idx on public.instagram_comments (bot_id, author_hash, media_id, created_at desc);
create index if not exists instagram_comments_reply_idx on public.instagram_comments (public_reply_id) where public_reply_id is not null;
alter table public.instagram_comments enable row level security;
revoke all on public.instagram_comments from anon, authenticated;
grant all on public.instagram_comments to service_role;

notify pgrst, 'reload schema';
