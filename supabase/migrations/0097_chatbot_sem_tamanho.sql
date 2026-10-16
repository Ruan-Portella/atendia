-- Boavoz · chatbot novo nasce sem tamanho (revisão de preços, parte 4b; 16/10/2026).
-- Com a assinatura por tamanho, o tamanho é o que a conta paga: chatbot criado depois (pelo
-- painel, por uma demo convertida ou pelo servidor) começa sem tamanho e sem cota, até a agência
-- escolher um em Cobrança → Assinatura. Os chatbots que já existem ficam como estão. Idempotente.

alter table public.bots alter column size drop default;

create or replace function public.guard_bot_quota() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.size := null;
      new.volume_packs := null;
      new.quota_override := null;
      new.overage_enabled := false;
      new.overage_cap_brl := null;
      new.pending_size := null;
      new.pending_volume_packs := null;
      new.pending_from := null;
      new.prorated_month := null;
      new.prorated_quota := null;
    elsif new.size is distinct from old.size or new.volume_packs is distinct from old.volume_packs or new.quota_override is distinct from old.quota_override
      or new.overage_enabled is distinct from old.overage_enabled or new.overage_cap_brl is distinct from old.overage_cap_brl
      or new.pending_size is distinct from old.pending_size or new.pending_volume_packs is distinct from old.pending_volume_packs or new.pending_from is distinct from old.pending_from
      or new.prorated_month is distinct from old.prorated_month or new.prorated_quota is distinct from old.prorated_quota then
      raise exception 'o tamanho, a cota e o excedente do chatbot só mudam pelo servidor' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
