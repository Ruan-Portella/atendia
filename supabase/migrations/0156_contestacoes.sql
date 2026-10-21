-- Contestação no cartão (leva Trava da conta grátis, parte 5, 21/10/2026; post do X do Dinzo, 20/10).
-- Quando o banco contesta um pagamento (charge.dispute.*) ou avisa antes que o cartão pode ter sido
-- usado sem o titular saber (radar.early_fraud_warning.created), o BoaVoz encerra a assinatura na
-- hora, marca a pessoa por 12 meses (como na desistência) e guarda a contestação com o rascunho da
-- defesa montado com o que o BoaVoz já registra (entradas no painel, uso, aceite dos termos). O
-- suporte revisa e envia pela Stripe. No aviso antecipado, o pagamento é estornado na hora (evita a
-- contestação e a taxa dela). Sem policy: só o servidor lê e escreve. Idempotente.

alter table public.person_marks drop constraint if exists person_marks_reason_check;
alter table public.person_marks add constraint person_marks_reason_check check (reason in ('desistencia', 'contestacao'));

create table if not exists public.disputes (
  -- o id da Stripe: dp_… (contestação) ou issfr_… (aviso antecipado de fraude)
  id text primary key,
  agency_id uuid references public.agencies(id) on delete set null,
  kind text not null check (kind in ('contestacao', 'aviso_fraude')),
  charge_id text not null,
  amount_cents int not null default 0,
  currency text not null default 'brl',
  reason text,
  status text not null,
  due_by timestamptz,
  evidence jsonb,
  evidence_submitted_at timestamptz,
  submitted_by text,
  outcome text check (outcome is null or outcome in ('ganha', 'perdida', 'aceita', 'estornada', 'encerrada')),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists disputes_agency_idx on public.disputes (agency_id, created_at desc);
create index if not exists disputes_open_idx on public.disputes (due_by) where closed_at is null;
alter table public.disputes enable row level security;
revoke all on public.disputes from anon, authenticated;
grant all on public.disputes to service_role;

notify pgrst, 'reload schema';
