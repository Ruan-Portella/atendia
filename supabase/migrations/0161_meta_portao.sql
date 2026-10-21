-- Os avisos da Meta e o portão (itens menores da conferência de 20/10, parte 3). O chatbot guarda
-- quando o dono foi avisado do primeiro pedido de item 18+ sem um canal para esses pedidos (site, app
-- ou telefone): o aviso sai uma vez por chatbot. O ACCOUNT_RECONNECTED e o carrinho da Meta não
-- pedem coluna nova (o acesso da inatividade da coexistência fica guardado no canal). Idempotente.

alter table public.bots add column if not exists regulated_notice_at timestamptz;

notify pgrst, 'reload schema';
