-- Boavoz · ações de transação × catálogo (P1). Classificado pela IA do BoaVoz ao salvar, sem
-- contestação (spec, portão das ações). Transação (pedido, carrinho, reserva, cobrança, conta da
-- pessoa): bebida e remédio nunca são listados no WhatsApp e no Instagram, com qualquer idade
-- ("avisos de status sem listar a bebida"; regulated_in_transaction). Catálogo (cardápio,
-- produtos, preços): vale a regra de idade. O padrão é o mais restrito (transação) até a ação ser
-- salva de novo. Ver src/lib/action-gate.ts. Idempotente.
alter table public.actions add column if not exists transactional boolean not null default true;

notify pgrst, 'reload schema';
