-- Boavoz · portão, parte 6: classificação da base por IA (uma vez por trecho, depois da leitura).
-- Cada trecho guarda as frases com as categorias de item restrito que elas oferecem; na hora da
-- resposta, o portão monta a versão que aquela pessoa pode ver (sem proibido; sem bebida e
-- remédio até o "Sim" do 18+), pelo canal e pelo país. Sem classificação, vale o dicionário.
-- Idempotente.

alter table public.chunks add column if not exists gate_version text;      -- versão das regras usada (null = não classificado)
alter table public.chunks add column if not exists gate_segments jsonb;    -- [{t, l, c?}] frases com a linha e as categorias; null = nada restrito
alter table public.chunks add column if not exists gate_categories text[]; -- categorias encontradas no trecho (atalho do 18+ e estatística)
create index if not exists chunks_gate_version_idx on public.chunks (gate_version);

-- A busca devolve também a classificação (mudar o retorno exige recriar a função).
drop function if exists public.match_chunks(uuid, vector, int, float);
create function public.match_chunks(
  p_bot_id uuid,
  p_query vector(1536),
  p_count int default 6,
  p_min_similarity float default 0.15
) returns table (id bigint, content text, metadata jsonb, similarity float, gate_version text, gate_segments jsonb, gate_categories text[])
language sql stable set search_path = public as $$
  -- "materialized": primeiro só os trechos do bot, depois a distância de cada um (mesmo que um
  -- índice vetorial volte a existir, o filtro do bot vem antes)
  with scoped as materialized (
    select c.id, c.content, c.metadata, c.embedding <=> p_query as distance, c.gate_version, c.gate_segments, c.gate_categories
    from public.chunks c
    where c.bot_id = p_bot_id
  )
  select s.id, s.content, s.metadata, 1 - s.distance as similarity, s.gate_version, s.gate_segments, s.gate_categories
  from scoped s
  where 1 - s.distance > p_min_similarity
  order by s.distance
  limit p_count;
$$;
-- só o servidor busca (o chat usa a service role)
revoke all on function public.match_chunks(uuid, vector, int, float) from public, anon, authenticated;
grant execute on function public.match_chunks(uuid, vector, int, float) to service_role;

-- Backoffice: quantos trechos de cada bot faltam classificar na versão atual (demos da landing
-- não são classificados: só site, sem portão).
create or replace function public.admin_gate_pending(p_version text)
returns table (bot_id uuid, total bigint, pending bigint, restricted bigint)
language sql stable
set search_path = public
as $$
  select c.bot_id, count(*), count(*) filter (where c.gate_version is distinct from p_version), count(*) filter (where c.gate_segments is not null)
  from public.chunks c
  join public.bots b on b.id = c.bot_id and not b.is_demo
  group by 1;
$$;
revoke all on function public.admin_gate_pending(text) from public, anon, authenticated;
grant execute on function public.admin_gate_pending(text) to service_role;
