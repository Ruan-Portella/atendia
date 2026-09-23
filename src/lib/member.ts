import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "./supabase/server";
import { createAdminClient } from "./supabase/admin";
import { belongsToHost, hostAgency } from "./domain-server";
import { appUrl } from "./utils";
import { isEmail } from "./validation";

/**
 * Área do cliente final (/cliente): pessoas do cliente da agência entram por link mágico.
 *
 * Regra de acesso (conferida em TODA página e ação):
 *  1. o e-mail da sessão está em client_members daquele cliente; e
 *  2. a sessão foi aberta por link mágico (claim `amr` = otp/magiclink). Sem isso, alguém
 *     poderia criar conta com senha usando o e-mail do cliente e herdar o acesso;
 *  3. o link foi usado há menos de MEMBER_SESSION_DAYS dias. Depois disso a pessoa é
 *     deslogada e pede um link novo (a data vem do próprio token: amr.timestamp).
 * Os dados são lidos com a service role, sempre filtrando pelo cliente autorizado.
 */

export interface Membership {
  clientId: string;
  clientName: string;
  agencyId: string;
  allowHandoff: boolean;
  allowKnowledge: boolean;
  agency: { name: string; logo_url: string | null; brand_color: string; support_whatsapp: string | null; custom_domain: string | null; custom_domain_verified_at: string | null };
}

/** Métodos de sessão que provam posse do e-mail (link/código enviado para ele). Senha e Google não. */
const MAGIC_METHODS = new Set(["otp", "magiclink", "email/signup", "invite"]);

/** Tipos de token de e-mail aceitos no /cliente/auth. */
export const EMAIL_LINK_TYPES = ["magiclink", "signup", "invite", "email"] as const;

/** true se a sessão foi aberta por link mágico / código por e-mail. */
export function isEmailLinkSession(amr: unknown): boolean {
  if (!Array.isArray(amr)) return false;
  return amr.some((e) => MAGIC_METHODS.has(typeof e === "string" ? e : (e as { method?: string })?.method ?? ""));
}

/** Quantos dias vale o acesso aberto por um link; depois, desloga e pede um link novo. */
export const MEMBER_SESSION_DAYS = 7;

/**
 * Quando o link do e-mail foi usado (segundos Unix), pelo claim `amr` do token. É a data do
 * login, não da última renovação da sessão. null quando o token não traz a data.
 */
export function emailLinkLoginAt(amr: unknown): number | null {
  if (!Array.isArray(amr)) return null;
  const times = amr
    .filter((e) => typeof e === "object" && e && MAGIC_METHODS.has(String((e as { method?: string }).method)))
    .map((e) => Number((e as { timestamp?: number }).timestamp))
    .filter((t) => Number.isFinite(t) && t > 0);
  return times.length ? Math.max(...times) : null;
}

/** O acesso passou do prazo? Sem data no token, não derruba (evita trancar todo mundo para fora). */
export function isMemberSessionExpired(amr: unknown, nowMs = Date.now(), days = MEMBER_SESSION_DAYS): boolean {
  const at = emailLinkLoginAt(amr);
  return at !== null && nowMs - at * 1000 > days * 86_400_000;
}

export interface MemberSession {
  email: string;
  /** passou dos 7 dias: precisa sair e pedir um link novo */
  expired: boolean;
  memberships: Membership[];
}

export const getMemberSession = cache(async (): Promise<MemberSession | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const email = typeof claims?.email === "string" ? claims.email.toLowerCase() : "";
  if (!email || !isEmailLinkSession(claims?.amr)) return null;
  if (isMemberSessionExpired(claims?.amr)) return { email, expired: true, memberships: [] };
  const { data: rows } = await createAdminClient()
    .from("client_members")
    .select("client_id, clients!inner(id, name, agency_id, allow_handoff, allow_knowledge, agencies!inner(name, logo_url, brand_color, support_whatsapp, custom_domain, custom_domain_verified_at))")
    .eq("email", email);
  const memberships = (rows ?? []).map((r) => {
    const c = (Array.isArray(r.clients) ? r.clients[0] : r.clients) as Record<string, unknown>;
    const a = (Array.isArray(c.agencies) ? c.agencies[0] : c.agencies) as Membership["agency"];
    return { clientId: String(c.id), clientName: String(c.name), agencyId: String(c.agency_id), allowHandoff: Boolean(c.allow_handoff), allowKnowledge: Boolean(c.allow_knowledge), agency: a };
  });
  return { email, expired: false, memberships };
});

/** Leva para a rota que encerra a sessão vencida e mostra a tela de pedir link. */
export const expiredRedirect = (next: string) => `/cliente/expirou?next=${encodeURIComponent(next)}`;

/**
 * Exige acesso ao cliente. Sem sessão válida → tela de entrada; acesso vencido (7 dias) →
 * desloga e pede link novo; sem acesso a este cliente (ou domínio de outra agência) → 404.
 * Devolve a service role já "presa" ao cliente.
 */
export async function requireMember(clientId: string, permission?: "handoff" | "knowledge"): Promise<{ email: string; member: Membership; admin: SupabaseClient; botIds: string[] }> {
  const session = await getMemberSession();
  if (!session) redirect(`/cliente/entrar?next=${encodeURIComponent(`/cliente/${clientId}`)}`);
  if (session.expired) redirect(expiredRedirect(`/cliente/${clientId}`));
  const member = session.memberships.find((m) => m.clientId === clientId);
  if (!member || !(await belongsToHost(member.agencyId))) notFound();
  if (permission === "handoff" && !member.allowHandoff) notFound();
  if (permission === "knowledge" && !member.allowKnowledge) notFound();
  const admin = createAdminClient();
  const { data: bots } = await admin.from("bots").select("id").eq("client_id", clientId).eq("is_demo", false);
  return { email: session.email, member, admin, botIds: (bots ?? []).map((b) => b.id) };
}

/**
 * Onde o link mágico deve cair (o cookie da sessão vale só no domínio em que foi criado).
 * Nunca vem do cabeçalho Host cru — senão um Host forjado mandaria o token para outro site:
 * é o domínio verificado da agência da requisição, ou o endereço do app.
 */
export async function currentOrigin(): Promise<string> {
  const agency = await hostAgency();
  return agency?.custom_domain && agency.custom_domain_verified_at ? `https://${agency.custom_domain}` : appUrl();
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/**
 * Gera o link mágico do Supabase (cria o usuário se preciso) e manda por e-mail com a marca
 * da agência. O link aponta para /cliente/auth no `origin`, que valida o token no servidor.
 */
export async function sendMemberLink(opts: { email: string; origin: string; next: string; clientName: string; agency: Membership["agency"] }): Promise<{ ok: true } | { ok: false; message: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, message: "O envio de e-mail não está configurado neste servidor (RESEND_API_KEY)." };
  if (!isEmail(opts.email)) return { ok: false, message: "E-mail inválido." };

  const admin = createAdminClient();
  // Cria a conta antes (se já existir, o erro é ignorado): para e-mail novo, o Supabase
  // geraria um link de *cadastro* em vez de login, com outro tipo de token.
  await admin.auth.admin.createUser({ email: opts.email, email_confirm: true }).catch(() => null);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email: opts.email });
  const hashed = data?.properties?.hashed_token;
  if (error || !hashed) return { ok: false, message: "Não foi possível gerar o link de acesso. Tente de novo." };
  // o tipo vai junto: a validação precisa usar exatamente o tipo do token gerado
  const type = data.properties.verification_type ?? "magiclink";
  const link = `${opts.origin}/cliente/auth?token_hash=${encodeURIComponent(hashed)}&type=${encodeURIComponent(type)}&next=${encodeURIComponent(opts.next)}`;

  const color = /^#[0-9a-f]{6}$/i.test(opts.agency.brand_color) ? opts.agency.brand_color : "#1f4e3d";
  const fromAddress = process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "onboarding@resend.dev";
  const { Resend } = await import("resend");
  const { error: sendError } = await new Resend(apiKey).emails.send({
    from: `${opts.agency.name.replace(/["<>]/g, "")} <${fromAddress}>`,
    to: opts.email,
    subject: `Seu acesso ao assistente de ${opts.clientName}`,
    text: `Clique para entrar na área do cliente de ${opts.clientName} (o link vale por 1 hora e só funciona uma vez):\n\n${link}\n\nSe não foi você que pediu, ignore este e-mail.\n\n${opts.agency.name}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1b1f1d">
<p style="font-size:15px;font-weight:bold;margin:0 0 16px">${esc(opts.agency.name)}</p>
<p style="font-size:15px;line-height:1.5">Clique no botão para entrar na área do cliente de <strong>${esc(opts.clientName)}</strong>.</p>
<p style="margin:22px 0"><a href="${esc(link)}" style="background:${color};color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:9px;display:inline-block">Entrar</a></p>
<p style="font-size:12px;color:#6a736e">O link vale por 1 hora e só funciona uma vez. Se não foi você que pediu, ignore este e-mail.</p></div>`,
  });
  if (sendError) return { ok: false, message: `O e-mail não foi enviado: ${sendError.message}` };
  return { ok: true };
}

/** Mesma regra de requireMember, para server actions: devolve null em vez de redirecionar. */
export async function memberForAction(clientId: string, permission?: "handoff" | "knowledge") {
  const session = await getMemberSession();
  const member = session?.memberships.find((m) => m.clientId === clientId);
  if (!session || !member || !(await belongsToHost(member.agencyId))) return null;
  if (session?.expired) return null;
  if (permission === "handoff" && !member.allowHandoff) return null;
  if (permission === "knowledge" && !member.allowKnowledge) return null;
  const admin = createAdminClient();
  const { data: bots } = await admin.from("bots").select("id").eq("client_id", clientId).eq("is_demo", false);
  return { email: session.email, member, admin, botIds: (bots ?? []).map((b) => b.id) };
}
