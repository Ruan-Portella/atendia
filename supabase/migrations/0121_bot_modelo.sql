-- Boavoz · bot modelo com herança (D', parte 2a, 19/10/2026; spec, Peça 8).
--
-- O modelo é um chatbot da conta (sem cliente, sem canais, sem tamanho) com a persona, as ações, os
-- roteiros e a base comuns. Cada chatbot derivado (template_id) usa as ações, os roteiros e a base
-- do modelo, e recebe gravados os campos herdados (nome, saudação, aparência, anúncio, instruções):
-- o chat lê o derivado como sempre. O modelo decide o que o derivado pode mudar
-- (template_unlocked); os valores próprios do derivado ficam em overrides e não são sobrescritos
-- na propagação. Instruções extras do derivado (extra_instructions) somam às do modelo. Ver
-- src/lib/bot-template.ts. Idempotente.
alter table public.bots add column if not exists is_template boolean not null default false;
-- sem "on delete": o modelo com derivados não sai sozinho (a exclusão da conta leva tudo junto)
alter table public.bots add column if not exists template_id uuid references public.bots(id);
alter table public.bots add column if not exists template_unlocked text[] not null default array['nome', 'saudacao', 'aparencia', 'anuncio', 'instrucoes', 'base']::text[];
-- os valores próprios do derivado nos campos que o modelo libera (nome, saudação, aparência, anúncio):
-- guardados mesmo quando o modelo trava o campo depois, para voltarem se ele liberar de novo
alter table public.bots add column if not exists overrides jsonb not null default '{}'::jsonb;
alter table public.bots drop constraint if exists bots_overrides_check;
alter table public.bots add constraint bots_overrides_check check (jsonb_typeof(overrides) = 'object' and octet_length(overrides::text) <= 16384);
alter table public.bots add column if not exists extra_instructions text;
-- a base própria do derivado entra na busca? (gravado pela propagação: só se o modelo libera "base")
alter table public.bots add column if not exists own_base boolean not null default true;
alter table public.bots drop constraint if exists bots_extra_instructions_check;
alter table public.bots add constraint bots_extra_instructions_check check (extra_instructions is null or char_length(extra_instructions) <= 4000);
alter table public.bots drop constraint if exists bots_template_shape_check;
alter table public.bots add constraint bots_template_shape_check check (not is_template or (template_id is null and client_id is null and not is_demo));
create index if not exists bots_template_idx on public.bots (template_id) where template_id is not null;
create index if not exists bots_templates_idx on public.bots (agency_id) where is_template;

-- o derivado aponta para um modelo da mesma conta; um modelo com derivados não deixa de ser modelo
create or replace function public.bots_check_template()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  t record;
begin
  if tg_op = 'UPDATE' and old.is_template and not new.is_template and exists (select 1 from public.bots d where d.template_id = new.id) then
    raise exception 'o modelo tem chatbots derivados' using errcode = '23514';
  end if;
  if new.template_id is null then
    return new;
  end if;
  if new.is_template then
    raise exception 'um modelo não deriva de outro' using errcode = '23514';
  end if;
  select b.is_template, b.agency_id into t from public.bots b where b.id = new.template_id;
  if not found or not t.is_template then
    raise exception 'template_id precisa apontar para um modelo' using errcode = '23514';
  end if;
  if t.agency_id <> new.agency_id then
    raise exception 'o modelo precisa ser da mesma conta' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists bots_check_template on public.bots;
create trigger bots_check_template before insert or update of template_id, is_template, agency_id on public.bots
  for each row execute function public.bots_check_template();

-- a busca de um derivado lê também a base do modelo (p_also_bot_id)
drop function if exists public.match_chunks(uuid, vector, int, float, jsonb);
drop function if exists public.match_chunks(uuid, vector, int, float, jsonb, uuid);
create function public.match_chunks(
  p_bot_id uuid,
  p_query vector(1536),
  p_count int default 6,
  p_min_similarity float default 0.15,
  p_context jsonb default null,
  p_also_bot_id uuid default null
) returns table (id bigint, content text, metadata jsonb, similarity float, gate_version text, gate_segments jsonb, gate_categories text[])
language sql stable set search_path = public as $$
  -- "materialized": primeiro só os trechos do bot (e do modelo), gerais e os do contexto ativo,
  -- depois a distância de cada um
  with scoped as materialized (
    select c.id, c.content, c.metadata, c.embedding <=> p_query as distance, c.gate_version, c.gate_segments, c.gate_categories
    from public.chunks c
    where (c.bot_id = p_bot_id or (p_also_bot_id is not null and c.bot_id = p_also_bot_id))
      and (c.context is null or (p_context is not null and p_context @> c.context))
  )
  select s.id, s.content, s.metadata, 1 - s.distance as similarity, s.gate_version, s.gate_segments, s.gate_categories
  from scoped s
  where 1 - s.distance > p_min_similarity
  order by s.distance
  limit p_count;
$$;
revoke all on function public.match_chunks(uuid, vector, int, float, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.match_chunks(uuid, vector, int, float, jsonb, uuid) to service_role;

notify pgrst, 'reload schema';
