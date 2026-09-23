"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, type ActionResult } from "@/lib/action-result";
import { markConnectLinkUsed, resolveConnectLink } from "@/lib/whatsapp-connect-link";
import { connectFromSignup, type SignupResult } from "@/lib/whatsapp-signup";

/**
 * O cliente terminou o cadastro da Meta pela página do link de conexão. A permissão é o próprio
 * link (válido e ainda não usado); quem gerou já era da agência dona do chatbot.
 */
export async function completeLinkSignup(token: string, input: SignupResult): Promise<ActionResult> {
  const admin = createAdminClient();
  const link = await resolveConnectLink(admin, token);
  if (!link || link.state !== "open" || link.channel !== "whatsapp") return fail("Este link não vale mais. Peça um novo à agência.");
  if (link.bot.is_demo) return fail("Este assistente ainda não está pronto para o WhatsApp. Fale com a agência.");
  const r = await connectFromSignup(admin, { botId: link.botId, agencyId: link.agencyId, clientName: link.bot.client_name, input, via: "link" });
  if (r.ok) await markConnectLinkUsed(admin, token);
  revalidatePath(`/conectar/${token}`);
  revalidatePath(`/painel/bots/${link.botId}`);
  return r;
}
