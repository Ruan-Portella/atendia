import { redirect } from "next/navigation";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsappAllowed } from "@/lib/whatsapp";
import { authorizeUrl, instagramConfigured, signState } from "@/lib/instagram";
import { resolveConnectLink } from "@/lib/whatsapp-connect-link";

/**
 * Começo do login do Instagram. Dois jeitos de chegar:
 *   ?bot=ID    a agência logada, dona do chatbot (e no teste fechado)
 *   ?link=TOK  o cliente, pelo link de conexão do Instagram ainda válido
 * Nos dois, o `state` assinado leva o chatbot até o retorno do login (/api/instagram/callback).
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  if (!instagramConfigured()) return new Response("Instagram não configurado no servidor.", { status: 503 });

  const linkToken = p.get("link");
  if (linkToken) {
    const link = await resolveConnectLink(createAdminClient(), linkToken);
    if (!link || link.state !== "open" || link.channel !== "instagram" || link.bot.is_demo) redirect(`/conectar/${encodeURIComponent(linkToken)}`);
    redirect(authorizeUrl(signState({ botId: link.botId, via: "link", token: linkToken })));
  }

  const botId = p.get("bot") ?? "";
  const { email } = await requireAgency();
  if (!whatsappAllowed(email)) redirect(`/painel/bots/${botId}`);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, is_demo").eq("id", botId).maybeSingle();
  if (!bot || bot.is_demo) redirect("/painel/clientes");
  redirect(authorizeUrl(signState({ botId: bot.id, via: "painel" })));
}
