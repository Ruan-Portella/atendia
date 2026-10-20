-- BoaVoz · E1 (Lojas de Instagram), parte 3b: palavras-chave do Instagram.
-- Idempotente.
--
-- instagram_keywords: a loja escolhe palavras (ex.: PREÇO, EU QUERO). No direct, a mensagem que é
-- só a palavra recebe a resposta pronta (dm_reply). Nos comentários (parte 4), a palavra no
-- comentário dispara a resposta privada no direct (comment_reply, uma por comentário, até 7 dias)
-- e, se a loja quiser, uma resposta pública curta (comment_public), nos posts escolhidos (media_ids;
-- null = todos). As palavras ficam normalizadas (sem acento, minúsculas). O roteiro por
-- palavra-chave continua no próprio roteiro (B2').

create table if not exists public.instagram_keywords (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  words text[] not null check (cardinality(words) between 1 and 5),
  dm_reply text check (dm_reply is null or char_length(dm_reply) between 1 and 1000),
  comment_reply text check (comment_reply is null or char_length(comment_reply) between 1 and 1000),
  comment_public text check (comment_public is null or char_length(comment_public) between 1 and 300),
  media_ids text[] check (media_ids is null or cardinality(media_ids) between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint instagram_keywords_some_reply check (dm_reply is not null or comment_reply is not null or comment_public is not null)
);
create index if not exists instagram_keywords_bot_idx on public.instagram_keywords (bot_id);
drop trigger if exists instagram_keywords_updated_at on public.instagram_keywords;
create trigger instagram_keywords_updated_at before update on public.instagram_keywords for each row execute function public.set_updated_at();
alter table public.instagram_keywords enable row level security;
revoke all on public.instagram_keywords from anon, authenticated;
grant all on public.instagram_keywords to service_role;

notify pgrst, 'reload schema';
