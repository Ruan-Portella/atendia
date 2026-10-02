-- Boavoz · segurança: o dono da agência só altera, pela própria sessão, as colunas que o painel
-- edita. A política agencies_owner ("for all") deixava a sessão do usuário mudar qualquer coluna
-- da própria linha pela API do Supabase: plano, fim do teste, Stripe, pausa da IA… (assinar sem
-- pagar). Também deixava criar a agência já com plano pago, antes do primeiro acesso ao painel.
-- Plano, teste, Stripe, avisos e pausa da IA são gravados só pelo servidor (service role, que
-- não passa por estes grants). Independe das migrações 0026–0039: pode ir para produção antes.
-- Idempotente.

revoke insert, update, delete on public.agencies from anon, authenticated;

-- o que o painel grava com a sessão do usuário (marca, domínio próprio, privacidade/retenção)
grant update (name, slug, brand_color, support_whatsapp, logo_url, custom_domain, custom_domain_verified_at, privacy_url, retention_months)
  on public.agencies to authenticated;
