-- Pendências do MVP, parte 5 (20/10/2026): o fluxo de nota fiscal (spec, Empresa e Meta), pronto
-- antes do primeiro cliente pagante. Cada pagamento confirmado pela Stripe (fatura paga ou crédito
-- pelo Pix) vira uma "nota a emitir", com o tomador (nome, CPF ou CNPJ e endereço, pedidos no
-- checkout), o valor e a descrição. O backoffice lista para copiar no Emissor Nacional da NFS-e e
-- marcar como emitida; a emissão automática por um serviço emissor fica para depois.
-- Sem ligação com a conta: a nota é registro fiscal e fica mesmo se a conta sair. Sem policy (só o
-- servidor lê e escreve). CPF ou CNPJ e endereço cifrados com a chave da plataforma.

create table if not exists public.fiscal_invoices (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid,
  agency_name text,
  source text not null check (source in ('fatura', 'pix')),
  stripe_ref text not null unique,
  amount_cents int not null check (amount_cents > 0),
  currency text not null default 'brl',
  paid_at timestamptz not null,
  taker_name text,
  taker_tax_type text,
  taker_tax_id_enc text,
  taker_address_enc text,
  description text,
  status text not null default 'a_emitir' check (status in ('a_emitir', 'emitida', 'erro')),
  number text,
  emitted_at timestamptz,
  emitted_by text,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists fiscal_invoices_status_idx on public.fiscal_invoices (status, paid_at);
create index if not exists fiscal_invoices_agency_idx on public.fiscal_invoices (agency_id, paid_at);

alter table public.fiscal_invoices enable row level security;
revoke all on public.fiscal_invoices from anon, authenticated;
grant all on public.fiscal_invoices to service_role;
