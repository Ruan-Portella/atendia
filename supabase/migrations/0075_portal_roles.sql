-- Boavoz · leva B1', parte 2b: papéis no portal do cliente.
--
-- client_members.role: gestor (manager) ou atendente (agent). Quem já tinha acesso vira gestor
-- (sem perda de acesso para ninguém). As permissões do cliente continuam sendo o teto que a
-- agência libera (allow_handoff, allow_knowledge) e ganham allow_hours: o gestor edita o horário
-- de atendimento. O atendente vê só Conversas (e Meu perfil).
-- Idempotente.

alter table public.client_members add column if not exists role text not null default 'manager';
alter table public.client_members drop constraint if exists client_members_role_check;
alter table public.client_members add constraint client_members_role_check check (role in ('manager', 'agent'));

alter table public.clients add column if not exists allow_hours boolean not null default false;

notify pgrst, 'reload schema';
