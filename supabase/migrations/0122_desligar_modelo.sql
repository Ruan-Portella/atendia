-- Boavoz · desligar um chatbot do modelo (D', parte 2c, 19/10/2026; spec, Peça 8).
--
-- O derivado vira chatbot comum, numa transação só: ganha uma cópia das ações (com o segredo do
-- modelo, para o sistema do cliente seguir conferindo a assinatura), dos roteiros (citam as ações
-- pelo nome) e da base do modelo (as fontes gerais e as do contexto fixo dele, com os trechos e os
-- embeddings, sem ler de novo). Os campos herdados já estão gravados nele e ficam; as instruções
-- extras já estão somadas na persona. Serve ao botão "Desligar do modelo", à exclusão do modelo e à
-- transferência de cliente (parte 5). Idempotente.
create or replace function public.detach_from_template(p_bot uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  t uuid;
  ctx jsonb;
  src record;
  new_source uuid;
begin
  select b.template_id, b.fixed_context into t, ctx from public.bots b where b.id = p_bot for update;
  if t is null then
    return false;
  end if;

  -- ações: todas as colunas, com id novo e o chatbot
  insert into public.actions
  select (jsonb_populate_record(null::public.actions, to_jsonb(a) || jsonb_build_object('id', gen_random_uuid(), 'bot_id', p_bot))).*
  from public.actions a
  where a.bot_id = t;

  -- roteiros
  insert into public.routines
  select (jsonb_populate_record(null::public.routines, to_jsonb(r) || jsonb_build_object('id', gen_random_uuid(), 'bot_id', p_bot))).*
  from public.routines r
  where r.bot_id = t;

  -- base: as fontes gerais e as do contexto fixo do chatbot (o PDF fica com o modelo)
  for src in
    select s.id from public.sources s
    where s.bot_id = t and (s.context is null or (ctx is not null and ctx @> s.context))
  loop
    new_source := gen_random_uuid();
    insert into public.sources
    select (jsonb_populate_record(null::public.sources, to_jsonb(s) || jsonb_build_object('id', new_source, 'bot_id', p_bot, 'file_path', null, 'api_key_id', null))).*
    from public.sources s
    where s.id = src.id;
    insert into public.chunks (bot_id, source_id, content, embedding, metadata, gate_version, gate_segments, gate_categories)
    select p_bot, new_source, c.content, c.embedding, c.metadata, c.gate_version, c.gate_segments, c.gate_categories
    from public.chunks c
    where c.source_id = src.id;
  end loop;

  -- o segredo das ações do modelo passa a ser do chatbot (se ele não tiver um)
  update public.bots b
  set action_secret_enc = coalesce(b.action_secret_enc, m.action_secret_enc),
      template_id = null,
      own_base = true,
      overrides = '{}'::jsonb,
      extra_instructions = null
  from public.bots m
  where b.id = p_bot and m.id = t;
  return true;
end;
$$;
revoke all on function public.detach_from_template(uuid) from public, anon, authenticated;
grant execute on function public.detach_from_template(uuid) to service_role;

notify pgrst, 'reload schema';
