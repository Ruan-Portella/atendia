-- Boavoz · busca vetorial exata por bot (L1, passo 4)
-- Idempotente.

-- O índice HNSW era um só para todos os bots: a busca aproximada percorria o índice global e
-- só depois filtrava pelo bot, devolvendo menos trechos (ou piores) quanto mais bots houvesse,
-- e os filtros do portão pioram isso. Cada bot tem poucas centenas de trechos: comparar todos
-- os do bot (pelo índice de bot_id) é exato e rápido. O índice global também ocupava disco.
drop index if exists public.chunks_embedding_idx;

create or replace function public.match_chunks(
  p_bot_id uuid,
  p_query vector(1536),
  p_count int default 6,
  p_min_similarity float default 0.15
) returns table (id bigint, content text, metadata jsonb, similarity float)
language sql stable set search_path = public as $$
  -- "materialized": primeiro só os trechos do bot, depois a distância de cada um (mesmo que um
  -- índice vetorial volte a existir, o filtro do bot vem antes)
  with scoped as materialized (
    select c.id, c.content, c.metadata, c.embedding <=> p_query as distance
    from public.chunks c
    where c.bot_id = p_bot_id
  )
  select s.id, s.content, s.metadata, 1 - s.distance as similarity
  from scoped s
  where 1 - s.distance > p_min_similarity
  order by s.distance
  limit p_count;
$$;
