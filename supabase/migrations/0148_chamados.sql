-- Chamados no chat do site (Caixa de entrada, parte 7a, 21/10/2026; spec, Ideias em avaliação,
-- "Widget de chamados", decidido em 28/09/2026: chamado nativo no BoaVoz). O chamado é uma conversa
-- do site com protocolo e status, que reaproveita conversas, auditoria, retenção e LGPD; quem abre
-- vira lead (nome, e-mail e telefone) e o pedido entra na Caixa de entrada.

-- o formulário do chatbot: null = desligado; {enabled, mode: aba|sozinho, phone: nao|opcional|obrigatorio, subjects: [...]}
alter table public.bots add column if not exists ticket_form jsonb;

alter table public.conversations add column if not exists ticket_protocol text;
alter table public.conversations add column if not exists ticket_status text check (ticket_status is null or ticket_status in ('aberto', 'em_andamento', 'aguardando_cliente', 'resolvido'));
alter table public.conversations add column if not exists ticket_subject text check (ticket_subject is null or char_length(ticket_subject) <= 60);
alter table public.conversations add column if not exists ticket_opened_at timestamptz;
alter table public.conversations add column if not exists ticket_resolved_at timestamptz;
create unique index if not exists conversations_ticket_protocol_idx on public.conversations (ticket_protocol) where ticket_protocol is not null;
