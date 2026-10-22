import Link from "next/link";
import { requirePermission } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadTemplateChannel } from "@/lib/whatsapp-templates";
import { reguasPanel } from "@/lib/reguas";
import { DEFAULT_TIMEZONE } from "@/lib/timezone";
import { ReguaCard } from "@/components/regua-card";
import { reguaSettingsAction, reguaTemplateAction, reguaToggleAction } from "../actions";

export const metadata = { title: "Réguas" };

/**
 * Campanhas → Réguas (leva Réguas, partes 3 e 4): as 5 réguas de um chatbot com o WhatsApp
 * conectado. Em cada uma, o prazo e a hora, o modelo da Meta (o texto sugerido, editável, vai para
 * análise), ligar e desligar, a estimativa dos próximos 30 dias e os números do que já saiu.
 */
export default async function ReguasPage({ searchParams }: PageProps<"/painel/campanhas/reguas">) {
  await requirePermission("config");
  const sp = await searchParams;
  // a RLS limita aos chatbots do escopo de quem está logado
  const { data: bots } = await (await createClient()).from("bots").select("id, name, client_name, client_id").eq("is_demo", false).eq("is_template", false).order("created_at");
  const admin = createAdminClient();
  const ids = (bots ?? []).map((b) => b.id as string);
  const { data: channels } = ids.length ? await admin.from("whatsapp_channels").select("bot_id").in("bot_id", ids).is("disconnected_at", null) : { data: [] };
  const connected = new Set((channels ?? []).map((c) => c.bot_id as string));
  const withWhatsApp = (bots ?? []).filter((b) => connected.has(b.id as string));
  const wanted = typeof sp.bot === "string" ? sp.bot : null;
  const client = typeof sp.cliente === "string" ? sp.cliente : null;
  const bot = withWhatsApp.find((b) => b.id === wanted) ?? withWhatsApp.find((b) => client && b.client_id === client) ?? withWhatsApp[0] ?? null;

  const header = (
    <div className="flex flex-col gap-2">
      <Link href="/painel/campanhas" className="text-sm font-semibold text-muted">← Campanhas</Link>
      <h1 className="text-2xl font-normal sm:text-[28px]">Réguas</h1>
      <p className="max-w-[720px] text-sm text-muted">
        Mensagens automáticas do WhatsApp: aniversário, “faz tempo que você não vem”, pós-atendimento, lembrete antes do horário e “sem resposta”. Cada régua usa um modelo da Meta e sai pelo número do chatbot, das 8h às 20h no fuso do cliente, uma régua por pessoa a cada 24 horas. Promoção só vai para quem aceitou novidades, e quem mandou SAIR fica de fora.
      </p>
    </div>
  );
  if (!bot) {
    return (
      <div className="flex max-w-[860px] flex-col gap-5">
        {header}
        <p className="card p-5 text-sm text-muted">Nenhum chatbot com o WhatsApp conectado. As réguas saem pelo número do chatbot: conecte o WhatsApp na aba WhatsApp dele.</p>
      </div>
    );
  }

  const botId = bot.id as string;
  const [ch, { data: cl }] = await Promise.all([loadTemplateChannel(admin, botId), bot.client_id ? admin.from("clients").select("timezone, utility_consent_at").eq("id", bot.client_id).maybeSingle() : Promise.resolve({ data: null })]);
  const tz = (cl?.timezone as string | null) ?? DEFAULT_TIMEZONE;
  const declared = Boolean(cl?.utility_consent_at);
  const { items, templatesError } = await reguasPanel(admin, { botId, company: bot.client_name as string, ch, tz });

  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      {header}

      <form method="get" className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-0 flex-1">
          <label htmlFor="regua-bot" className="label">Chatbot</label>
          <select id="regua-bot" name="bot" defaultValue={botId} className="input">
            {withWhatsApp.map((b) => (
              <option key={b.id as string} value={b.id as string}>
                {b.name as string} · {b.client_name as string}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-ghost">Ver</button>
      </form>

      {templatesError && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Não deu para ler os modelos na Meta agora ({templatesError}). Recarregue em instantes.</p>}
      {!declared && (
        <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">
          As réguas de utilidade (lembrete, pós-atendimento e sem resposta) vão só para quem já escreveu ao chatbot, enquanto o cliente não fizer a declaração de consentimento para lembretes{bot.client_id ? <> (na <Link href={`/painel/clientes/${bot.client_id as string}?tab=campanhas`} className="underline">aba Campanhas do cliente</Link>)</> : ""}.
        </p>
      )}

      {items.map((it) => (
        <ReguaCard
          key={it.kind}
          item={it}
          actions={{ settings: reguaSettingsAction.bind(null, botId, it.kind), template: reguaTemplateAction.bind(null, botId, it.kind), on: reguaToggleAction.bind(null, botId, it.kind, true), off: reguaToggleAction.bind(null, botId, it.kind, false) }}
        />
      ))}
    </div>
  );
}
