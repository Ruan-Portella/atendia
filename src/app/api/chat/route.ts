import { z } from "zod";
import { ATENDIMENTO_TEST_OFF, DEMO_ENDED_PANEL, TEST_ANSWERS_DONE, demoEndedText, takeTestAnswer } from "@/lib/free-account";
import { FREE_LINKED_TEST } from "@/lib/person-signals";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { withContactId } from "@/lib/ai-contact";
import { AI_BLOCK_LABEL, CORS_HEADERS, SYSTEM_AUTHOR, appendActionComponent, appendActionFiles, appendSiteOffer, conversationHistory, lastUserText, openConversation, requestHandoff, runChat, withoutToolParts, type BotRow } from "@/lib/chat";
import { resolveConfirmClick } from "@/lib/action-confirm";
import { devButtonId, type Interactive } from "@/lib/message-events";
import { callerFor, shapeActionResult } from "@/lib/action-tools";
import type { MessageComponent } from "@/lib/components";
import { widgetFiles, widgetFilesNotice } from "@/lib/action-files";
import { linkAttachments } from "@/lib/attachments";
import type { WidgetFile } from "@/lib/file-links";
import { handleSiteOptIn } from "@/lib/site-optin";
import { handleErasureRequest } from "@/lib/data-subject";
import { SUSPENDED_NOTICE, resolveMode, withoutAi } from "@/lib/conversation-mode";
import { botHasAi } from "@/lib/plans";
import { logWidgetAccess } from "@/lib/access-log";
import { clientIp, firstExceeded, hashId, tooMany } from "@/lib/rate-limit";
import { isResumable } from "@/lib/presence";
import { openAtendimento } from "@/lib/atendimentos";
import { saveMessage } from "@/lib/messages";
import { chatIdentityOf, conversationAccess, identityColumns, upgradeConversation, widgetWho } from "@/lib/widget-identity";
import { maskCardNumbers } from "@/lib/routine-run";
import { applyConfirmedAction, cancelRoutineAction, routinePreTurn } from "@/lib/routine-engine";
import { conversationChatIdentity, identityPort, identityPreTurn, loadConversationIdentity } from "@/lib/routine-identity";

const MAX_MESSAGE_CHARS = 2000;

export const maxDuration = 60;

const bodySchema = z.object({
  key: z.string().min(8),
  conversationId: z.string().uuid().nullable().optional(),
  visitorId: z.string().max(80).nullable().optional(),
  channel: z.enum(["widget", "demo", "painel"]).default("widget"),
  /** Só o texto novo; o histórico vem do banco. */
  text: z.string().optional(),
  /** Formato antigo (aba aberta antes da atualização): só a última fala do visitante é usada. */
  messages: z.array(z.any()).max(200).optional(),
  /** Botão tocado (Confirmar, Cancelar, "Tentar de novo"): o clique é resolvido pelo id, nunca pelo título. */
  buttonId: z.string().max(120).nullable().optional(),
});

const FALLBACK_MESSAGE = "No momento não consigo responder por aqui. Deixe seu contato que a equipe retorna em breve.";
const contactFallback = (error: string, status: number) => Response.json({ error, fallback: "contact", message: FALLBACK_MESSAGE }, { status, headers: CORS_HEADERS });

/** Resposta fixa sem IA (texto, e os botões ou o sinal de atendente quando houver). */
function fixedStream(id: string, text: string, headers: Record<string, string>, o: { component?: MessageComponent | null; handoff?: boolean; files?: WidgetFile[] } = {}) {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "start" });
        if (o.handoff) writer.write({ type: "data-handoff", data: true });
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: text });
        writer.write({ type: "text-end", id });
        if (o.component) writer.write({ type: "data-components", data: o.component });
        if (o.files?.length) writer.write({ type: "data-files", data: o.files });
        writer.write({ type: "finish" });
      },
    }),
    headers,
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Chat público do widget e da demo. Autenticação = chave pública do bot.
 * Limites por IP (mensagens e conversas novas) protegem a cota mensal da agência de quem
 * tentar esgotá-la de propósito a partir do site do cliente.
 */
export async function POST(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_body" }, { status: 400, headers: CORS_HEADERS });
  const { key, conversationId, visitorId, messages } = parsed.data;
  // número de cartão sai antes de gravar e antes da IA
  const text = maskCardNumbers((parsed.data.text ?? lastUserText((messages ?? []) as UIMessage[])).trim()).text;
  if (!text) return Response.json({ error: "invalid_body" }, { status: 400, headers: CORS_HEADERS });
  if (text.length > MAX_MESSAGE_CHARS) {
    return Response.json({ error: "message_too_long", message: `Mensagem muito longa. Resuma em até ${MAX_MESSAGE_CHARS} caracteres.` }, { status: 413, headers: CORS_HEADERS });
  }

  const db = createAdminClient();
  const { data: bot } = await db.from("bots").select("*").eq("public_key", key).maybeSingle<BotRow>();
  if (!bot) return Response.json({ error: "bot_not_found" }, { status: 404, headers: CORS_HEADERS });
  // "painel" (teste ao vivo, funciona com o bot em rascunho) só com sessão de quem enxerga o bot
  let channel = parsed.data.channel;
  if (channel === "painel") {
    const { data: own } = await (await createClient()).from("bots").select("id").eq("id", bot.id).maybeSingle();
    if (!own) channel = "widget";
  }
  // "demo" só no chatbot de demo: num chatbot de verdade, o canal pulava a cota do mês e as
  // respostas de teste (relatório de segurança de 23/10/2026, M9)
  if (channel === "demo" && !bot.is_demo) channel = "widget";
  // o bot modelo (D') só responde no teste do painel: quem atende são os derivados
  if (bot.is_template && channel !== "painel") return Response.json({ error: "bot_not_found" }, { status: 404, headers: CORS_HEADERS });
  if (bot.status !== "live" && !bot.is_demo && channel !== "painel") {
    return Response.json({ error: "bot_offline", message: "Este assistente ainda não foi publicado." }, { status: 403, headers: CORS_HEADERS });
  }

  // identidade (P2): token no Authorization, conferido em toda mensagem; inválido = o widget pede outro
  const who = await widgetWho(db, bot, req);
  if (who.kind === "invalid") return Response.json({ error: "invalid_token", message: "Sua sessão expirou. Envie de novo." }, { status: 401, headers: CORS_HEADERS });

  // Só continua uma conversa deste bot e da mesma pessoa (navegador ou identidade); qualquer outro id vira conversa nova.
  let convId = conversationId ?? null;
  let handoff: "requested" | "agent" | null = null;
  let conv: { id: string; takeover_at: string | null; handled_at: string | null; ai_paused_until: string | null } | null = null;
  if (convId) {
    const { data } = await db.from("conversations").select("id, visitor_id, identity_hash, context_hash, handoff_requested_at, takeover_at, handled_at, ai_paused_until, last_message_at").eq("id", convId).eq("bot_id", bot.id).maybeSingle();
    // outra conversa, outra pessoa ou outro contexto, ou parada há horas: começa uma nova
    const access = data ? conversationAccess(data, who, visitorId ?? null) : "denied";
    if (!data || access === "denied" || !isResumable(data.last_message_at)) convId = null;
    else {
      // conversa anônima deste navegador com o primeiro token: passa a ser da pessoa (uma vez)
      if (access === "upgrade") await upgradeConversation(db, data.id, who, bot.id);
      conv = data;
      if (!data.handled_at) handoff = data.takeover_at ? "agent" : data.handoff_requested_at ? "requested" : null;
    }
  }

  const ip = hashId(clientIp(req));
  const exceeded = await firstExceeded(db, [
    { key: `chat:${bot.id}:ip:${ip}:m`, max: 15, windowSeconds: 60, message: "Você está mandando mensagens rápido demais. Espere um minutinho." },
    { key: `chat:${bot.id}:ip:${ip}:d`, max: 300, windowSeconds: 86400, message: "Limite de mensagens por hoje atingido. Tente de novo amanhã." },
    ...(convId
      ? []
      : [
          { key: `chat:${bot.id}:ip:${ip}:conv`, max: 10, windowSeconds: 3600, message: "Muitas conversas novas em pouco tempo. Tente de novo mais tarde." },
          // 30 conversas novas por dia por IP e bot: quem tenta esgotar a cota da agência pelo site
          { key: `chat:${bot.id}:ip:${ip}:convd`, max: 30, windowSeconds: 86400, message: "Muitas conversas novas hoje. Tente de novo amanhã." },
        ]),
  ]);
  if (exceeded) return tooMany(exceeded, CORS_HEADERS);

  // regra única de estado (conversation-mode): suspensão, equipe na conversa, pausa e modo só humano;
  // no site, o chatbot sem IA (Atendimento ou sem tamanho) é só o formulário de contato
  const resolved = await resolveMode(db, { bot, channel: "widget", conversation: conv });
  const mode = channel === "widget" && !bot.is_demo && !botHasAi(bot) ? withoutAi(resolved) : resolved;
  if (mode.step === 2) return Response.json({ error: "channel_suspended", message: SUSPENDED_NOTICE }, { status: 403, headers: CORS_HEADERS });

  // pedido do titular (LGPD): "apaga meus dados" e o SIM/NÃO da confirmação, com texto fixo e sem a
  // IA, em qualquer estado da conversa (o teste ao vivo do painel não entra)
  if (channel === "widget") {
    let erasureConv = convId;
    const replies: string[] = [];
    const erasure = await handleErasureRequest(
      {
        db,
        bot,
        channel: "widget",
        contactId: who.kind === "token" ? (who.contactId ?? null) : null,
        currentConversation: convId,
        conversation: async () => (erasureConv ??= await openConversation(db, bot, { channel: "widget", visitorId: visitorId ?? null, identity: await identityColumns(who, bot.id) }).catch(() => null)),
        store: async (_i, id) => {
          await saveMessage(db, { conversation_id: id, role: "user", content: text }, { touch: "visitante" });
        },
        reply: async (id, t) => {
          replies.push(t);
          if (id) await saveMessage(db, { conversation_id: id, role: "assistant", content: t, author: SYSTEM_AUTHOR });
        },
      },
      [{ text, buttonId: null }],
    );
    if (erasure.size) {
      const reply = replies.join("\n\n");
      if (erasureConv) {
        const id = erasureConv;
        after(() => logWidgetAccess(db, { botId: bot.id, conversationId: id, ip: clientIp(req), isNew: !convId }));
      }
      return createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) => {
            writer.write({ type: "start" });
            writer.write({ type: "text-start", id: "titular" });
            writer.write({ type: "text-delta", id: "titular", delta: reply });
            writer.write({ type: "text-end", id: "titular" });
            writer.write({ type: "finish" });
          },
        }),
        headers: { ...CORS_HEADERS, ...(erasureConv ? { "X-Conversation-Id": erasureConv } : {}), "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" },
      });
    }
  }

  // novidades no site (leva B3): "Sim, quero" ou "Não, obrigado" logo depois da oferta, com texto
  // fixo e sem a IA, em qualquer estado da conversa (o teste ao vivo do painel não grava aceite)
  if (channel === "widget" && convId && bot.marketing_optin_offer) {
    const reply = await handleSiteOptIn(db, bot, convId, text).catch((e) => {
      console.error("site: resposta às novidades", (e as Error).message);
      return null;
    });
    if (reply) {
      const id = convId;
      await saveMessage(db, { conversation_id: id, role: "user", content: text }, { touch: "visitante" });
      await saveMessage(db, { conversation_id: id, role: "assistant", content: reply, author: SYSTEM_AUTHOR });
      after(() => logWidgetAccess(db, { botId: bot.id, conversationId: id, ip: clientIp(req), isNew: false }));
      return createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) => {
            writer.write({ type: "start" });
            writer.write({ type: "text-start", id: "novidades" });
            writer.write({ type: "text-delta", id: "novidades", delta: reply });
            writer.write({ type: "text-end", id: "novidades" });
            writer.write({ type: "finish" });
          },
        }),
        headers: { ...CORS_HEADERS, "X-Conversation-Id": id, "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" },
      });
    }
  }

  // Uma pessoa da agência assumiu: o assistente fica quieto; a mensagem vai para o painel
  // e a resposta chega ao widget por /api/chat/updates.
  if (convId && mode.step === 3) {
    const activeConv = convId;
    if (channel !== "painel") after(() => logWidgetAccess(db, { botId: bot.id, conversationId: activeConv, ip: clientIp(req), isNew: false }));
    await saveMessage(db, { conversation_id: convId, role: "user", content: text }, { touch: "visitante" });
    return createUIMessageStreamResponse({
      stream: createUIMessageStream({ execute: () => {} }),
      headers: { ...CORS_HEADERS, "X-Conversation-Id": convId, "X-Handoff": "agent", "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" },
    });
  }

  // bot pausado pelo dono, IA pausada pelo backoffice, pagamento em aberto, chatbot sem IA, teste ou
  // cota: o widget mostra o formulário de contato (o lead não se perde); o teste ao vivo diz o motivo
  if (mode.handoff) {
    const reason = mode.blockReason ?? "paused";
    if (channel === "painel") return fixedStream("teste", AI_BLOCK_LABEL[reason], CORS_HEADERS);
    return contactFallback(reason === "paused" ? "ai_paused" : reason, reason === "paused" || reason === "bot_paused" ? 503 : 402);
  }

  // Confirmar, Cancelar ou "Tentar de novo" de uma ação "executa" (C pública, parte 5a): o clique é
  // resolvido pelo id do botão (ou pelo atalho "sim" logo depois do resumo), sem IA
  let confirmed: Parameters<typeof runChat>[0]["confirmed"];
  // roteiro (B2'): o Confirmar de uma ação do passo anda o roteiro pelo resultado; o Cancelar encerra
  let routineNote: string | null = null;
  // o clique vai no webhook message.received (interactive), como no WhatsApp e no Instagram
  const interactive: Interactive | null = parsed.data.buttonId ? { type: "button_reply", id: devButtonId(parsed.data.buttonId), title: text } : null;
  if (convId) {
    const id = convId;
    // o token do site, senão a identidade que o roteiro deu a esta conversa (parte 2c)
    const identity = chatIdentityOf(who) ?? (await conversationChatIdentity(db, id));
    const click = await resolveConfirmClick(db, {
      bot,
      conversationId: id,
      buttonId: parsed.data.buttonId ?? null,
      text,
      alone: true,
      key: `site:${crypto.randomUUID()}`,
      caller: () => callerFor(db, { bot, conversationId: id, channel, waPhone: null, age: null, identity }),
    });
    if (click.kind !== "none") {
      const headers = { ...CORS_HEADERS, "X-Conversation-Id": id, "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" };
      if (channel !== "painel") after(() => logWidgetAccess(db, { botId: bot.id, conversationId: id, ip: clientIp(req), isNew: false }));
      await saveMessage(db, { conversation_id: id, role: "user", content: text }, { touch: "visitante", interactive });
      if (click.kind === "fixed") {
        if (click.canceledActionId) await cancelRoutineAction(db, id, click.canceledActionId);
        await saveMessage(db, { conversation_id: id, role: "assistant", content: click.text, author: SYSTEM_AUTHOR, components: click.component ?? null });
        return fixedStream("confirmar", click.text, headers, { component: click.component });
      }
      if (click.kind === "handoff") {
        const notice = await requestHandoff(db, bot, id, "Pedido sem confirmação: o contato pediu para falar com alguém");
        await saveMessage(db, { conversation_id: id, role: "assistant", content: notice, author: SYSTEM_AUTHOR });
        return fixedStream("confirmar", notice, { ...headers, "X-Handoff": "requested" }, { handoff: true });
      }
      // roteiro: a equipe entra depois desta ação? (o aviso vai junto da resposta)
      const routineMove = await applyConfirmedAction(db, { conversationId: id, action: click.action.name, status: click.call.status, outcome: click.call.outcome ?? null, declared: click.action.outcomes, waPhone: null });
      const routineHandoffNotice = routineMove.handoff ? await requestHandoff(db, bot, id, routineMove.handoff) : null;
      routineNote = routineHandoffNotice ? `${routineMove.note ?? ""} Diga à pessoa, junto do resultado: ${routineHandoffNotice}`.trim() : routineMove.note;
      // no site não há trava do BoaVoz: o data e o reply saem como vieram
      const shaped = await shapeActionResult(db, { bot, conversationId: id, gateChannel: "widget", waPhone: null, age: null, regulatedAt: null }, click.call, { execute: true });
      if (shaped.reply) {
        // reply exato da ação, com os botões e os anexos que ela devolveu (e o aviso da equipe, se o roteiro mandou)
        const notice = widgetFilesNotice(shaped.files);
        const content = [shaped.reply, notice, routineHandoffNotice].filter(Boolean).join("\n\n");
        const replyId = await saveMessage(db, { conversation_id: id, role: "assistant", content, components: shaped.component });
        if (replyId) await linkAttachments(db, shaped.files.flatMap((f) => (f.id && f.status !== "falha" ? [f.id] : [])), replyId);
        return fixedStream("confirmar", content, routineHandoffNotice ? { ...headers, "X-Handoff": "requested" } : headers, { component: shaped.component, files: widgetFiles(shaped.files), handoff: Boolean(routineHandoffNotice) });
      }
      confirmed = { action: click.action.name, params: click.params, output: click.call.status === "ok" ? { ...shaped.output, confirmada: true } : shaped.output, internal: shaped.internal, component: shaped.component, files: shaped.files, via: click.via };
    }
  }

  // Atendimento não tem IA, nem no teste ao vivo
  if (channel === "painel" && bot.size === "atendimento" && !botHasAi(bot)) return fixedStream("teste", ATENDIMENTO_TEST_OFF, CORS_HEADERS);
  // respostas de teste: cada demo vale 14 dias e responde até 50 vezes (as da vitrine do site
  // também); na conta grátis, o teste ao vivo e as demos também param nas 50 da conta
  if (channel === "painel" || bot.is_demo) {
    const test = await takeTestAnswer(db, bot.id);
    if (test !== "ok") {
      if (channel === "painel") return fixedStream("teste", test === "conta" ? TEST_ANSWERS_DONE : test === "ligada" ? FREE_LINKED_TEST : DEMO_ENDED_PANEL, CORS_HEADERS);
      const { data: owner } = await db.from("agencies").select("name, slug").eq("id", bot.agency_id).maybeSingle();
      return fixedStream("demo", demoEndedText((owner?.name as string | null) ?? null, owner?.slug === "boavoz"), CORS_HEADERS);
    }
  }

  // cota do mês: o atendimento deste visitante (24 horas) abre antes de chamar a IA; o teste ao
  // vivo do painel e as demos não contam. Sem vaga: formulário de contato
  const slot = channel === "widget" && !bot.is_demo ? await openAtendimento(db, bot, { channel: "widget", contactKey: (who.kind === "token" ? who.identityHash : null) ?? visitorId ?? convId ?? crypto.randomUUID(), conversationId: convId }) : null;
  if (slot?.blocked) return contactFallback(slot.blocked, 402);

  try {
    const chatChannel = bot.is_demo ? "demo" : channel;
    // a conversa começa nesta mensagem (registro de acesso e ligação com o atendimento)
    const newConversation = !convId;
    const tokenIdentity = chatIdentityOf(who);
    // identificação pelo roteiro (B2', parte 2c): o toque na escolha da conta, antes do roteiro (no
    // site não há número para lembrar nem a pergunta "Estou falando com...?")
    let identityNote: string | null = null;
    let identityConsumed = false;
    if (convId && !confirmed) {
      const idTurn = await identityPreTurn(db, { bot, channel: chatChannel, conversationId: convId, contactId: null, buttonId: parsed.data.buttonId ?? null, text, texts: [text], consume: true, external: Boolean(tokenIdentity?.externalId) });
      if (idTurn.kind === "fixed") {
        const id = convId;
        if (channel !== "painel") after(() => logWidgetAccess(db, { botId: bot.id, conversationId: id, ip: clientIp(req), isNew: false }));
        await saveMessage(db, { conversation_id: id, role: "user", content: text }, { touch: "visitante", interactive });
        await saveMessage(db, { conversation_id: id, role: "assistant", content: idTurn.text, author: SYSTEM_AUTHOR, components: idTurn.component });
        return fixedStream("identificacao", idTurn.text, { ...CORS_HEADERS, "X-Conversation-Id": id, "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" }, { component: idTurn.component });
      }
      if (idTurn.kind === "none") {
        identityNote = idTurn.note;
        identityConsumed = idTurn.consumed;
      }
    }
    // a conversa abre aqui, e não no runChat: a identidade que a ação do roteiro devolver já é
    // gravada nela nesta vez
    convId ??= await openConversation(db, bot, { channel: chatChannel, visitorId: visitorId ?? null, identity: await identityColumns(who, bot.id) });
    const port = identityPort(db, { conversationId: convId, botId: bot.id, contactId: null, channel: chatChannel, initial: await loadConversationIdentity(db, convId), external: tokenIdentity });
    // roteiros (B2'): botão do passo, escolha digitada, dado conferido e palavra-chave, antes da IA
    const routineTurn = await routinePreTurn(db, {
      bot,
      conversationId: convId,
      texts: [text],
      buttonId: parsed.data.buttonId ?? null,
      waPhone: null,
      consume: !confirmed && !identityConsumed,
      note: routineNote,
      identity: { identified: port.identified(), choosing: port.choosing() },
    });
    if (routineTurn.fixed && convId) {
      const id = convId;
      const headers = { ...CORS_HEADERS, "X-Conversation-Id": id, "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" };
      if (channel !== "painel") after(() => logWidgetAccess(db, { botId: bot.id, conversationId: id, ip: clientIp(req), isNew: newConversation }));
      await saveMessage(db, { conversation_id: id, role: "user", content: text }, { touch: "visitante", interactive });
      const handoffNotice = routineTurn.fixed.kind === "handoff" ? await requestHandoff(db, bot, id, routineTurn.fixed.reason) : null;
      const reply = handoffNotice ?? (routineTurn.fixed.kind === "cancelled" ? routineTurn.fixed.text : "");
      await saveMessage(db, { conversation_id: id, role: "assistant", content: reply, author: SYSTEM_AUTHOR });
      return fixedStream("roteiro", reply, handoffNotice ? { ...headers, "X-Handoff": "requested" } : headers, { handoff: Boolean(handoffNotice) });
    }
    const history = convId ? await conversationHistory(db, convId, 11, MAX_MESSAGE_CHARS) : [];
    // o identificador do visitante nas chamadas de IA (ai-contact.ts): um abuso bloqueia só ele
    const { result, conversationId: activeId, siteOffer, components, files, saved, links } = await withContactId(bot.id, (who.kind === "token" ? who.identityHash : null) ?? visitorId ?? convId, async () => runChat({
      db,
      bot,
      // depois do Confirmar, o clique já está gravado (e já vem no histórico)
      messages: confirmed ? history : [...history, { id: "novo", role: "user", parts: [{ type: "text", text }] }],
      storeQuestion: !confirmed,
      confirmed,
      interactive,
      routine: routineTurn,
      turnTexts: [text],
      conversationId: convId,
      visitorId: visitorId ?? null,
      channel: chatChannel,
      identity: tokenIdentity ?? port.current(),
      identityColumns: await identityColumns(who, bot.id),
      // pessoa identificada pelo roteiro com 2 contas ou mais: a IA pode trocar
      extraTools: port.switchTool(),
      identityPort: port,
      identityNote,
    }));
    // registro de acesso do visitante (Marco Civil): IP quando a conversa começa e quando muda;
    // o teste ao vivo do painel já fica no registro de acesso do painel
    if (channel !== "painel") after(() => logWidgetAccess(db, { botId: bot.id, conversationId: activeId, ip: clientIp(req), isNew: newConversation }));
    // anexos das ações: ficam ligados à resposta gravada (o painel e o histórico mostram junto)
    after(async () => {
      const ids = files().flatMap((f) => (f.id && f.status !== "falha" ? [f.id] : []));
      const answerId = ids.length ? await saved : null;
      if (answerId) await linkAttachments(db, ids, answerId);
    });
    // atendimento aberto antes da conversa existir: liga a primeira conversa a ele
    if (slot?.isNew && slot.id && newConversation) after(async () => void (await db.from("atendimentos").update({ first_conversation_id: activeId }).eq("id", slot.id)));
    return createUIMessageStreamResponse({
      stream: result.toUIMessageStream({ onError: () => "erro" }).pipeThrough(withoutToolParts({ component: components, links })).pipeThrough(appendActionComponent(components)).pipeThrough(appendActionFiles(files)).pipeThrough(appendSiteOffer(siteOffer)),
      headers: { ...CORS_HEADERS, "X-Conversation-Id": activeId, ...(handoff ? { "X-Handoff": handoff } : {}), "Access-Control-Expose-Headers": "X-Conversation-Id, X-Handoff" },
    });
  } catch (e) {
    const msg = (e as Error).message;
    // Falha do provedor de IA: o visitante nunca vê erro técnico. O widget troca o chat por um
    // formulário de contato (o lead não se perde). Só a mensagem vai ao log: o erro do provedor
    // leva o pedido inteiro, com a conversa (relatório de segurança de 23/10/2026)
    console.error("chat: a IA falhou", msg);
    return contactFallback("chat_failed", 503);
  }
}
