-- Boavoz · cancelamento agendado da assinatura (revisão de preços, parte 4d; 16/10/2026).
-- Cancelar no portal da Stripe vale no fim do período (dia 1º): até lá, tudo segue. O webhook
-- guarda a data para o painel avisar e oferecer "reativar". Idempotente.
alter table public.agencies add column if not exists billing_cancel_at timestamptz;
