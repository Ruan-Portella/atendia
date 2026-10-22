import { createAdminClient } from "@/lib/supabase/admin";
import { CAMPAIGN_STATUS_LABEL, QUALITY_LABEL, listCampaigns, whatsappLimits } from "@/lib/campaigns";
import { formatInZone } from "@/lib/timezone";
import { relativeTime } from "@/lib/utils";
import { changeCampaign } from "@/app/painel/campanhas/actions";
import { CampaignList, type CampaignListItem } from "@/components/campaign-list";
import { HowItWorks } from "@/components/ui/form-section";

const KIND_LABEL = { marketing: "Marketing", utility_reminder: "Lembrete" } as const;

export interface BoardBot {
  id: string;
  name: string;
  client_name: string;
  client_id: string | null;
}

/**
 * Limite de envio da Meta de cada número e a lista de campanhas destes chatbots (leva B3; redesenho,
 * etapa 5: o limite enxuto, com a explicação em "Como funciona", e a lista com busca e filtros). A
 * aba Campanhas do cliente mostra os dele; o menu Campanhas e réguas, todos os clientes do escopo.
 */
export async function CampaignBoard({ bots, showClient, limits: withLimits = true }: { bots: BoardBot[]; showClient: boolean; limits?: boolean }) {
  const botById = new Map(bots.map((b) => [b.id, b]));
  const admin = createAdminClient();
  const ids = [...botById.keys()];
  const [campaigns, limits] = await Promise.all([listCampaigns(admin, ids, 50), withLimits ? whatsappLimits(admin, ids) : Promise.resolve([])]);
  const clientIds = [...new Set(campaigns.map((c) => botById.get(c.bot_id)?.client_id).filter((x): x is string => Boolean(x)))];
  const { data: clients } = clientIds.length ? await admin.from("clients").select("id, timezone").in("id", clientIds) : { data: [] };
  const tzOf = new Map((clients ?? []).map((c) => [c.id as string, c.timezone as string]));
  const items: CampaignListItem[] = campaigns.map((c) => {
    const bot = botById.get(c.bot_id);
    const t = c.totals ?? {};
    const read = t.read ?? 0;
    return {
      id: c.id,
      name: c.name,
      kind: KIND_LABEL[c.kind],
      template: c.template_name,
      status: c.status,
      statusLabel: CAMPAIGN_STATUS_LABEL[c.status].replace(/^./, (x) => x.toUpperCase()),
      note: c.status === "scheduled" && c.scheduled_at ? `Sai ${formatInZone(c.scheduled_at, tzOf.get(bot?.client_id ?? "") ?? null)}` : c.status === "paused" && c.pause_reason ? c.pause_reason : null,
      created: relativeTime(c.created_at),
      botName: bot?.name ?? "?",
      clientName: bot?.client_name ?? "",
      clientId: bot?.client_id ?? null,
      delivered: (t.delivered ?? 0) + read,
      read,
      audience: c.estimated_contacts ?? 0,
    };
  });

  return (
    <>
      {limits.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1">
            <h2 className="kpi-label">Limite de envio da Meta · 24 horas</h2>
            <HowItWorks label="Como funciona o limite">
              <p>
                Cada conta do WhatsApp fala com um número de pessoas por 24 h, somando campanhas e réguas de todos os chatbots dela (começa em 250; 2.000 com o negócio verificado, e sobe com o uso). Passando disso,
                o envio continua no dia seguinte, sozinho. Não há limite de contatos por plano.
              </p>
            </HowItWorks>
          </div>
          <div className="card flex flex-col divide-y divide-line-2">
            {limits.map((l) => {
              const finite = Number.isFinite(l.limit);
              const used = finite ? Math.min(100, Math.round((l.used / l.limit) * 100)) : 0;
              return (
                <div key={l.wabaId} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{l.phones.join(", ") || "número sem nome"}</div>
                    <div className="truncate text-xs text-muted">
                      {l.botIds.map((id) => botById.get(id)?.name ?? "").filter(Boolean).join(", ")} · qualidade {QUALITY_LABEL[(l.quality ?? "").toUpperCase()] ?? "sem nota"}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col gap-1 sm:w-[240px] sm:items-end">
                    <span className="tabular text-xs text-ink-2">
                      {l.used.toLocaleString("pt-BR")} de {finite ? l.limit.toLocaleString("pt-BR") : "sem limite"} pessoas
                    </span>
                    {finite && (
                      <span className="h-1.5 w-full overflow-hidden rounded-full bg-line-2">
                        <span className={`block h-full rounded-full ${used >= 90 ? "bg-amber" : "bg-brand"}`} style={{ width: `${used}%` }} />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <CampaignList items={items} showClient={showClient} changeCampaign={changeCampaign} />
    </>
  );
}
