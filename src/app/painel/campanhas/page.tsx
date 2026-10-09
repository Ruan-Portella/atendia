import Link from "next/link";
import { requirePermission } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { campaignsInPlan } from "@/lib/plan-limits";
import { CAMPAIGN_STATUS_LABEL, listCampaigns } from "@/lib/campaigns";
import { formatInZone } from "@/lib/timezone";
import { relativeTime } from "@/lib/utils";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { changeCampaign } from "./actions";

export const metadata = { title: "Campanhas" };

const KIND_LABEL = { marketing: "Marketing", utility_reminder: "Lembrete" } as const;
const STATUS_TONE: Record<string, string> = { sending: "bg-brand-soft text-brand", scheduled: "bg-brand-soft text-brand", paused: "bg-amber-soft text-amber-ink", finished: "bg-ground text-ink-2", canceled: "bg-ground text-muted", draft: "bg-ground text-muted" };

/**
 * Campanhas (leva B3, parte 4a): marketing pelo WhatsApp para quem aceitou novidades. Dono,
 * administrador e editor, nos chatbots do escopo; criar só nos planos pagos.
 */
export default async function CampaignsPage() {
  const { plan, role } = await requirePermission("config");
  const inPlan = campaignsInPlan(plan.id);
  const supabase = await createClient();
  // a RLS limita aos chatbots do escopo de quem está logado
  const { data: bots } = await supabase.from("bots").select("id, name, client_name, client_id").eq("is_demo", false);
  const botById = new Map((bots ?? []).map((b) => [b.id as string, b]));
  const admin = createAdminClient();
  const campaigns = await listCampaigns(admin, [...botById.keys()], 50);
  const clientIds = [...new Set(campaigns.map((c) => botById.get(c.bot_id)?.client_id as string | null).filter((x): x is string => Boolean(x)))];
  const { data: clients } = clientIds.length ? await admin.from("clients").select("id, timezone").in("id", clientIds) : { data: [] };
  const tzOf = new Map((clients ?? []).map((c) => [c.id as string, c.timezone as string]));

  return (
    <div className="flex max-w-[1080px] flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold sm:text-[28px]">Campanhas</h1>
          <p className="text-sm text-muted">Promoções e novidades pelo WhatsApp, só para quem aceitou receber. O BoaVoz confere cada envio e pausa sozinho se a nota do número cair.</p>
        </div>
        {inPlan && (
          <Link href="/painel/campanhas/nova" className="btn-primary">
            Nova campanha
          </Link>
        )}
      </div>

      {!inPlan && (
        <div className="card flex flex-col gap-2 p-5 text-sm">
          <p className="font-semibold">Campanhas fazem parte dos planos pagos (Freelancer, Agência e Escala).</p>
          <p className="text-ink-2">No teste grátis, dá para preparar tudo: ligar a oferta de novidades no WhatsApp do chatbot, importar contatos com o aceite e criar os modelos de marketing.</p>
          {role === "owner" && (
            <Link href="/painel/cobranca" className="btn-ghost self-start">
              Ver planos
            </Link>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        {campaigns.length ? (
          campaigns.map((c) => {
            const bot = botById.get(c.bot_id);
            const tz = tzOf.get((bot?.client_id as string | null) ?? "") ?? null;
            const t = c.totals ?? {};
            const read = t.read ?? 0;
            const delivered = (t.delivered ?? 0) + read;
            const active = c.status === "sending" || c.status === "scheduled";
            return (
              <div key={c.id} className="flex flex-col gap-2 border-b border-line-2 px-4 py-3.5 text-sm last:border-0 lg:grid lg:grid-cols-[2fr_1.4fr_1.2fr_1fr_auto] lg:items-center lg:gap-3 lg:px-[18px]">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{c.name}</div>
                  <div className="truncate text-xs text-muted">
                    {KIND_LABEL[c.kind]} · <span className="font-mono">{c.template_name}</span> · criada {relativeTime(c.created_at)}
                  </div>
                </div>
                <div className="min-w-0 text-xs text-ink-2">
                  {(bot?.name as string | undefined) ?? "?"}
                  <span className="block text-muted">{(bot?.client_name as string | undefined) ?? ""}</span>
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
                <div className="flex flex-wrap gap-3 lg:justify-end">
                  {active && (
                    <ConfirmAction action={changeCampaign.bind(null, c.id, "paused")} title={`Pausar ${c.name}?`} description="O que já saiu continua valendo; o resto espera você retomar." confirmLabel="Pausar" danger={false} className="text-xs font-semibold text-amber-ink hover:underline">
                      Pausar
                    </ConfirmAction>
                  )}
                  {c.status === "paused" && (
                    <ConfirmAction action={changeCampaign.bind(null, c.id, "sending")} title={`Retomar ${c.name}?`} description="Os envios que faltam saem em até um minuto, com as mesmas conferências (aceite, SAIR e 18+)." confirmLabel="Retomar" danger={false} className="text-xs font-semibold text-brand hover:underline">
                      Retomar
                    </ConfirmAction>
                  )}
                  {(active || c.status === "paused") && (
                    <ConfirmAction action={changeCampaign.bind(null, c.id, "canceled")} title={`Cancelar ${c.name}?`} description="O que faltava enviar não sai mais. Não dá para desfazer." confirmLabel="Cancelar campanha" className="text-xs font-semibold text-danger hover:underline">
                      Cancelar
                    </ConfirmAction>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted">Nenhuma campanha ainda.</p>
        )}
      </div>
    </div>
  );
}
