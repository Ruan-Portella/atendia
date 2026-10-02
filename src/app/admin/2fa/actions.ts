"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPlatformAdmin } from "@/lib/platform-admin";
import { logAccess } from "@/lib/access-log";
import { requestMeta } from "@/lib/audit";

/**
 * Resultado da segunda etapa do backoffice (o código é conferido no navegador, direto no
 * Supabase): entrada ou falha vai para o registro de acesso da equipe interna.
 */
export async function recordMfaResult(ok: boolean): Promise<void> {
  const { data } = await (await createClient()).auth.getClaims();
  const claims = data?.claims;
  const email = typeof claims?.email === "string" ? claims.email : null;
  if (!claims?.sub || !isPlatformAdmin(email)) return;
  const meta = await requestMeta();
  await logAccess(createAdminClient(), { actorType: "support", actorId: String(claims.sub), email, event: ok ? "login" : "login_failed", ip: meta.ip, userAgent: meta.userAgent, agencyId: null });
}
