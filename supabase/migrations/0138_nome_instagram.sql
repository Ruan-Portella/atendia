-- BoaVoz · E1 (Lojas de Instagram): o nome de usuário muda no Instagram sem aviso (a Meta não manda
-- webhook disso) e os links ig.me levam o nome: com o antigo, o link abre o Instagram mas não acha a
-- conversa. O painel (ao abrir a aba, no máximo uma vez por minuto) e o cron diário conferem na Meta
-- e trocam o nome; o antigo fica para o painel avisar, por 30 dias, que os links da bio, do QR
-- impresso e dos anúncios pararam.
-- Idempotente.

alter table public.instagram_channels
  add column if not exists previous_username text,
  add column if not exists username_changed_at timestamptz,
  -- a última conferência na Meta (com ou sem troca, e também quando a Meta não respondeu)
  add column if not exists username_checked_at timestamptz;

-- o painel lê o nome antigo e a data da troca (o token continua só no servidor)
grant select (previous_username, username_changed_at) on public.instagram_channels to authenticated;

notify pgrst, 'reload schema';
