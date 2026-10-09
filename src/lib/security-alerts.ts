import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Alertas de segurança (leva S): eventos graves da auditoria. Cada um vai por e-mail ao dono da
 * agência na hora (audit.ts) e fica na faixa do topo do painel até ele marcar como vistos.
 */

export const SECURITY_ALERTS: Record<string, string> = {
  "api.chave.criar": "Chave de API criada",
  "api.chave.revogar": "Chave de API revogada",
  "identidade.segredo.criar": "Segredo de identidade criado",
  "identidade.segredo.revogar": "Segredo de identidade revogado",
  "acoes.criar": "Ação de integração criada (URL nova)",
  "acoes.editar": "Ação de integração alterada (URL ou configuração)",
  "acoes.segredo": "Segredo das ações trocado",
  "webhook.criar": "Webhook criado (URL nova)",
  "webhook.editar": "Webhook alterado (URL, eventos, escopo ou cabeçalhos)",
  "suporte.liberar": "Acesso do suporte BoaVoz liberado",
  "canal.suspender": "Canal suspenso pela equipe BoaVoz",
  "seguranca.mfa_remover": "Segundo fator removido",
  "equipe.admin_novo": "Novo administrador na equipe",
};

export const isSecurityAlert = (action: string) => action in SECURITY_ALERTS;

export interface PendingAlert {
  id: number;
  action: string;
  label: string;
  created_at: string;
}

/** Eventos graves desde o último "vistos" (últimos 30 dias, até 5). */
export async function pendingAlerts(db: SupabaseClient, agencyId: string, seenAt: string | null): Promise<PendingAlert[]> {
  const since = [seenAt ?? "", new Date(Date.now() - 30 * 86_400_000).toISOString()].sort().at(-1)!;
  const { data } = await db.from("audit_log").select("id, action, created_at").eq("agency_id", agencyId).in("action", Object.keys(SECURITY_ALERTS)).gt("created_at", since).order("created_at", { ascending: false }).limit(5);
  return ((data ?? []) as Array<{ id: number; action: string; created_at: string }>).map((r) => ({ ...r, label: SECURITY_ALERTS[r.action] ?? r.action }));
}
