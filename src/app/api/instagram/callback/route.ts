import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { readState } from "@/lib/instagram";
import { connectInstagram } from "@/lib/instagram-channel";
import { markConnectLinkUsed, resolveConnectLink } from "@/lib/whatsapp-connect-link";

/**
 * Volta do login do Instagram (a URL cadastrada no app). Só aceita um `state` assinado por nós,
 * dentro da validade: é ele que diz qual chatbot e de onde veio (painel ou link do cliente).
 * Conecta a conta e devolve a pessoa para onde ela estava, com o resultado na URL.
 */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const origin = readState(p.get("state"));
  if (!origin) return new Response("Este retorno do Instagram não é válido ou expirou. Comece a conexão de novo.", { status: 400 });

  const back = (result: { ok: true } | { ok: false; message: string }): never => {
    const q = result.ok ? "ig=ok" : `ig_erro=${encodeURIComponent(result.message)}`;
    redirect(origin.via === "link" ? `/conectar/${encodeURIComponent(origin.token)}?${q}` : `/painel/bots/${origin.botId}?tab=instagram&${q}`);
  };

  // a pessoa recusou ou fechou a janela do Instagram
  if (p.get("error") || !p.get("code")) back({ ok: false, message: "A conexão foi cancelada no Instagram." });

  const db = createAdminClient();
  if (origin.via === "link") {
    const link = await resolveConnectLink(db, origin.token);
    if (!link || link.state !== "open" || link.channel !== "instagram" || link.botId !== origin.botId) back({ ok: false, message: "Este link não vale mais. Peça um novo à agência." });
  }

  const r = await connectInstagram(db, { botId: origin.botId, code: p.get("code")!, via: origin.via });
  if (r.ok && origin.via === "link") await markConnectLinkUsed(db, origin.token);
  revalidatePath(`/painel/bots/${origin.botId}`);
  back(r.ok ? { ok: true } : r);
}
