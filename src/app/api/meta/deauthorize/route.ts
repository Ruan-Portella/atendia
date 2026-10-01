import { createAdminClient } from "@/lib/supabase/admin";
import { metaAppSecrets, parseSignedRequest } from "@/lib/deletions";
import { markInstagramDisconnected } from "@/lib/instagram-channel";

/**
 * "Deauthorize callback URL" dos apps da Meta: a pessoa removeu o app da conta dela. No app do
 * Instagram, o user_id é a conta profissional conectada: desconecta, apaga o token e avisa a
 * agência. No app do WhatsApp, o user_id é do Facebook, que o Boavoz não guarda (a perda de
 * acesso ao número chega pelo webhook account_update): só confirma.
 */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const signed = parseSignedRequest(form?.get("signed_request")?.toString(), metaAppSecrets());
  if (!signed) return new Response("invalid signed_request", { status: 400 });
  if (signed.app === "instagram") {
    const n = await markInstagramDisconnected(createAdminClient(), { column: "ig_user_id", value: signed.data.user_id }, "o acesso do app foi removido nas configurações do Instagram");
    console.log("meta: desautorização do Instagram", { contas: n });
  } else {
    console.log("meta: desautorização no app do Facebook/WhatsApp (sem dado vinculado ao usuário)");
  }
  return new Response("ok");
}
