import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAMPAIGN_STATUS_LABEL, QUALITY_LABEL, listCampaigns, whatsappLimits } from "@/lib/campaigns";
import { formatInZone } from "@/lib/timezone";
import { relativeTime } from "@/lib/utils";
import { CampaignActions } from "@/components/campaign-actions";

const KIND_LABEL = { marketing: "Marketing", utility_reminder: "Lembrete" } as const;
const STATUS_TONE: Record<string, string> = { sending: "bg-brand-soft text-brand", scheduled: "bg-brand-soft text-brand", paused: "bg-amber-soft text-amber-ink", finished: "bg-ground text-ink-2", canceled: "bg-ground text-muted", draft: "bg-ground text-muted" };

export interface BoardBot {
  id: string;
  name: string;
  client_name: string;
  client_id: string | null;
}

/**
 * Limite de envio da Meta de cada número e a lista de campanhas destes chatbots (leva B3). A aba
 * Campanhas do cliente mostra os dele; o menu Campanhas, todos os clientes do escopo.
 */
export async function CampaignBoard({ bots, showClient, limits: withLimits = true }: { bots: BoardBot[]; showClient: boolean; limits?: boolean }) {
  const botById = new Map(bots.map((b) => [b.id, b]));
  const admin = createAdminClient();
  const ids = [...botById.keys()];
  const [campaigns, limits] = await Promise.all([listCampaigns(admin, ids, 50), withLimits ? whatsappLimits(admin, ids) : Promise.resolve([])]);
  const clientIds = [...new Set(campaigns.map((c) => botById.get(c.bot_id)?.client_id).filter((x): x is string => Boolean(x)))];
  const { data: clients } = clientIds.length ? await admin.from("clients").select("id, timezone").in("id", clientIds) : { data: [] };
  const tzOf = new Map((clients ?? []).map((c) => [c.id as string, c.timezone as string]));

  return (
    <>
      {limits.length > 0 && (
        <section className="card flex flex-col gap-3 p-5">
          <div>
            <h2 className="font-semibold">Limite de envio da Meta</h2>
            <p className="text-xs text-muted">
              Cada conta do WhatsApp fala com um número de pessoas por 24 h, somando campanhas e lembretes de todos os chatbots dela (começa em 250; 2.000 com o negócio verificado, e sobe com o uso).
              Passando disso, o envio continua no dia seguinte, sozinho. Não há limite de contatos por plano.
            </p>
          </div>
          <div className="flex flex-col divide-y divide-line-2 text-sm">
            {limits.map((l) => {
              const used = Number.isFinite(l.limit) ? Math.min(100, Math.round((l.used / l.limit) * 100)) : 0;
              return (
                <div key={l.wabaId} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <div className="font-semibold">{l.phones.join(", ") || "número sem nome"}</div>
                    <div className="text-xs text-muted">
                      {l.botIds.map((id) => botById.get(id)?.name ?? "").filter(Boolean).join(", ")} · qualidade {QUALITY_LABEL[(l.quality ?? "").toUpperCase()] ?? "sem nota"}
                    </div>
                  </div>
                  <div className="flex min-w-[220px] flex-col gap-1 sm:items-end">
                    <span className="tabular text-xs text-ink-2">
                      {l.used.toLocaleString("pt-BR")} de {Number.isFinite(l.limit) ? l.limit.toLocaleString("pt-BR") : "sem limite"} pessoas nas últimas 24 h
                    </span>
                    {Number.isFinite(l.limit) && (
                      <span className="h-1.5 w-full overflow-hidden rounded-full bg-ground sm:w-[220px]">
                        <span className={`block h-full ${used >= 90 ? "bg-amber-ink" : "bg-brand"}`} style={{ width: `${used}%` }} />
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div className="card overflow-hidden">
        {campaigns.length ? (
          campaigns.map((c) => {
            const bot = botById.get(c.bot_id);
            const tz = tzOf.get(bot?.client_id ?? "") ?? null;
            const t = c.totals ?? {};
            const read = t.read ?? 0;
            const delivered = (t.delivered ?? 0) + read;
            return (
              <div key={c.id} className="flex flex-col gap-2 border-b border-line-2 px-4 py-3.5 text-sm last:border-0 lg:grid lg:grid-cols-[2fr_1.4fr_1.2fr_1fr_auto] lg:items-center lg:gap-3 lg:px-[18px]">
                <div className="min-w-0">
                  <Link href={`/painel/campanhas/${c.id}`} className="block truncate font-semibold hover:underline">
                    {c.name}
                  </Link>
                  <div className="truncate text-xs text-muted">
                    {KIND_LABEL[c.kind]} · <span className="font-mono">{c.template_name}</span> · criada {relativeTime(c.created_at)}
                  </div>
                </div>
                <div className="min-w-0 text-xs text-ink-2">
                  {bot?.name ?? "?"}
                  {showClient && bot?.client_id ? (
                    <Link href={`/painel/clientes/${bot.client_id}?tab=campanhas`} className="block text-muted hover:underline">
                      {bot.client_name}
                    </Link>
                  ) : (
                    showClient && <span className="block text-muted">{bot?.client_name ?? ""}</span>
                  )}
                </div>
                <div className="flex flex-col items-start gap-1">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_TONE[c.status] ?? "bg-ground text-muted"}`}>{CAMPAIGN_STATUS_LABEL[c.status]}</span>
                  {c.status === "scheduled" && c.scheduled_at && <span className="text-xs text-muted">para {formatInZone(c.scheduled_at, tz)}</span>}
                  {c.status === "paused" && c.pause_reason && <span className="text-xs text-amber-ink">{c.pause_reason}</span>}
                </div>
                <div className="text-xs tabular text-ink-2">
                  {delivered.toLocaleString("pt-BR")} entregues · {read.toLocaleString("pt-BR")} lidas
                  <span className="block text-muted">de {(c.estimated_contacts ?? 0).toLocaleString("pt-BR")} no público</span>
                </div>
                <div className="lg:justify-self-end">
                  <CampaignActions id={c.id} name={c.name} status={c.status} />
                </div>
              </div>
            );
          })
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma campanha ainda.</p>
        )}
      </div>
    </>
  );
}
