import type { SupabaseClient } from "@supabase/supabase-js";
import { company } from "./company";
import { firstExceeded, hashId } from "./rate-limit";
import { isEmail } from "./validation";
import { isDisposableEmail } from "./disposable-email";

/*
 * Entrar e criar conta com um código no e-mail, sem senha (Entrada e docs, parte 3, 19/10/2026),
 * como a área do cliente: o Supabase gera o código (generateLink devolve o email_otp), o BoaVoz
 * manda pela Resend com a marca dele e confere no servidor (verifyOtp), com limite por e-mail e
 * por IP. E-mail novo vira conta na hora; a agência nasce no primeiro acesso. Sem a Resend no
 * ambiente (a dev, por enquanto), só o Google.
 */

export const LOGIN_CODE_TEXTS = {
  noEmail: "O código por e-mail ainda não está ligado neste ambiente. Entre com o Google.",
  invalidEmail: "Digite um e-mail válido.",
  disposable: "Use um e-mail seu, de trabalho ou pessoal: e-mails temporários não abrem conta no BoaVoz.",
  tooMany: "Muitas tentativas. Espere alguns minutos e tente de novo.",
  wait: "Espere um pouco antes de pedir outro código.",
  failed: "Não foi possível mandar o código agora. Tente de novo em instantes.",
  invalidCode: "Digite o código que chegou no e-mail (só os números).",
  wrongCode: "Código errado ou vencido. Confira o último e-mail ou peça outro código.",
} as const;

/**
 * Sessão aberta só com senha (o BoaVoz não tem mais senha; o cadastro com senha do Supabase
 * continua aberto por trás e não prova a posse do e-mail): o painel pede para entrar de novo.
 * O segundo fator não muda nada; sem amr no token, deixa passar. Pura.
 */
export function passwordOnlySession(amr: unknown): boolean {
  if (!Array.isArray(amr) || !amr.length) return false;
  const methods = amr.map((e) => (typeof e === "string" ? e : String((e as { method?: string } | null)?.method ?? "")));
  return methods.includes("password") && methods.every((m) => m === "password" || m === "totp");
}

/** O envio de e-mail está ligado neste ambiente. */
export const loginCodeEnabled = () => Boolean(process.env.RESEND_API_KEY);

/** O código como a pessoa digitou ("123 456", "123-456"): só os números, de 6 a 10. Pura. */
export function parseLoginCode(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/[\s.-]/g, "");
  return /^\d{6,10}$/.test(digits) ? digits : null;
}

export const normalizeLoginEmail = (raw: unknown) => String(raw ?? "").trim().toLowerCase();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** O e-mail com o código (o código no assunto, para aparecer já no aviso do celular). Pura. */
export function loginCodeEmail(code: string, brand = company.brand): { subject: string; text: string; html: string } {
  return {
    subject: `${code} é o seu código de acesso ao ${brand}`,
    text: `Seu código para entrar no ${brand}: ${code}\n\nEle vale por 1 hora e só funciona uma vez. Se não foi você que pediu, ignore este e-mail: ninguém entra sem o código.\n\n${brand}`,
    html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1b1f1d">
<p style="font-size:15px;font-weight:bold;margin:0 0 16px">${esc(brand)}</p>
<p style="font-size:15px;line-height:1.5;margin:0 0 12px">Seu código para entrar:</p>
<p style="font-family:'Courier New',monospace;font-size:30px;font-weight:bold;letter-spacing:6px;margin:0 0 20px;color:#1f4e3d">${esc(code)}</p>
<p style="font-size:12px;color:#6a736e;line-height:1.5">Ele vale por 1 hora e só funciona uma vez. Se não foi você que pediu, ignore este e-mail: ninguém entra sem o código.</p></div>`,
  };
}

export type SendLoginEmail = (to: string, mail: { subject: string; text: string; html: string }) => Promise<{ ok: boolean; message?: string }>;

/** Manda pela Resend, com o remetente do ambiente (EMAIL_FROM) e o nome da marca. */
export const sendWithResend: SendLoginEmail = async (to, mail) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, message: "RESEND_API_KEY ausente" };
  const fromAddress = process.env.EMAIL_FROM?.match(/<([^>]+)>/)?.[1] ?? process.env.EMAIL_FROM ?? "onboarding@resend.dev";
  const { Resend } = await import("resend");
  const { error } = await new Resend(apiKey).emails.send({ from: `${company.brand.replace(/["<>]/g, "")} <${fromAddress}>`, to, ...mail });
  return error ? { ok: false, message: error.message } : { ok: true };
};

/**
 * "Receber código": cria a conta se o e-mail é novo (o código do Supabase para e-mail novo seria
 * de cadastro, com outro tipo) e manda o código. Limites: 10 por IP e 5 por e-mail por hora, e um
 * intervalo entre dois pedidos do mesmo e-mail. Pedir de novo troca o código (o anterior para).
 */
export async function requestLoginCode(admin: SupabaseClient, i: { email: string; ip: string }, send: SendLoginEmail = sendWithResend): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!loginCodeEnabled()) return { ok: false, message: LOGIN_CODE_TEXTS.noEmail };
  const email = normalizeLoginEmail(i.email);
  if (!isEmail(email) || email.length > 254) return { ok: false, message: LOGIN_CODE_TEXTS.invalidEmail };
  // a trava da conta grátis: e-mail descartável não entra (nem cria conta)
  if (isDisposableEmail(email)) return { ok: false, message: LOGIN_CODE_TEXTS.disposable };
  const who = hashId(email);
  const over = await firstExceeded(admin, [
    { key: `login-code:ip:${hashId(i.ip)}`, max: 10, windowSeconds: 3600, message: LOGIN_CODE_TEXTS.tooMany, failClosed: true },
    { key: `login-code:email:${who}`, max: 5, windowSeconds: 3600, message: LOGIN_CODE_TEXTS.tooMany, failClosed: true },
    { key: `login-code:gap:${who}`, max: 1, windowSeconds: 45, message: LOGIN_CODE_TEXTS.wait, failClosed: true },
  ]);
  if (over) return { ok: false, message: over.message };

  // já existe: o erro de "já cadastrado" é ignorado
  await admin.auth.admin.createUser({ email, email_confirm: true }).catch(() => null);
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const code = data?.properties?.email_otp;
  if (error || !code) {
    console.error("login por código: o Supabase não gerou o código", error?.message);
    return { ok: false, message: LOGIN_CODE_TEXTS.failed };
  }
  const sent = await send(email, loginCodeEmail(code));
  if (!sent.ok) {
    console.error("login por código: o e-mail não saiu", sent.message);
    return { ok: false, message: LOGIN_CODE_TEXTS.failed };
  }
  return { ok: true };
}

/**
 * Confere o código no servidor, pela sessão do navegador (o cookie da sessão sai na resposta).
 * Limites: 8 tentativas por e-mail a cada 15 minutos e 40 por IP por hora (o código tem de 6 a 10
 * números, conforme o Supabase do ambiente; a dev usa 8).
 */
export async function checkLoginCode(
  admin: SupabaseClient,
  auth: Pick<SupabaseClient["auth"], "verifyOtp">,
  i: { email: string; code: unknown; ip: string },
): Promise<{ ok: true; userId: string } | { ok: false; message: string }> {
  const email = normalizeLoginEmail(i.email);
  if (!isEmail(email)) return { ok: false, message: LOGIN_CODE_TEXTS.invalidEmail };
  const code = parseLoginCode(i.code);
  if (!code) return { ok: false, message: LOGIN_CODE_TEXTS.invalidCode };
  const over = await firstExceeded(admin, [
    { key: `login-verify:email:${hashId(email)}`, max: 8, windowSeconds: 900, message: LOGIN_CODE_TEXTS.tooMany, failClosed: true },
    { key: `login-verify:ip:${hashId(i.ip)}`, max: 40, windowSeconds: 3600, message: LOGIN_CODE_TEXTS.tooMany, failClosed: true },
  ]);
  if (over) return { ok: false, message: over.message };
  const { data, error } = await auth.verifyOtp({ email, token: code, type: "email" });
  if (error || !data.user) return { ok: false, message: LOGIN_CODE_TEXTS.wrongCode };
  return { ok: true, userId: data.user.id };
}
