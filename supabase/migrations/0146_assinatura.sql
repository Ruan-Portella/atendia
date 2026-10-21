-- Caixa de entrada, parte 5 (21/10/2026): a assinatura das mensagens da equipe (spec, Peça 11).
-- O formato fica no chatbot (human_handoff: signature, signature_smart, signature_sector e
-- signature_locked, no jsonb, sem coluna nova). Cada pessoa pode escolher o seu formato quando o
-- chatbot não trava: null = o do chatbot.

alter table public.agency_members add column if not exists signature text check (signature is null or signature in ('nenhuma', 'inicio', 'fim'));
alter table public.client_members add column if not exists signature text check (signature is null or signature in ('nenhuma', 'inicio', 'fim'));
