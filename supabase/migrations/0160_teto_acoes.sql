-- Os tetos das chamadas de ação (itens menores da conferência de 20/10, parte 2; spec, Tetos de
-- chamadas): além das 15 por minuto por conversa e das 600 por minuto por chatbot, o teto do mês é
-- 10 vezes a cota do chatbot (no mínimo 1.000, para o teste e as demos). O contador do mês fica numa
-- tabela própria (hit_action_month, atômico): o limite genérico (rate_limits) apaga as janelas com
-- mais de 2 dias e não serve para contar o mês. Quando um teto é batido, o chatbot guarda quando e
-- qual (o aviso no painel) e o dono recebe e-mail (uma vez por dia o do minuto, uma vez por mês o do
-- mês). Sem policy: só o servidor lê e escreve. Idempotente.

create table if not exists public.bot_action_month (
  bot_id uuid not null references public.bots(id) on delete cascade,
  month date not null,
  calls int not null default 0,
  primary key (bot_id, month)
);
alter table public.bot_action_month enable row level security;
revoke all on public.bot_action_month from anon, authenticated;
grant all on public.bot_action_month to service_role;

alter table public.bots add column if not exists action_cap_hit_at timestamptz;
alter table public.bots add column if not exists action_cap_kind text;
alter table public.bots drop constraint if exists bots_action_cap_kind_check;
alter table public.bots add constraint bots_action_cap_kind_check check (action_cap_kind is null or action_cap_kind in ('minuto', 'mes'));

/* Conta uma chamada de ação do chatbot no mês (São Paulo). true = dentro do teto. */
create or replace function public.hit_action_month(p_bot_id uuid, p_cap int) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', now() at time zone 'America/Sao_Paulo')::date;
  n int;
begin
  insert into public.bot_action_month (bot_id, month, calls) values (p_bot_id, v_month, 1)
  on conflict (bot_id, month) do update set calls = public.bot_action_month.calls + 1
  returning calls into n;
  return n <= p_cap;
end $$;
revoke all on function public.hit_action_month(uuid, int) from public, anon, authenticated;
grant execute on function public.hit_action_month(uuid, int) to service_role;

notify pgrst, 'reload schema';
