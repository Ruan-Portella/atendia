import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { attachmentExpired, attachmentRow, readAttachment, streamBytes } from "@/lib/attachments";
import { validFileLink } from "@/lib/file-links";
import { memberForAction, memberHasMfa } from "@/lib/member";
import { adminSession } from "@/lib/platform-admin";
import { activeGrant } from "@/lib/support-access";
import { audit, requestMeta } from "@/lib/audit";
import { fileHeaders } from "@/lib/file-headers";

/**
 * Rota única dos arquivos recebidos (leva S): abre o arquivo cifrado para quem pode ver a conversa:
 * a agência dona (com o segundo fator se o chatbot estiver em modo dados sensíveis), as pessoas do
 * cliente e o suporte do BoaVoz com a liberação da agência (a leitura vai para a auditoria dela).
 * Sem sessão, com o link assinado de 1 hora (?exp=&sig=: API, widget e webhooks). Depois do prazo
 * (modo dados sensíveis) ou da exclusão do objeto, 410. Imagem, áudio e vídeo abrem na página; o
 * resto só baixa, sem rodar nada. Resposta em blocos (streaming).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("não encontrado", { status: 404 });
  const db = createAdminClient();
  const row = await attachmentRow(db, id);
  if (!row) return new Response("não encontrado", { status: 404 });

  const sp = new URL(req.url).searchParams;
  let viewer: "agency" | "member" | "support" | "link" | null = validFileLink(id, sp.get("exp"), sp.get("sig")) ? "link" : null;
  const { data } = viewer ? { data: null } : await (await createClient()).auth.getClaims();
  const claims = data?.claims;
  if (!viewer && claims?.sub) {
    // equipe da agência: a RLS da sessão diz se o chatbot está no escopo da pessoa
    // (modo dados sensíveis: segundo fator nesta sessão)
    const { data: bot } = await (await createClient()).from("bots").select("id, agency_id, sensitive_mode").eq("id", row.bot_id).maybeSingle();
    if (bot && bot.agency_id === row.agency_id) {
      if (bot.sensitive_mode && claims.aal !== "aal2") return new Response("faça a verificação em duas etapas no painel para ver este arquivo", { status: 403 });
      viewer = "agency";
    }
  }
  if (!viewer && row.client_id) {
    const member = await memberForAction(row.client_id);
    if (member?.botIds.includes(row.bot_id)) {
      // portal: modo dados sensíveis pede o segundo fator nesta sessão, como no painel
      const { data: bot } = await db.from("bots").select("sensitive_mode").eq("id", row.bot_id).maybeSingle();
      if (bot?.sensitive_mode && !(await memberHasMfa())) return new Response("faça a verificação em duas etapas na área do cliente para ver este arquivo", { status: 403 });
      viewer = "member";
    }
  }
  if (!viewer) {
    const admin = await adminSession();
    const grant = admin?.mfa ? await activeGrant(db, row.agency_id) : null;
    if (admin && grant) {
      viewer = "support";
      await audit(db, { agencyId: row.agency_id, actorType: "support", actorId: admin.email, action: "suporte.ler_arquivo", targetType: "conversation", targetId: row.conversation_id, after: { liberacao: grant.id, arquivo: row.id }, ...(await requestMeta()) });
    }
  }
  if (!viewer) return new Response("não encontrado", { status: 404 });

  if (attachmentExpired(row)) return new Response("arquivo indisponível (prazo de guarda vencido)", { status: 410 });
  const file = await readAttachment(db, row);
  if (!file.data) return new Response("arquivo indisponível", { status: 410 });
  return new Response(streamBytes(file.data), { headers: fileHeaders({ id: file.id, mime: file.mime, filename: file.filename, size: file.data.byteLength }, { crossOrigin: viewer === "link" }) });
}
