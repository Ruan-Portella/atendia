-- Atendia · releitura automática dos sites e respostas pelo painel
-- Idempotente.

alter table public.sources
  add column if not exists content_hash text,             -- hash do texto indexado: se o site não mudou, não gasta embedding
  add column if not exists last_refreshed_at timestamptz, -- última leitura (manual ou automática)
  add column if not exists refresh_error text;            -- erro da última releitura automática (a fonte continua valendo)

-- fontes existentes contam como lidas na última atualização
update public.sources set last_refreshed_at = updated_at where last_refreshed_at is null and status = 'ready';

alter table public.bots
  add column if not exists auto_refresh boolean not null default true; -- reler sites/páginas toda semana

create index if not exists sources_refresh_idx on public.sources(last_refreshed_at) where kind in ('site', 'page');

notify pgrst, 'reload schema';
