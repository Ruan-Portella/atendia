-- Boavoz · custo de IA medido (L1, passo 1)
-- Idempotente.

-- Uma linha por resposta do assistente, somando todas as chamadas dela (passos de ferramenta e
-- o embedding da pergunta); leitura de fontes e transcrição de áudio têm linha própria.
-- É a base do custo por atendimento na revisão de preços e do alarme interno de custo.
-- Nunca aparece para a agência. Registros ficam 90 dias; os totais mensais ficam para sempre.
create table if not exists public.ai_usage (
  id bigserial primary key,
  agency_id uuid not null references public.agencies(id) on delete cascade,
  bot_id uuid references public.bots(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  kind text not null,                      -- resposta | leitura | transcricao
  channel text,                            -- widget | demo | painel | whatsapp | instagram
  model text,
  input_tokens int not null default 0,
  cached_input_tokens int not null default 0,
  output_tokens int not null default 0,
  embedding_tokens int not null default 0,
  audio_seconds numeric(10,2),
  cost_usd numeric(12,6),                  -- null quando o modelo não está na tabela de preços
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_agency_idx on public.ai_usage (agency_id, created_at);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at);
alter table public.ai_usage enable row level security; -- sem policy: só o servidor lê e escreve

create table if not exists public.ai_usage_monthly (
  agency_id uuid not null references public.agencies(id) on delete cascade,
  period text not null,                    -- 'AAAA-MM', mês de Brasília
  kind text not null,
  calls int not null default 0,
  input_tokens bigint not null default 0,
  cached_input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  embedding_tokens bigint not null default 0,
  audio_seconds numeric(12,2) not null default 0,
  cost_usd numeric(14,6) not null default 0,
  unpriced int not null default 0,         -- linhas sem preço conhecido (custo abaixo do real)
  primary key (agency_id, period, kind)
);
alter table public.ai_usage_monthly enable row level security;

-- Job diário: refaz os totais dos meses com registros recentes e apaga o que passou de 90 dias.
-- Um mês sai inteiro dos registros só ~60 dias depois de fechar, então o total já está completo.
create or replace function public.ai_usage_rollup()
returns void language sql security definer set search_path = public as $$
  insert into public.ai_usage_monthly as m (agency_id, period, kind, calls, input_tokens, cached_input_tokens, output_tokens, embedding_tokens, audio_seconds, cost_usd, unpriced)
  select agency_id, to_char(created_at at time zone 'America/Sao_Paulo', 'YYYY-MM'), kind, count(*),
         sum(input_tokens), sum(cached_input_tokens), sum(output_tokens), sum(embedding_tokens),
         coalesce(sum(audio_seconds), 0), coalesce(sum(cost_usd), 0), count(*) filter (where cost_usd is null)
  from public.ai_usage
  where created_at >= date_trunc('month', (now() at time zone 'America/Sao_Paulo') - interval '1 month') at time zone 'America/Sao_Paulo'
  group by 1, 2, 3
  on conflict (agency_id, period, kind) do update set
    calls = excluded.calls, input_tokens = excluded.input_tokens, cached_input_tokens = excluded.cached_input_tokens,
    output_tokens = excluded.output_tokens, embedding_tokens = excluded.embedding_tokens,
    audio_seconds = excluded.audio_seconds, cost_usd = excluded.cost_usd, unpriced = excluded.unpriced;
  delete from public.ai_usage where created_at < now() - interval '90 days';
$$;
revoke all on function public.ai_usage_rollup() from public, anon, authenticated;
