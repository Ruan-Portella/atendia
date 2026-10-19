-- Boavoz · Roteiros (leva B2', parte 1, Peça 6 da spec): passos que a IA segue quando a conversa
-- entra num assunto (segunda via, troca, orçamento). Cadastro por chatbot, na aba Roteiros; o motor
-- na conversa vem na parte 2. Os passos ficam num jsonb validado no servidor (src/lib/routines.ts):
-- instrução, pedir um dado, botões e ação, com os destinos por id de passo. Configuração da agência,
-- sem dado do contato: sem cifra. Só o servidor lê e grava (como as ações). Idempotente.

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  bot_id uuid not null references public.bots(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 60),
  when_to_use text not null check (char_length(when_to_use) between 10 and 500),
  -- normalizadas (minúsculas, sem acento): a mensagem que é só uma delas começa o roteiro
  keywords text[] not null default '{}',
  steps jsonb not null check (jsonb_typeof(steps) = 'array'),
  active boolean not null default true,
  -- modelo pronto de origem (decisão de 19/10/2026), só para saber de onde veio
  template text check (template is null or template in ('orcamento', 'agendamento', 'troca', 'segunda_via', 'rastreio')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists routines_bot_name_idx on public.routines (bot_id, lower(name));
alter table public.routines enable row level security;
revoke all on public.routines from anon, authenticated;
grant all on public.routines to service_role;

notify pgrst, 'reload schema';
