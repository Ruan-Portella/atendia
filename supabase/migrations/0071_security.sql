-- Leva S, parte 4: tela de Segurança da agência.
-- Alertas: eventos graves da auditoria (chave nova, URL trocada, acesso do suporte, suspensão,
-- segundo fator removido…) vão por e-mail ao dono na hora e ficam numa faixa no topo do painel até
-- ele marcar como vistos.
-- Suporte: a equipe do BoaVoz só lê conversas de uma agência com a liberação dela, por 24 horas e
-- com motivo; cada leitura vai para a auditoria (a agência vê). A liberação fica como histórico.

alter table public.agencies add column if not exists security_alerts_seen_at timestamptz;

create table if not exists public.support_access_grants (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies(id) on delete cascade,
  granted_by text not null,
  reason text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by text,
  created_at timestamptz not null default now()
);
create index if not exists support_access_grants_agency_idx on public.support_access_grants (agency_id, expires_at desc);

alter table public.support_access_grants enable row level security;
drop policy if exists support_access_grants_agency_read on public.support_access_grants;
create policy support_access_grants_agency_read on public.support_access_grants for select to authenticated
  using (agency_id = (select public.my_agency_id()));
revoke all on public.support_access_grants from anon, authenticated;
grant select on public.support_access_grants to authenticated;
grant all on public.support_access_grants to service_role;

notify pgrst, 'reload schema';
