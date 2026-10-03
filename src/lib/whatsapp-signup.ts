import type { SupabaseClient } from "@supabase/supabase-js";
import { fail, ok, type ActionResult } from "./action-result";
import { notifyAgencyOwner, notifyPlatform } from "./notify";
import { seal, unseal } from "./secret-box";
import { appUrl } from "./utils";
import { forgetBsuids } from "./contacts";
import { channelBlock } from "./features";
import { WHATSAPP_BILLING_URL, WhatsAppError, exchangeSignupCode, getPhoneNumber, listWabaPhoneNumbers, newPin, registerNumber, startAppSync, subscribeApp } from "./whatsapp";

export interface SignupResult {
  code: string;
  /** Vem vazio na coexistência: a Meta só informa a conta, e o número é buscado nela. */
  phoneNumberId?: string | null;
  wabaId: string;
  businessId?: string | null;
  /** O cliente conectou o WhatsApp Business do celular (o número continua funcionando no app). */
  coexistence?: boolean;
  /** Coexistência: marcou que desligou a saudação e a ausência do app (registro, sem bloquear). */
  autoRepliesOff?: boolean;
}

/**
 * O mesmo portfólio da Meta (business_id) já está em outro cliente? Avisa a equipe, sem bloquear:
 * pode ser a agência conectando com o portfólio dela (o cliente perde o número se sair; a Meta
 * proíbe revenda) ou um negócio com várias lojas.
 */
async function alertSharedPortfolio(admin: SupabaseClient, botId: string, businessId: string) {
  const { data: rows } = await admin.from("whatsapp_channels").select("bot_id, display_phone, bots(client_id, client_name, name, agencies(name))").eq("business_id", businessId).is("disconnected_at", null);
  type Row = { bot_id: string; display_phone: string | null; bots: { client_id: string | null; client_name: string; name: string; agencies: { name: string } | null } | null };
  const list = (rows ?? []) as unknown as Row[];
  const me = list.find((r) => r.bot_id === botId)?.bots;
  const others = list.filter((r) => r.bot_id !== botId && r.bots && (r.bots.client_id ?? r.bots.client_name) !== (me?.client_id ?? me?.client_name));
  if (!others.length) return;
  const line = (r: Row) => `- ${r.bots?.client_name} (${r.bots?.agencies?.name ?? "?"} · ${r.bots?.name}${r.display_phone ? ` · ${r.display_phone}` : ""})`;
  await notifyPlatform(`Mesmo portfólio da Meta em clientes diferentes (${businessId})`, [
    `Um número do WhatsApp acabou de ser conectado com o portfólio ${businessId}, que já está em outro cliente.`,
    "",
    ...list.map(line),
    "",
    "Nada foi bloqueado. Confira se a agência conectou com o portfólio dela (o cliente perde o número se sair) ou se é um negócio com várias lojas. Lista completa em /admin/clientes.",
  ]);
}

/**
 * Fim do cadastro incorporado (Embedded Signup): o dono do número escolheu a conta na janela da
 * Meta. Troca o código pelo token dele, inscreve o app na conta do WhatsApp e liga o número ao
 * chatbot. Número novo: registra na Cloud API com um PIN. Coexistência (número do app do
 * celular): não registra (já está) e pede a sincronização de contatos e histórico, que a Meta
 * exige em 24 h. Token e PIN ficam cifrados; nada disso volta para o navegador.
 *
 * Quem chama já conferiu a permissão: o painel (agência logada) ou o link de conexão (cliente).
 * `via` muda só o aviso: no link, é o próprio cliente que está na tela.
 */
export async function connectFromSignup(admin: SupabaseClient, opts: { botId: string; agencyId: string; clientName: string; input: SignupResult; via: "painel" | "link" }): Promise<ActionResult> {
  const { botId, input, via } = opts;
  // liberação da agência (backoffice) e, no teste grátis, o conteúdo mínimo do chatbot
  const locked = await channelBlock(admin, opts.agencyId, "whatsapp", botId);
  if (locked) return fail(via === "link" ? "A conexão do WhatsApp ainda não está liberada para este assistente. Fale com a agência." : locked);
  const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  const coexistence = Boolean(input.coexistence);
  const wabaId = digits(input.wabaId);
  const businessId = digits(input.businessId) || null;
  if (!input.code || wabaId.length < 8) return fail("A Meta não devolveu a conta escolhida. Tente conectar de novo.");

  let token: string;
  let phoneNumberId = digits(input.phoneNumberId);
  try {
    token = await exchangeSignupCode(input.code);
    if (phoneNumberId.length < 8) {
      const numbers = await listWabaPhoneNumbers(wabaId, token);
      if (numbers.length !== 1) return fail(numbers.length ? "Esta conta do WhatsApp tem mais de um número. Por enquanto conecte uma conta com um número só." : "A conta do WhatsApp escolhida não tem número. Tente conectar de novo.");
      phoneNumberId = numbers[0].id;
    }
  } catch (e) {
    console.error("whatsapp: cadastro incorporado falhou", e);
    return fail(`A Meta recusou a conexão: ${e instanceof WhatsAppError ? e.message : "erro desconhecido"}. Tente de novo em instantes.`);
  }

  const { data: existing } = await admin.from("whatsapp_channels").select("bot_id, pin_enc").eq("phone_number_id", phoneNumberId).maybeSingle();
  if (existing && existing.bot_id !== botId) return fail(via === "link" ? "Este número já está ligado a outro assistente. Fale com a agência." : "Este número já está ligado a outro chatbot. Desconecte lá primeiro.");

  let phone: Awaited<ReturnType<typeof getPhoneNumber>>;
  // reconectar o mesmo número usa o mesmo PIN: um PIN novo seria recusado pela verificação em duas etapas
  const pin = existing?.pin_enc ? unseal(existing.pin_enc) : newPin();
  try {
    await subscribeApp(wabaId, token);
    if (!coexistence) await registerNumber(phoneNumberId, pin, token);
    phone = await getPhoneNumber(phoneNumberId, token);
  } catch (e) {
    console.error("whatsapp: cadastro incorporado falhou", e);
    return fail(`A Meta recusou a conexão: ${e instanceof WhatsAppError ? e.message : "erro desconhecido"}. Tente de novo em instantes.`);
  }

  // portfólio anterior do chatbot: o BSUID é por portfólio, então trocar de portfólio anula os antigos
  const { data: previous } = await admin.from("whatsapp_channels").select("business_id").eq("bot_id", botId).maybeSingle();
  await admin.from("whatsapp_channels").delete().eq("bot_id", botId);
  const { error } = await admin.from("whatsapp_channels").insert({
    bot_id: botId,
    phone_number_id: phoneNumberId,
    waba_id: wabaId,
    business_id: businessId,
    display_phone: phone.display_phone_number ?? null,
    verified_name: phone.verified_name ?? null,
    access_token_enc: seal(token),
    pin_enc: coexistence ? null : seal(pin),
    coexistence,
    auto_replies_off_at: coexistence && input.autoRepliesOff ? new Date().toISOString() : null,
  });
  if (error) return fail("O número foi conectado na Meta, mas não deu para salvar. Tente de novo.");
  if (previous?.business_id && businessId && previous.business_id !== businessId) await forgetBsuids(admin, botId);
  if (businessId) await alertSharedPortfolio(admin, botId, businessId).catch((e) => console.error("whatsapp: alerta de portfólio", e));

  // coexistência: contatos primeiro, depois o histórico (a Meta desconecta se não pedirmos em 24 h)
  let syncFailed = false;
  if (coexistence) {
    try {
      await startAppSync(phoneNumberId, token, "smb_app_state_sync");
      await startAppSync(phoneNumberId, token, "history");
    } catch (e) {
      console.error("whatsapp: sincronização da coexistência falhou", e);
      syncFailed = true;
    }
  }

  const number = phone.display_phone_number ?? phoneNumberId;
  // o cliente paga a Meta direto: o dono da agência fica sabendo e, pelo painel, com o passo a passo
  await notifyAgencyOwner(admin, opts.agencyId, via === "link" ? `${opts.clientName} conectou o WhatsApp` : "WhatsApp conectado: falta o cartão na Meta", [
    via === "link"
      ? `${opts.clientName} conectou o número ${number} pelo link de conexão${coexistence ? " (continua funcionando no app do celular)" : ""}. O assistente já responde por ele.`
      : `O número ${number} foi conectado ao Boavoz${coexistence ? " (continua funcionando no app do celular)" : ""}.`,
    "",
    via === "link" ? "A página do link mostrou ao cliente o último passo: cadastrar um cartão para a Meta. Confira na aba WhatsApp se ele já cadastrou." : "Último passo, feito pelo cliente: cadastrar um cartão para a Meta.",
    `1. Entrar em ${WHATSAPP_BILLING_URL} com o Facebook usado na conexão.`,
    "2. Abrir Configurações de pagamento e adicionar um cartão de crédito.",
    "",
    "Por que: as mensagens do WhatsApp são cobradas pela Meta direto no cartão do cliente, por mensagem entregue (valores na tabela da Meta para o Brasil). Não passam pela agência nem pelo Boavoz.",
    "Sem cartão, o assistente responde enquanto houver mensagens grátis; depois a Meta recusa e ele para de responder.",
    ...(syncFailed ? ["", "Atenção: a sincronização com o app do celular falhou. Conecte de novo em até 24 h, senão a Meta desconecta o número."] : []),
    "",
    `Painel: ${appUrl(`/painel/bots/${botId}?tab=whatsapp`)}`,
  ]).catch(() => false);

  const syncWarning = syncFailed ? " Atenção: a sincronização com o app do celular falhou; conecte de novo em até 24 h para o número não ser desconectado pela Meta." : "";
  if (via === "link") return ok(`WhatsApp ${number} conectado!${syncWarning}`);
  return ok(`WhatsApp ${number} conectado.${coexistence ? " Ele continua funcionando no app do celular." : ""} Último passo: o cliente cadastra um cartão na Meta (as instruções foram para o seu e-mail).${syncWarning}`);
}
