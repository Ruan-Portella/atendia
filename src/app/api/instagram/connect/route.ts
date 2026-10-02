import { redirect } from "next/navigation";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeUrl, instagramAllowed, instagramConfigured, signState } from "@/lib/instagram";
import { hashToken, resolveConnectLink } from "@/lib/whatsapp-connect-link";
import { connectBlockFor } from "@/lib/acceptance";

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
    // tela única de aceite: sem o aceite (pendente deste link) ou com o negócio bloqueado, não abre o login
    const blocked = await connectBlockFor(createAdminClient(), { clientId: link.clientId, channel: "instagram", linkTokenHash: hashToken(linkToken), neutral: true });
    if (blocked) redirect(`/conectar/${encodeURIComponent(linkToken)}?ig_erro=${encodeURIComponent(blocked)}`);
    redirect(authorizeUrl(signState({ botId: link.botId, via: "link", token: linkToken })));
  }

  const botId = p.get("bot") ?? "";
  const { email } = await requireAgency();
  if (!instagramAllowed(email)) redirect(`/painel/bots/${botId}`);
  const supabase = await createClient();
  const { data: bot } = await supabase.from("bots").select("id, is_demo, client_id").eq("id", botId).maybeSingle();
  if (!bot || bot.is_demo) redirect("/painel/clientes");
  const blocked = await connectBlockFor(createAdminClient(), { clientId: bot.client_id as string | null, channel: "instagram" });
  if (blocked) redirect(`/painel/bots/${bot.id}?tab=instagram&ig_erro=${encodeURIComponent(blocked)}`);
  redirect(authorizeUrl(signState({ botId: bot.id, via: "painel" })));
}
