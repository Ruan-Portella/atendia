-- Atendia · detecção de instalação do widget
-- Rode no SQL Editor do Supabase depois da 0001. O widget.js avisa /api/widget/ping quando
-- carrega no site do cliente; o painel mostra "Instalado em dominio.com.br".

alter table public.bots
  add column if not exists installed_at timestamptz,   -- primeira vez que o widget carregou fora do painel
  add column if not exists installed_host text,        -- último domínio onde carregou
  add column if not exists last_seen_at timestamptz;   -- último carregamento
