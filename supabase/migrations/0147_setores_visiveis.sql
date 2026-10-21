-- Caixa de entrada (21/10/2026, depois do teste do usuário): quem não é do setor não vê a fila nem
-- as conversas dele, nem quem configura. Com a opção ligada na aba Setores do cliente, o dono, o
-- administrador e o editor da agência (com o cliente no escopo) e o gestor da área do cliente veem
-- todos os setores. A conversa sem setor e a que está com a própria pessoa continuam aparecendo.

alter table public.clients add column if not exists managers_see_all_sectors boolean not null default false;
