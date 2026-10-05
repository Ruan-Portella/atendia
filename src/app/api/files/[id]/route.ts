import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { attachmentRow, readAttachment } from "@/lib/attachments";
import { memberForAction } from "@/lib/member";
import { adminSession } from "@/lib/platform-admin";
import { activeGrant } from "@/lib/support-access";
import { audit, requestMeta } from "@/lib/audit";
import { fileHeaders } from "@/lib/file-headers";

/**
 * Rota única dos arquivos recebidos (leva S): abre o arquivo cifrado para quem pode ver a conversa:
 * a agência dona (com o segundo fator se o chatbot estiver em modo dados sensíveis), as pessoas do
 * cliente e o suporte do BoaVoz com a liberação da agência (a leitura vai para a auditoria dela).
 * Imagem, áudio e vídeo abrem na página; o resto só baixa, sem rodar nada.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("não encontrado", { status: 404 });
  const db = createAdminClient();
  const row = await attachmentRow(db, id);
  if (!row) return new Response("não encontrado", { status: 404 });

  const { data } = await (await createClient()).auth.getClaims();
  const claims = data?.claims;
  let viewer: "agency" | "member" | "support" | null = null;
  if (claims?.sub) {
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
    if (member?.botIds.includes(row.bot_id)) viewer = "member";
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

  const file = await readAttachment(db, row);
  if (!file.data) return new Response("arquivo indisponível", { status: 410 });
  return new Response(new Uint8Array(file.data), { headers: fileHeaders({ id: file.id, mime: file.mime, filename: file.filename, size: file.data.byteLength }) });
}
