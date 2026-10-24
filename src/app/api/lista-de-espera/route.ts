import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { clientIp, firstExceeded, hashId } from "@/lib/rate-limit";
import { joinWaitlist, parseWaitlist, waitlistJoinedEmail } from "@/lib/waitlist";
import { sendAsAgency } from "@/lib/notify";
import { company } from "@/lib/company";

/**
 * Entrar na lista de espera (landing, 24/10/2026): { email, name, profile, company, sizeBand,
 * source, site }. "site" é o campo escondido contra robôs (gente não preenche). Devolve a posição.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_body", message: "Não foi possível ler o formulário." }, { status: 400 });
  // robô preencheu o campo escondido: responde como se tivesse entrado e não grava nada
  if (typeof body.site === "string" && body.site.trim()) return Response.json({ ok: true, position: 0 });
  const input = parseWaitlist(body);
  if ("error" in input) return Response.json({ error: "invalid", message: input.error }, { status: 400 });

  const db = createAdminClient();
  const ip = hashId(clientIp(req));
  const over = await firstExceeded(db, [
    { key: `lista:ip:${ip}`, max: 8, windowSeconds: 3600, message: "Muitas inscrições daqui. Tente de novo mais tarde." },
    { key: `lista:email:${hashId(input.email)}`, max: 3, windowSeconds: 3600, message: "Você já está na lista: confira o seu e-mail." },
  ]);
  if (over) return Response.json({ error: "rate_limited", message: over.message }, { status: 429 });

  const r = await joinWaitlist(db, input, { ipHash: ip });
  // o e-mail com a posição só na primeira vez (quem volta só atualiza os dados)
  if (!r.already) {
    const mail = waitlistJoinedEmail(r.position, input.profile);
    after(() => sendAsAgency(company.brand, input.email, mail.subject, mail.text.split("\n")).catch(() => false));
  }
  return Response.json({ ok: true, position: r.position, already: r.already });
}
