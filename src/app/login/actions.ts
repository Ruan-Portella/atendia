"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { checkLoginCode, requestLoginCode } from "@/lib/login-code";
import { logAccess, requestIp } from "@/lib/access-log";
import { safeLocalPath } from "@/lib/utils";
import { DEVICE_COOKIE, recordLoginDevice } from "@/lib/person-signals";
import { cookies } from "next/headers";

/** "Receber código": manda o código para o e-mail (cria a conta se o e-mail é novo). */
export async function sendLoginCode(formData: FormData): Promise<ActionResult> {
  const h = await headers();
  const r = await requestLoginCode(createAdminClient(), { email: String(formData.get("email") ?? ""), ip: requestIp(h) ?? "unknown" });
  return r.ok ? ok("Código enviado.") : fail(r.message);
}

/** "Entrar": confere o código, abre a sessão e segue para onde a pessoa ia (convite, painel). */
export async function verifyLoginCode(formData: FormData): Promise<ActionResult> {
  const h = await headers();
  const ip = requestIp(h);
  const supabase = await createClient();
  const admin = createAdminClient();
  const r = await checkLoginCode(admin, supabase.auth, { email: String(formData.get("email") ?? ""), code: formData.get("code"), ip: ip ?? "unknown" });
  if (!r.ok) return fail(r.message);
  // registro de acesso (Marco Civil): a entrada que o servidor vê
  const userAgent = h.get("user-agent");
  after(() => logAccess(admin, { actorType: "user", actorId: r.userId, event: "login", ip, userAgent }));
  // o navegador do dono (Trava da conta grátis)
  const device = (await cookies()).get(DEVICE_COOKIE)?.value ?? null;
  after(() => recordLoginDevice(admin, r.userId, device));
  redirect(safeLocalPath(String(formData.get("next") ?? ""), "/painel/clientes"));
}
