import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountProfile } from "./first-access";
import { PACKS, type PackId } from "./plans";

/** Cookie que esconde o card "Primeiros passos" (por navegador; ele some sozinho quando tudo fica pronto). */
export const ONBOARDING_COOKIE = "bv_onboarding";

export interface OnboardingBot {
  id: string;
  status: string;
  installed_at: string | null;
  readySources: number;
  testConversations: number;
  /** WhatsApp e Instagram conectados: no perfil "meu negócio", contam como levar o chatbot para fora do painel. */
  channels?: number;
}

/** O que os passos do perfil dev olham: chaves (as revogadas contam), uso da API, webhooks e o pacote. */
export interface OnboardingDev {
  keys: number;
  keyUsed: boolean;
  webhooks: number;
  integrations: boolean;
}

export interface OnboardingStep {
  key: "bot" | "fontes" | "teste" | "publicar" | "instalar" | "marca" | "chave" | "webhook" | "pacote" | "chamada";
  title: string;
  hint: string;
  href: string;
  cta: string;
  done: boolean;
}

/** A frase do card, pelo perfil da conta (sem perfil, o da agência). */
export const ONBOARDING_GOAL: Record<AccountProfile, string> = {
  agency: "Do cadastro ao chat respondendo no site do cliente.",
  business: "Do cadastro ao assistente atendendo os seus clientes.",
  developer: "Do cadastro à primeira chamada da API.",
};

const outside = (b: OnboardingBot) => Boolean(b.installed_at) || (b.channels ?? 0) > 0;

/** Quanto o chatbot já andou no caminho criar → treinar → testar → publicar → instalar. */
const progress = (b: OnboardingBot) => (b.readySources > 0 ? 1 : 0) + (b.testConversations > 0 ? 1 : 0) + (b.status === "live" ? 1 : 0) + (outside(b) ? 1 : 0);

/**
 * Passos do primeiro uso, marcados pelos dados reais (nada é "clicado como feito"), pelo perfil
 * do primeiro acesso: agência (o caminho até o site do cliente), o próprio negócio (o site ou o
 * WhatsApp dele) ou dev (chave, webhook, pacote e a primeira chamada). Os passos de chatbot olham
 * o chatbot mais adiantado da agência, e os links levam a ele.
 */
export function onboardingSteps(input: { bots: OnboardingBot[]; hasLogo: boolean; profile?: AccountProfile | null; dev?: OnboardingDev }): OnboardingStep[] {
  const bot = [...input.bots].sort((a, b) => progress(b) - progress(a))[0];
  const editor = (tab?: string) => (bot ? `/painel/bots/${bot.id}${tab ? `?tab=${tab}` : ""}` : "/painel/bots/novo");
  const created = Boolean(bot);
  const trained = Boolean(bot && bot.readySources > 0);
  const tested = Boolean(bot && bot.testConversations > 0);
  const live = bot?.status === "live";

  if (input.profile === "developer") {
    const d = input.dev ?? { keys: 0, keyUsed: false, webhooks: 0, integrations: false };
    return [
      { key: "bot", title: "Crie um chatbot", hint: "É ele quem responde: pela API, você manda mensagens e lê as conversas dele.", href: "/painel/bots/novo", cta: "Criar chatbot", done: created },
      { key: "fontes", title: "Treine com uma fonte", hint: "Um site, um PDF ou perguntas frequentes: é daí que saem as respostas da IA.", href: editor("fontes"), cta: "Adicionar fonte", done: trained },
      { key: "chave", title: "Crie uma chave da API", hint: "Em Integrações, escolha os chatbots e as permissões. A chave aparece uma vez só: guarde no seu sistema.", href: "/painel/integracoes", cta: "Criar chave", done: d.keys > 0 },
      { key: "webhook", title: "Cadastre um webhook", hint: "Os eventos (mensagem nova, lead, pedido de atendente) chegam no seu sistema, assinados. Confira pelo botão Testar.", href: "/painel/integracoes", cta: "Cadastrar webhook", done: d.webhooks > 0 },
      { key: "pacote", title: "Assine o pacote Integrações", hint: `Com ele, a API responde e os webhooks entregam (R$ ${PACKS.integracoes.priceBrl} por mês).`, href: "/painel/cobranca", cta: "Ver em Cobrança", done: d.integrations },
      { key: "chamada", title: "Faça a primeira chamada", hint: "Siga o guia para devs: a primeira mensagem pela API e os eventos no seu sistema (ou a coleção do Postman).", href: "/docs/guias/dev", cta: "Abrir o guia", done: d.keyUsed },
    ];
  }

  if (input.profile === "business") {
    return [
      { key: "bot", title: "Crie o seu chatbot", hint: "Dê um nome ao assistente do seu negócio.", href: "/painel/bots/novo", cta: "Criar chatbot", done: created },
      { key: "fontes", title: "Treine com o seu site", hint: "Cole o endereço do seu site, uma página, um PDF ou escreva as perguntas frequentes. É daí que saem as respostas.", href: editor("fontes"), cta: "Adicionar fonte", done: trained },
      { key: "teste", title: "Converse com ele", hint: "Use o teste ao vivo ao lado do editor e pergunte o que um cliente seu perguntaria.", href: editor(), cta: "Testar agora", done: tested },
      { key: "publicar", title: "Coloque no ar", hint: "Enquanto está em rascunho, ele não responde no seu site nem no WhatsApp.", href: editor(), cta: "Publicar", done: live },
      { key: "instalar", title: "Leve para o site ou o WhatsApp", hint: "Cole uma linha de código no seu site (tem passo a passo para WordPress, Wix, Shopify e outros) ou conecte o WhatsApp e o Instagram na página do chatbot.", href: editor("instalacao"), cta: "Ver como", done: Boolean(bot && outside(bot)) },
      { key: "marca", title: "Coloque o seu logo", hint: "Ele aparece no chat do site e nos e-mails.", href: "/painel/marca", cta: "Enviar logo", done: input.hasLogo },
    ];
  }

  return [
    { key: "bot", title: "Crie o primeiro chatbot", hint: "Escolha o cliente (ou cadastre um na hora) e dê um nome ao assistente.", href: "/painel/bots/novo", cta: "Criar chatbot", done: created },
    { key: "fontes", title: "Treine com o site do cliente", hint: "Cole o endereço do site, uma página, um PDF ou escreva FAQs. É daí que saem as respostas.", href: editor("fontes"), cta: "Adicionar fonte", done: trained },
    { key: "teste", title: "Converse com ele", hint: "Use o teste ao vivo ao lado do editor e pergunte o que um visitante perguntaria.", href: editor(), cta: "Testar agora", done: tested },
    { key: "publicar", title: "Coloque no ar", hint: "Enquanto está em rascunho, o chat não responde no site do cliente.", href: editor(), cta: "Publicar", done: live },
    { key: "instalar", title: "Instale no site", hint: "Cole uma linha de código (tem passo a passo para WordPress, Wix, Shopify e outros). Marcamos sozinhos quando o chat carregar lá.", href: editor("instalacao"), cta: "Ver instalação", done: Boolean(bot?.installed_at) },
    { key: "marca", title: "Coloque a sua marca", hint: "Seu logo aparece no chat, na demo, no portal e nos relatórios. A plataforma nunca aparece para o cliente.", href: "/painel/marca", cta: "Enviar logo", done: input.hasLogo },
  ];
}

/**
 * Carrega o que os passos precisam: chatbots de clientes (sem demos), fontes prontas e testes no
 * painel; no perfil "meu negócio", os canais conectados; no perfil dev, as chaves, os webhooks e o
 * pacote. Chaves, webhooks e canais são só do servidor (admin), filtrados pela agência.
 */
export async function getOnboarding(supabase: SupabaseClient, agency: { id: string; logo_url: string | null; profile?: AccountProfile | null }, opts: { admin: SupabaseClient; packs: PackId[] }): Promise<OnboardingStep[]> {
  const { data } = await supabase
    .from("bots")
    .select("id, status, installed_at, template_id, sources(count), conversations(count)")
    .eq("agency_id", agency.id)
    .eq("is_demo", false)
    .eq("is_template", false)
    .eq("sources.status", "ready")
    .eq("conversations.channel", "painel");
  const count = (v: unknown) => (Array.isArray(v) ? Number((v[0] as { count?: number } | undefined)?.count ?? 0) : 0);
  const rows = (data ?? []) as Array<{ id: string; status: string; installed_at: string | null; template_id: string | null; sources: unknown; conversations: unknown }>;
  // o derivado (D') usa a base do modelo: as fontes prontas dele contam (o modelo só aparece no admin)
  const templateIds = [...new Set(rows.map((b) => b.template_id).filter((t): t is string => Boolean(t)))];
  const { data: templateSources } = templateIds.length ? await opts.admin.from("sources").select("bot_id").in("bot_id", templateIds).eq("status", "ready") : { data: [] };
  const templateReady = new Map<string, number>();
  for (const r of (templateSources ?? []) as Array<{ bot_id: string }>) templateReady.set(r.bot_id, (templateReady.get(r.bot_id) ?? 0) + 1);
  const bots: OnboardingBot[] = rows.map((b) => ({
    id: b.id,
    status: b.status,
    installed_at: b.installed_at,
    readySources: count(b.sources) + (b.template_id ? (templateReady.get(b.template_id) ?? 0) : 0),
    testConversations: count(b.conversations),
  }));

  if (agency.profile === "business" && bots.length) {
    const ids = bots.map((b) => b.id);
    const [{ data: wa }, { data: ig }] = await Promise.all([
      opts.admin.from("whatsapp_channels").select("bot_id").in("bot_id", ids).is("disconnected_at", null),
      opts.admin.from("instagram_channels").select("bot_id").in("bot_id", ids).is("disconnected_at", null),
    ]);
    for (const row of [...(wa ?? []), ...(ig ?? [])] as Array<{ bot_id: string }>) {
      const b = bots.find((x) => x.id === row.bot_id);
      if (b) b.channels = (b.channels ?? 0) + 1;
    }
  }

  let dev: OnboardingDev | undefined;
  if (agency.profile === "developer") {
    const [{ data: keys }, { count: webhooks }] = await Promise.all([
      opts.admin.from("api_keys").select("last_used_at").eq("agency_id", agency.id),
      opts.admin.from("webhooks").select("id", { count: "exact", head: true }).eq("agency_id", agency.id),
    ]);
    const k = (keys ?? []) as Array<{ last_used_at: string | null }>;
    dev = { keys: k.length, keyUsed: k.some((x) => Boolean(x.last_used_at)), webhooks: webhooks ?? 0, integrations: opts.packs.includes("integracoes") };
  }
  return onboardingSteps({ bots, hasLogo: Boolean(agency.logo_url), profile: agency.profile, dev });
}
