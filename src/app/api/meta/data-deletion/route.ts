import { createAdminClient } from "@/lib/supabase/admin";
import { deleteInstagramAccountData, metaAppSecrets, newDeletionCode, parseSignedRequest } from "@/lib/deletions";
import { notifyPlatform } from "@/lib/notify";
import { appUrl } from "@/lib/utils";

export const maxDuration = 60;

/**
 * "Data deletion request callback URL" dos apps da Meta: a pessoa pediu à Meta para apagar os
 * dados que o app recebeu. Responde, como a Meta exige, com o link de acompanhamento e o código
 * de confirmação. No app do Instagram apaga a conexão da conta e as conversas do Instagram
 * daquele chatbot; no do WhatsApp, o user_id é do Facebook e o Boavoz não guarda nada ligado a
 * ele (o pedido fica registrado e é concluído sem dado a apagar).
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const signed = parseSignedRequest(form?.get("signed_request")?.toString(), metaAppSecrets());
  if (!signed) return new Response("invalid signed_request", { status: 400 });

  const db = createAdminClient();
  const code = newDeletionCode();
  const source = signed.app === "instagram" ? "meta_instagram" : "meta_facebook";
  const { error } = await db.from("deletion_requests").insert({ code, source });
  if (error) {
    console.error("meta: pedido de exclusão não registrado", error.message);
    return new Response("retry", { status: 503 });
  }

  try {
    const summary = signed.app === "instagram" ? await deleteInstagramAccountData(db, signed.data.user_id, code) : { accounts: 0, conversations: 0, leads: 0 };
    await db.from("deletion_requests").update({ status: "completed", completed_at: new Date().toISOString(), summary }).eq("code", code);
  } catch (e) {
    // o pedido fica "recebido": a operação conclui à mão (o link de status mostra o andamento)
    console.error("meta: exclusão não concluída", code, e);
    await notifyPlatform("Pedido de exclusão da Meta não concluído", [`Código ${code} (${source}).`, `Erro: ${(e as Error).message}`, "Conclua à mão e marque como completed em deletion_requests."]).catch(() => {});
  }
  return Response.json({ url: appUrl(`/exclusao-de-dados/status?codigo=${code}`), confirmation_code: code });
}
