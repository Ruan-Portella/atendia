import type { SupabaseClient } from "@supabase/supabase-js";

/*
 * Registros de acesso (Marco Civil, art. 15): IP completo, data e hora, por 6 meses, só inserção
 * (ver a migração 0044). access_log = painel da agência, área do cliente e backoffice;
 * widget_access_log = visitantes do chat do site, sob sigilo (sem tela).
 */

export type AccessActor = "user" | "member" | "support";
export type AccessEvent = "session" | "login" | "login_failed" | "magic_link" | "logout";

/** Só IPv4 ou IPv6 vão para a coluna inet; o resto vira null (a linha ainda vale pelo horário). */
export function validIp(ip: string | null | undefined): string | null {
  const v = ip?.trim();
  if (!v) return null;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(v)) return v.split(".").every((n) => Number(n) <= 255) ? v : null;
  return /^[0-9a-f:]+$/i.test(v) && v.includes(":") ? v : null;
}

/** "Chrome no Windows": o navegador e o sistema, sem o texto inteiro do user agent. Pura. */
export function deviceOf(ua: string | null): string {
  if (!ua) return "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "navegador";
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} no ${os}` : browser;
}

/** Dia em Brasília (a sessão é registrada uma vez por pessoa, IP e dia). */
export const accessDay = (now = new Date()) => now.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** IP do cliente, como a Vercel repassa. */
export const requestIp = (headers: Headers) => headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;

/** Agência de quem acessou: a da equipe (dono, administrador, editor, atendente), ou a do cliente de que o membro do portal faz parte. */
async function agencyOf(db: SupabaseClient, actorType: AccessActor, actorId: string, email?: string | null): Promise<string | null> {
  if (actorType === "user") {
    const { data } = await db.from("agency_members").select("agency_id").eq("user_id", actorId).is("removed_at", null).not("accepted_at", "is", null).maybeSingle();
    return (data?.agency_id as string | undefined) ?? null;
  }
  if (actorType === "member" && email) {
    const { data } = await db.from("client_members").select("clients(agency_id)").eq("email", email.toLowerCase()).limit(1).maybeSingle();
    const c = (Array.isArray(data?.clients) ? data.clients[0] : data?.clients) as { agency_id?: string } | null | undefined;
    return c?.agency_id ?? null;
  }
  return null;
}

export async function logAccess(
  db: SupabaseClient,
  o: { actorType: AccessActor; actorId: string; email?: string | null; event: AccessEvent; ip: string | null; userAgent: string | null; agencyId?: string | null },
): Promise<void> {
  try {
    const agencyId = o.agencyId !== undefined ? o.agencyId : await agencyOf(db, o.actorType, o.actorId, o.email);
    const row = { agency_id: agencyId, actor_type: o.actorType, actor_id: o.actorId, event: o.event, ip: validIp(o.ip), user_agent: o.userAgent?.slice(0, 300) ?? null, day: o.event === "session" ? accessDay() : null };
    // sessão: uma linha por pessoa, IP e dia (o índice único segura o repetido)
    const { error } = o.event === "session" ? await db.from("access_log").upsert(row, { onConflict: "actor_type,actor_id,ip,day", ignoreDuplicates: true }) : await db.from("access_log").insert(row);
    if (error) console.error("acesso não registrado", o.event, error.message);
  } catch (e) {
    console.error("acesso não registrado", o.event, e);
  }
}

/**
 * Chat do site: uma linha quando a conversa começa e outra quando o IP muda, nunca uma por
 * mensagem. Sem IP válido, não grava.
 */
export async function logWidgetAccess(db: SupabaseClient, o: { botId: string; conversationId: string; ip: string | null; isNew: boolean }): Promise<void> {
  const ip = validIp(o.ip);
  if (!ip) return;
  try {
    if (!o.isNew) {
      const { data } = await db.from("widget_access_log").select("ip").eq("conversation_id", o.conversationId).order("id", { ascending: false }).limit(1).maybeSingle();
      if (data?.ip === ip) return;
    }
    const { error } = await db.from("widget_access_log").insert({ bot_id: o.botId, conversation_id: o.conversationId, ip });
    if (error) console.error("acesso do widget não registrado", error.message);
  } catch (e) {
    console.error("acesso do widget não registrado", e);
  }
}
