import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { CAMPAIGN_STATUS_LABEL, CATEGORY_REVIEW_HINT, OPT_OUT_LABEL, SEND_ERROR_LABEL, SEND_STATUS_LABEL, campaignDetail, campaignReport, costText, reportNumbers, type SendStatus } from "@/lib/campaigns";
import { formatInZone } from "@/lib/timezone";
import { Kpi } from "@/components/kpi";
import { CampaignActions } from "@/components/campaign-actions";

export const metadata = { title: "Campanha" };

const KIND_LABEL = { marketing: "Marketing", utility_reminder: "Lembrete" } as const;
const STATUS_TONE: Record<string, string> = { sending: "bg-brand-soft text-brand", scheduled: "bg-brand-soft text-brand", paused: "bg-amber-soft text-amber-ink", finished: "bg-ground text-ink-2", canceled: "bg-ground text-muted", draft: "bg-ground text-muted" };
const SKIPPED: SendStatus[] = ["skipped_no_consent", "skipped_suppressed", "skipped_no_age", "skipped_contact_deleted"];
const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}% das enviadas` : "—");

/**
 * Relatório da campanha (leva B3, parte 4b): enviadas, entregues, lidas, respostas, erros e
 * descadastros, quem ficou de fora na hora do envio e por quê. Nos chatbots do escopo (RLS).
 */
export default async function CampaignReportPage({ params }: PageProps<"/painel/campanhas/[id]">) {
  const [{ id }] = await Promise.all([params, requirePermission("config")]);
  const supabase = await createClient();
  const { data: bots } = await supabase.from("bots").select("id, name, client_name, client_id").eq("is_demo", false);
  const botById = new Map((bots ?? []).map((b) => [b.id as string, b]));
  const admin = createAdminClient();
  const c = await campaignDetail(admin, id, [...botById.keys()]);
  if (!c) notFound();
  const bot = botById.get(c.bot_id);
  const [report, { data: client }] = await Promise.all([
    campaignReport(admin, c.id),
    bot?.client_id ? admin.from("clients").select("timezone").eq("id", bot.client_id as string).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const tz = (client?.timezone as string | null) ?? null;
  const n = reportNumbers(report);
  const skipped = SKIPPED.map((s) => [s, report.status[s] ?? 0] as const).filter(([, count]) => count > 0);
  const errors = Object.entries(report.errors).sort((a, b) => b[1] - a[1]);
  const optOuts = Object.entries(report.optOut).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex max-w-[960px] flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href={bot?.client_id ? `/painel/clientes/${bot.client_id as string}?tab=campanhas` : "/painel/campanhas"} className="text-sm font-semibold text-muted">
          ← {bot?.client_id ? `Campanhas de ${bot.client_name as string}` : "Campanhas"}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold sm:text-[28px]">{c.name}</h1>
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_TONE[c.status] ?? "bg-ground text-muted"}`}>{CAMPAIGN_STATUS_LABEL[c.status]}</span>
        </div>
        <p className="text-sm text-muted">
          {KIND_LABEL[c.kind]} · {(bot?.name as string | undefined) ?? "?"} ({(bot?.client_name as string | undefined) ?? ""}) · modelo <span className="font-mono">{c.template_name}</span>
          {c.regulated ? " · só para 18+" : ""} · criada em {formatInZone(c.created_at, tz)}
          {c.created_by ? ` por ${c.created_by.replace(/^suporte:/, "equipe BoaVoz ")}` : ""}
          {c.status === "scheduled" && c.scheduled_at ? ` · agendada para ${formatInZone(c.scheduled_at, tz)} (horário do cliente)` : ""}
          {c.finished_at ? ` · ${c.status === "canceled" ? "cancelada" : "terminou"} em ${formatInZone(c.finished_at, tz)}` : ""}
        </p>
        <CampaignActions id={c.id} name={c.name} status={c.status} />
      </div>

      {c.status === "paused" && c.pause_reason && (
        <div className="rounded-xl bg-amber-soft p-4 text-sm text-amber-ink">
          <p className="font-semibold">Pausada: {c.pause_reason}.</p>
          {/marketing/.test(c.pause_reason) && <p className="mt-1">{CATEGORY_REVIEW_HINT}</p>}
          <p className="mt-1">O que já saiu continua valendo; ao retomar, os envios que faltam passam pelas mesmas conferências.</p>
        </div>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Enviadas" value={n.sent.toLocaleString("pt-BR")} sub={`de ${(c.estimated_contacts ?? 0).toLocaleString("pt-BR")} no público${n.pending ? ` · ${n.pending.toLocaleString("pt-BR")} na fila` : ""}`} />
        <Kpi label="Entregues" value={n.delivered.toLocaleString("pt-BR")} sub={pct(n.delivered, n.sent)} />
        <Kpi label="Lidas" value={n.read.toLocaleString("pt-BR")} sub={pct(n.read, n.sent)} />
        <Kpi label="Respostas" value={n.replied.toLocaleString("pt-BR")} sub={n.sent ? `${pct(n.replied, n.sent)} · a conversa segue com o assistente` : "—"} />
        <Kpi label="Descadastros" value={n.optOuts.toLocaleString("pt-BR")} sub={n.sent ? pct(n.optOuts, n.sent) : "—"} />
        <Kpi label="Com erro" value={n.failed.toLocaleString("pt-BR")} sub={c.estimated_cost_cents != null ? `custo estimado ${costText(c.estimated_cost_cents / 100)}` : "—"} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="card flex flex-col gap-2 p-5 text-sm">
          <h2 className="font-semibold">Ficaram de fora na hora do envio</h2>
          {skipped.length ? (
            <ul className="flex flex-col gap-1 text-ink-2">
              {skipped.map(([s, count]) => (
                <li key={s}>
                  <strong className="tabular text-ink">{count.toLocaleString("pt-BR")}</strong> {SEND_STATUS_LABEL[s]}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Ninguém: todo o público passou pelas conferências.</p>
          )}
          <p className="text-xs text-muted">Cada envio confere de novo o aceite, o SAIR e o 18+: quem mudou depois de montar o público fica de fora.</p>
          {n.uncertain > 0 && (
            <p className="text-xs text-muted">
              {n.uncertain.toLocaleString("pt-BR")} sem resposta da Meta no envio: não reenviamos (para ninguém receber em dobro), e o status chega depois.
            </p>
          )}
        </section>

        <section className="card flex flex-col gap-2 p-5 text-sm">
          <h2 className="font-semibold">Descadastros</h2>
          {optOuts.length ? (
            <ul className="flex flex-col gap-1 text-ink-2">
              {optOuts.map(([src, count]) => (
                <li key={src}>
                  <strong className="tabular text-ink">{count.toLocaleString("pt-BR")}</strong> {OPT_OUT_LABEL[src] ?? src}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Nenhum até agora.</p>
          )}
          <p className="text-xs text-muted">Contam os pedidos de saída nos 7 dias depois do envio. Quem sai não recebe mais promoções deste número.</p>
        </section>
      </div>

      {errors.length > 0 && (
        <section className="card flex flex-col gap-2 p-5 text-sm">
          <h2 className="font-semibold">Erros da Meta</h2>
          <ul className="flex flex-col gap-1 text-ink-2">
            {errors.map(([code, count]) => (
              <li key={code}>
                <strong className="tabular text-ink">{count.toLocaleString("pt-BR")}</strong> {SEND_ERROR_LABEL[code] ?? `erro ${code}`}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
