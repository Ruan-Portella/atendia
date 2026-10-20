-- Boavoz · contexto fixo do chatbot e fontes por contexto (D', parte 1, 19/10/2026).
--
-- bots.fixed_context: o contexto de origem "bot" (a loja de uma plataforma, o workspace de um SaaS),
-- definido pela agência no painel ou pela API. Vai em toda chamada de ação do chatbot, por cima do
-- contexto do token, do pareamento ou do roteiro (a loja do chatbot não muda pelo token), e escolhe
-- as fontes com etiqueta. A IA nunca vê o contexto.
--
-- sources.context: a etiqueta da fonte (ex.: {"workspace_id": "ws_abc"}). A busca considera só as
-- fontes gerais (sem etiqueta) e as do contexto ativo da conversa (o contexto contém a etiqueta).
-- Os trechos levam a mesma etiqueta (chunks.context, copiada por gatilho na gravação, para nenhum
-- caminho de leitura esquecer), e a busca filtra sem juntar as tabelas. Ver src/lib/bot-context.ts.
-- Idempotente.
alter table public.bots add column if not exists fixed_context jsonb;
alter table public.bots drop constraint if exists bots_fixed_context_check;
alter table public.bots add constraint bots_fixed_context_check check (fixed_context is null or (jsonb_typeof(fixed_context) = 'object' and fixed_context <> '{}'::jsonb and octet_length(fixed_context::text) <= 2048));

alter table public.sources add column if not exists context jsonb;
alter table public.sources drop constraint if exists sources_context_check;
alter table public.sources add constraint sources_context_check check (context is null or (jsonb_typeof(context) = 'object' and context <> '{}'::jsonb and octet_length(context::text) <= 1024));
-- quem mandou a fonte pela API (a chave), para a listagem e a remoção
alter table public.sources add column if not exists api_key_id uuid references public.api_keys(id) on delete set null;
create index if not exists sources_bot_context_idx on public.sources (bot_id, created_at desc) where context is not null;

alter table public.chunks add column if not exists context jsonb;

-- a etiqueta da fonte vai para cada trecho gravado (leitura, releitura do site, edição)
create or replace function public.chunks_copy_context()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  select s.context into new.context from public.sources s where s.id = new.source_id;
  return new;
end;
$$;
drop trigger if exists chunks_copy_context on public.chunks;
create trigger chunks_copy_context before insert on public.chunks for each row execute function public.chunks_copy_context();

-- os trechos que já existem seguem a fonte (nenhuma fonte tinha etiqueta antes desta migração)
update public.chunks c set context = s.context from public.sources s where s.id = c.source_id and s.context is not null and c.context is distinct from s.context;

-- a busca recebe o contexto ativo da conversa (null: só as fontes gerais)
drop function if exists public.match_chunks(uuid, vector, int, float);
drop function if exists public.match_chunks(uuid, vector, int, float, jsonb);
create function public.match_chunks(
  p_bot_id uuid,
  p_query vector(1536),
  p_count int default 6,
  p_min_similarity float default 0.15,
  p_context jsonb default null
) returns table (id bigint, content text, metadata jsonb, similarity float, gate_version text, gate_segments jsonb, gate_categories text[])
language sql stable set search_path = public as $$
  -- "materialized": primeiro só os trechos do bot (gerais e os do contexto ativo), depois a
  -- distância de cada um (mesmo que um índice vetorial volte a existir, o filtro vem antes)
  with scoped as materialized (
    select c.id, c.content, c.metadata, c.embedding <=> p_query as distance, c.gate_version, c.gate_segments, c.gate_categories
    from public.chunks c
    where c.bot_id = p_bot_id
      and (c.context is null or (p_context is not null and p_context @> c.context))
  )
  select s.id, s.content, s.metadata, 1 - s.distance as similarity, s.gate_version, s.gate_segments, s.gate_categories
  from scoped s
  where 1 - s.distance > p_min_similarity
  order by s.distance
  limit p_count;
$$;
-- só o servidor busca (o chat usa a service role)
revoke all on function public.match_chunks(uuid, vector, int, float, jsonb) from public, anon, authenticated;
grant execute on function public.match_chunks(uuid, vector, int, float, jsonb) to service_role;

notify pgrst, 'reload schema';
