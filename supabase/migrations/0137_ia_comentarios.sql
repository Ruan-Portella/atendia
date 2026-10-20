-- BoaVoz · E1 (Lojas de Instagram), parte 4b: a IA nos comentários.
-- Idempotente.
--
-- bots.ig_comments_ai: a IA responde os comentários sem palavra-chave em nenhum post ('off',
-- padrão), em todos ('todos') ou nos escolhidos ('escolhidos', com os ids em
-- ig_comments_ai_media_ids). Ofensa e spam ficam sem resposta; pergunta que pede conversa recebe a
-- resposta privada no direct. Cada resposta da IA conta como uma resposta do atendimento de quem
-- comentou.

alter table public.bots
  add column if not exists ig_comments_ai text not null default 'off',
  add column if not exists ig_comments_ai_media_ids text[];
alter table public.bots drop constraint if exists bots_ig_comments_ai_check;
alter table public.bots add constraint bots_ig_comments_ai_check check (ig_comments_ai in ('off', 'todos', 'escolhidos'));
alter table public.bots drop constraint if exists bots_ig_comments_ai_media_check;
alter table public.bots add constraint bots_ig_comments_ai_media_check check (ig_comments_ai_media_ids is null or cardinality(ig_comments_ai_media_ids) <= 100);

notify pgrst, 'reload schema';
