-- Boavoz · desfaz a 0061 (decisão de 2026-10-03): ver um pedido não é vender. Bebida e remédio
-- seguem a regra do 18+ também em pedidos; o que separa ver de vender é o pagamento (nunca no chat
-- de uma conversa com esses itens) e a compra pelo chat (bloqueada). A classificação pedido ×
-- catálogo deixou de mudar qualquer coisa. Idempotente.
alter table public.actions drop column if exists transactional;

notify pgrst, 'reload schema';
