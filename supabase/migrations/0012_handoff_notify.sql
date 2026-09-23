-- Atendia · quem recebe o e-mail de "visitante quer falar com alguém", por cliente
-- Idempotente.
--   all    → agência (e o e-mail de aviso do chatbot) + pessoas do cliente
--   client → só as pessoas do cliente (a agência delegou o atendimento)

alter table public.clients
  add column if not exists handoff_notify text not null default 'all'
    check (handoff_notify in ('all', 'client'));

notify pgrst, 'reload schema';
