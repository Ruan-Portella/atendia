import { NextResponse } from "next/server";
import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
import { hasMfa, verifyUrl } from "@/lib/agency-mfa";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requestMeta } from "@/lib/audit";
import { findPerson, personExportDoc } from "@/lib/titular-dados";

export const maxDuration = 120;

/**
 * Pedido de acesso do titular (LGPD, relatório de segurança de 23/10/2026, M11): o JSON com as
 * fichas, os leads e as conversas de uma pessoa, achada pelo e-mail ou telefone nos chatbots do
 * cliente. POST (o e-mail ou telefone não vai no endereço), só quem exporta e com o segundo fator.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const clientId = String(form?.get("cliente") ?? "");
  const contact = String(form?.get("contato") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/.test(clientId) || !contact) return new Response("pedido inválido", { status: 400 });
  const back = `/painel/clientes/${clientId}?tab=leads`;
  const { agency, role, userId } = await requireAgency();
  if (!can(role, "export")) return new Response("só o dono ou um administrador da agência exporta os dados", { status: 403 });
  // exportação: segundo fator nesta sessão (depois de verificar, a pessoa volta e pede de novo)
  if (!(await hasMfa())) return NextResponse.redirect(new URL(verifyUrl(back), req.url), { status: 303 });
  const session = await createClient();
  const { data: client } = await session.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  if (!client) return new Response("cliente não encontrado", { status: 404 });

  const admin = createAdminClient();
  const match = await findPerson(session, admin, clientId, contact);
  if (!match.ok) return new Response(match.message, { status: 400 });
  const { data: bots } = await admin.from("bots").select("id, name").in("id", match.botIds.length ? match.botIds : ["00000000-0000-0000-0000-000000000000"]);
  const doc = await personExportDoc(admin, { match, bots: (bots ?? []) as Array<{ id: string; name: string }>, who: contact });
  await audit(admin, {
    agencyId: agency.id,
    actorType: "user",
    actorId: userId,
    action: "titular.exportar",
    targetType: "client",
    targetId: clientId,
    after: { por: match.byEmail ? "email" : "telefone", fichas: match.contactIds.length, leads: match.leads.length, conversas: match.conversationIds.length },
    ...(await requestMeta()),
  });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(JSON.stringify(doc, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dados-da-pessoa-${date}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
