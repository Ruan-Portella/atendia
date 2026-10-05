import { memberCan, memberForAction } from "@/lib/member";
import { requireAgency } from "@/lib/agency";
import { can } from "@/lib/team";
import { mfaRedirect } from "@/lib/agency-mfa";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requestMeta } from "@/lib/audit";
import { EXPORT_KINDS, exportResponse, exportRows, type ExportFormat, type ExportKind } from "@/lib/export";

// conversas longas: a exportação vai aos poucos, até 5 minutos
export const maxDuration = 300;

/**
 * Exportação dos dados do negócio (leva S): ?cliente=&dados=conversas|contatos|leads&formato=csv|json.
 * Pode baixar a pessoa do cliente (área do cliente) ou a agência dona do cliente.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const clientId = p.get("cliente") ?? "";
  const kind = p.get("dados") as ExportKind;
  const format = (p.get("formato") === "json" ? "json" : "csv") as ExportFormat;
  if (!/^[0-9a-f-]{36}$/.test(clientId) || !EXPORT_KINDS.includes(kind)) return new Response("pedido inválido", { status: 400 });

  // pessoa do cliente (área do cliente) ou, senão, a agência logada dona do cliente
  const member = await memberForAction(clientId);
  // no portal, exportar é do gestor (o atendente vê só as conversas)
  if (member && !memberCan(member.member, "manager")) return new Response("só o gestor exporta os dados", { status: 403 });
  let actor: { agencyId: string; type: "member" | "user"; id: string };
  let clientName: string;
  if (member) {
    actor = { agencyId: member.member.agencyId, type: "member", id: member.email };
    clientName = member.member.clientName;
  } else {
    const { agency, role, userId } = await requireAgency();
    if (!can(role, "export")) return new Response("só o dono ou um administrador da agência exporta os dados", { status: 403 });
    // exportação pela agência: segundo fator nesta sessão (cadastro na hora, na primeira vez)
    const verify = await mfaRedirect(req);
    if (verify) return verify;
    const { data: client } = await (await createClient()).from("clients").select("id, name").eq("id", clientId).maybeSingle();
    if (!client) return new Response("cliente não encontrado", { status: 404 });
    actor = { agencyId: agency.id, type: "user", id: userId };
    clientName = client.name as string;
  }
  const db = createAdminClient();
  const { data: bots } = await db.from("bots").select("id, name").eq("client_id", clientId).eq("is_demo", false);
  const meta = await requestMeta();
  const slug = clientName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "cliente";
  const date = new Date().toISOString().slice(0, 10);
  return exportResponse(exportRows(db, (bots ?? []) as Array<{ id: string; name: string }>, kind), kind, format, `${slug}-${kind}-${date}`, (count) => {
    void audit(db, { agencyId: actor.agencyId, actorType: actor.type, actorId: actor.id, action: "dados.exportar", targetType: "client", targetId: clientId, after: { dados: kind, formato: format, linhas: count }, ...meta });
  });
}
