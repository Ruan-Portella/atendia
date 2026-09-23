import type { SupabaseClient } from "@supabase/supabase-js";

/** Cookie que esconde o card "Primeiros passos" (por navegador; ele some sozinho quando tudo fica pronto). */
export const ONBOARDING_COOKIE = "bv_onboarding";

export interface OnboardingBot {
  id: string;
  status: string;
  installed_at: string | null;
  readySources: number;
  testConversations: number;
}

export interface OnboardingStep {
  key: "bot" | "fontes" | "teste" | "publicar" | "instalar" | "marca";
  title: string;
  hint: string;
  href: string;
  cta: string;
  done: boolean;
}

/** Quanto o chatbot já andou no caminho criar → treinar → testar → publicar → instalar. */
const progress = (b: OnboardingBot) => (b.readySources > 0 ? 1 : 0) + (b.testConversations > 0 ? 1 : 0) + (b.status === "live" ? 1 : 0) + (b.installed_at ? 1 : 0);

/**
 * Passos do primeiro uso, marcados pelos dados reais (nada é "clicado como feito").
 * Os passos de chatbot olham o chatbot mais adiantado da agência, e os links levam a ele.
 */
export function onboardingSteps(input: { bots: OnboardingBot[]; hasLogo: boolean }): OnboardingStep[] {
  const bot = [...input.bots].sort((a, b) => progress(b) - progress(a))[0];
  const editor = (tab?: string) => (bot ? `/painel/bots/${bot.id}${tab ? `?tab=${tab}` : ""}` : "/painel/bots/novo");

  return [
    { key: "bot", title: "Crie o primeiro chatbot", hint: "Escolha o cliente (ou cadastre um na hora) e dê um nome ao assistente.", href: "/painel/bots/novo", cta: "Criar chatbot", done: Boolean(bot) },
    { key: "fontes", title: "Treine com o site do cliente", hint: "Cole o endereço do site, uma página, um PDF ou escreva FAQs. É daí que saem as respostas.", href: editor("fontes"), cta: "Adicionar fonte", done: Boolean(bot && bot.readySources > 0) },
    { key: "teste", title: "Converse com ele", hint: "Use o teste ao vivo ao lado do editor e pergunte o que um visitante perguntaria.", href: editor(), cta: "Testar agora", done: Boolean(bot && bot.testConversations > 0) },
    { key: "publicar", title: "Coloque no ar", hint: "Enquanto está em rascunho, o chat não responde no site do cliente.", href: editor(), cta: "Publicar", done: bot?.status === "live" },
    { key: "instalar", title: "Instale no site", hint: "Cole uma linha de código (tem passo a passo para WordPress, Wix, Shopify e outros). Marcamos sozinhos quando o chat carregar lá.", href: editor("instalacao"), cta: "Ver instalação", done: Boolean(bot?.installed_at) },
    { key: "marca", title: "Coloque a sua marca", hint: "Seu logo aparece no chat, na demo, no portal e nos relatórios. A plataforma nunca aparece para o cliente.", href: "/painel/marca", cta: "Enviar logo", done: input.hasLogo },
  ];
}

/** Carrega o que os passos precisam: chatbots de clientes (sem demos), fontes prontas e testes no painel. */
export async function getOnboarding(supabase: SupabaseClient, agency: { id: string; logo_url: string | null }): Promise<OnboardingStep[]> {
  const { data } = await supabase
    .from("bots")
    .select("id, status, installed_at, sources(count), conversations(count)")
    .eq("agency_id", agency.id)
    .eq("is_demo", false)
    .eq("sources.status", "ready")
    .eq("conversations.channel", "painel");
  const count = (v: unknown) => (Array.isArray(v) ? Number((v[0] as { count?: number } | undefined)?.count ?? 0) : 0);
  const bots = ((data ?? []) as Array<{ id: string; status: string; installed_at: string | null; sources: unknown; conversations: unknown }>).map((b) => ({
    id: b.id,
    status: b.status,
    installed_at: b.installed_at,
    readySources: count(b.sources),
    testConversations: count(b.conversations),
  }));
  return onboardingSteps({ bots, hasLogo: Boolean(agency.logo_url) });
}
