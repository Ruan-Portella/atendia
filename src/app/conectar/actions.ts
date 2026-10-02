"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { hashToken, markConnectLinkUsed, resolveConnectLink } from "@/lib/whatsapp-connect-link";
import { connectFromSignup, type SignupResult } from "@/lib/whatsapp-signup";
import { connectBlockFor, getCompliance, parseAnswers, recordAcceptance } from "@/lib/acceptance";
import { confirmLinkAcceptance } from "@/lib/acceptance-link";
import { notifyPlatform } from "@/lib/notify";
import { isEmail, text } from "@/lib/validation";

/**
 * O cliente terminou o cadastro da Meta pela página do link de conexão. A permissão é o próprio
 * link (válido e ainda não usado); quem gerou já era da agência dona do chatbot. O aceite feito
 * no link (pendente) vira confirmado aqui, com a conta da Meta.
 */
export async function completeLinkSignup(token: string, input: SignupResult): Promise<ActionResult> {
  const admin = createAdminClient();
  const link = await resolveConnectLink(admin, token);
  if (!link || link.state !== "open" || link.channel !== "whatsapp") return fail("Este link não vale mais. Peça um novo à agência.");
  if (link.bot.is_demo) return fail("Este assistente ainda não está pronto para o WhatsApp. Fale com a agência.");
  const blocked = await connectBlockFor(admin, { clientId: link.clientId, channel: "whatsapp", linkTokenHash: hashToken(token), neutral: true });
  if (blocked) return fail(blocked);
  const r = await connectFromSignup(admin, { botId: link.botId, agencyId: link.agencyId, clientName: link.bot.client_name, input, via: "link" });
  if (r.ok) {
    await markConnectLinkUsed(admin, token);
    await confirmLinkAcceptance(admin, link, token);
  }
  revalidatePath(`/conectar/${token}`);
  revalidatePath(`/painel/bots/${link.botId}`);
  return r;
}

/**
 * Tela única de aceite pelo link, sem login: nome e e-mail de quem aceita, termos do canal,
 * Política de Uso Aceitável e, na primeira vez do negócio, as atividades. O aceite fica pendente,
 * preso ao token do link, até a Meta concluir a conexão.
 */
export async function acceptViaLink(token: string, fd: FormData): Promise<ActionResult> {
  const admin = createAdminClient();
  const link = await resolveConnectLink(admin, token);
  if (!link || link.state !== "open") return fail("Este link não vale mais. Peça um novo a quem te enviou.");
  if (link.bot.is_demo || !link.clientId) return fail("Este assistente ainda não está pronto para conectar. Fale com quem te enviou o link.");
  const name = text(fd.get("name")).slice(0, 120);
  const email = text(fd.get("email")).toLowerCase().slice(0, 160);
  if (name.length < 2) return fail("Informe o seu nome.");
  if (!isEmail(email)) return fail("Informe um e-mail válido.");
  if (fd.get("aceite") !== "on" || fd.get("poderes") !== "on") return fail("Marque as duas caixas para continuar.");
  const answered = await getCompliance(admin, link.clientId);
  const answers = answered ? null : parseAnswers(fd);
  if (!answered && !answers) return fail("Responda todas as atividades (Não, Sim ou Não sei).");
  const h = await headers();
  let status;
  try {
    status = await recordAcceptance(admin, {
      agencyId: link.agencyId,
      clientId: link.clientId,
      botId: link.botId,
      channel: link.channel,
      via: "link",
      name,
      email,
      declaresAuthority: true,
      linkTokenHash: hashToken(token),
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent"),
      answers,
    });
  } catch (e) {
    console.error("aceite pelo link: falhou", e);
    return fail("Não foi possível registrar agora. Tente de novo.");
  }
  if (answers && status !== "ativo") await notifyPlatform(`Negócio em revisão: ${link.bot.client_name}`, [`${link.bot.client_name} (agência ${link.agency.name}) respondeu a pergunta de atividades pelo link e ficou "${status}".`, "Veja em /admin/conformidade."]).catch(() => false);
  revalidatePath(`/conectar/${token}`);
  return ok(status === "aguardando_revisao" && link.channel === "whatsapp" ? "Registrado. O WhatsApp só ativa depois da revisão." : "Registrado. Agora é só conectar.");
}
