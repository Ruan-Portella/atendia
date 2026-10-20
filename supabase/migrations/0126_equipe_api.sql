-- Boavoz · equipe do portal pela API (D', parte 4c, 19/10/2026; spec, "API de provisionamento",
-- passo 4).
--
-- client_members.invited_by_key: a chave de API que convidou a pessoa (POST
-- /v1/clients/{id}/members, permissão members). Ao revogar a chave, a tela das chaves mostra quantas
-- pessoas ela convidou, com "remover todas"; o resumo diário ao dono e o alerta de mais de 20
-- convites em 24 horas leem a auditoria. Convite pelo painel fica com null. Idempotente.

alter table public.client_members add column if not exists invited_by_key uuid references public.api_keys(id) on delete set null;
create index if not exists client_members_invited_by_key_idx on public.client_members (invited_by_key) where invited_by_key is not null;
