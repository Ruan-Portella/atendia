-- Leva das sobras, parte 3 (LGPD e segurança). Idempotente.
--
-- (1) Recusar o pedido do titular com motivo: o pedido sai de "aguardando" para "recusado", com
-- quem recusou e o motivo (o contato recebe o motivo pelo canal, dentro da janela). A LGPD admite
-- manter dados por obrigação legal ou exercício de direitos (art. 16), sempre com a justificativa.
alter table public.data_subject_requests drop constraint if exists data_subject_requests_status_check;
alter table public.data_subject_requests add constraint data_subject_requests_status_check check (status in ('aguardando', 'executado', 'recusado'));
alter table public.data_subject_requests add column if not exists refused_at timestamptz;
alter table public.data_subject_requests add column if not exists refused_by text;
alter table public.data_subject_requests add column if not exists refuse_reason text;
alter table public.data_subject_requests drop constraint if exists data_subject_requests_refuse_reason_check;
alter table public.data_subject_requests add constraint data_subject_requests_refuse_reason_check check (refuse_reason is null or char_length(refuse_reason) between 10 and 500);

-- (2) Encerrar as sessões de outra pessoa da equipe (celular perdido, saída da empresa): a marca
-- na pessoa derruba no painel, na hora, a sessão aberta antes dela; a função apaga as sessões no
-- Auth, e a renovação do acesso deixa de funcionar. Sem permissão no Auth, devolve -1 (a marca
-- continua valendo).
alter table public.agency_members add column if not exists sessions_revoked_at timestamptz;

create or replace function public.end_user_sessions(p_user uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  delete from auth.sessions where user_id = p_user;
  get diagnostics n = row_count;
  return n;
exception when others then
  return -1;
end;
$$;
revoke all on function public.end_user_sessions(uuid) from public, anon, authenticated;
grant execute on function public.end_user_sessions(uuid) to service_role;

notify pgrst, 'reload schema';
