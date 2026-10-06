import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { planSnapshot, type PlanItemKind } from "@/lib/plan-limits";
import { ROLE_LABELS } from "@/lib/team";
import { relativeTime } from "@/lib/utils";
import { BillingTabs } from "@/components/billing-tabs";
import { PlanPausedBadge } from "@/components/plan-paused-badge";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { setPlanItemPaused } from "../../actions";

export const metadata = { title: "Limites do plano" };

interface Row {
  id: string;
  title: string;
  detail: string;
  paused: boolean;
  /** Sem botão (o dono). */
  fixed?: string;
}

/**
 * Cobrança → Limites do plano (leva B1', parte 4b): depois de um downgrade, o que passou do limite
 * fica pausado (nada é apagado). Aqui o dono troca o que fica ativo: pausar libera a vaga, ativar
 * só com vaga.
 */
export default async function LimitesPage() {
  const { agency } = await requirePermission("billing");
  const s = await planSnapshot(createAdminClient(), agency.id);
  if (!s) notFound();
  const host = (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  };
  const bots: Row[] = s.bots.map((b) => ({
    id: b.id,
    title: b.name,
    detail: [b.client_name, b.last_activity ? `última conversa ${relativeTime(b.last_activity)}` : "sem conversas ainda"].filter(Boolean).join(" · "),
    paused: Boolean(b.paused_by_plan_at),
  }));
  const members: Row[] = s.members.map((m) => ({
    id: m.id,
    title: m.display_name ?? m.email,
    detail: [m.display_name ? m.email : null, ROLE_LABELS[m.role], m.accepted_at ? null : "convite pendente"].filter(Boolean).join(" · "),
    paused: Boolean(m.paused_by_plan_at),
    fixed: m.role === "owner" ? "Dono" : undefined,
  }));
  const webhooks: Row[] = s.webhooks.map((w) => ({ id: w.id, title: w.name, detail: `${host(w.url)}${w.active ? "" : " · desativado por falhas"}`, paused: Boolean(w.paused_by_plan_at) }));
  const pausedTotal = [...bots, ...members, ...webhooks].filter((r) => r.paused).length + s.actions.pausedByPlan;

  return (
    <div className="max-w-[900px]">
      <h1 className="text-2xl font-bold sm:text-[28px]">Cobrança</h1>
      <BillingTabs active="/painel/cobranca/limites" />
      <p className="mt-5 text-sm text-muted">
        Plano <strong className="text-ink">{s.planName}</strong>. Quando a conta muda para um plano menor, o que passa do limite fica pausado, sem apagar nada. Aqui você escolhe o que fica
        ativo: pause um item para liberar a vaga e ative outro no lugar. Subindo de plano, o que estava pausado volta sozinho.
      </p>
      {s.planId === "cancelado" && <p className="mt-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">A assinatura está cancelada. Assine um plano na aba Plano para escolher o que fica ativo.</p>}
      {pausedTotal > 0 && s.planId !== "cancelado" && (
        <p className="mt-4 rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
          {pausedTotal === 1 ? "1 item está pausado" : `${pausedTotal} itens estão pausados`} pelo plano {s.planName}.
        </p>
      )}

      <Section
        kind="bot"
        title="Chatbots"
        rows={bots}
        limit={s.limits.bots}
        note="Chatbot pausado fica em modo só humano: a IA não responde, as mensagens ficam em Conversas para a sua equipe e, no site, aparece o formulário de contato."
        empty="Nenhum chatbot ainda."
        locked={s.planId === "cancelado"}
      />
      <Section
        kind="member"
        title="Equipe"
        rows={members}
        limit={s.limits.members}
        note="Contam o dono e os convites pendentes. Quem está pausado não entra no painel até voltar; o dono nunca é pausado."
        empty="Só você na equipe."
        locked={s.planId === "cancelado"}
      />
      {(webhooks.length > 0 || s.limits.integrations) && (
        <Section
          kind="webhook"
          title="Webhooks"
          rows={webhooks}
          limit={s.limits.webhooks}
          note={s.limits.integrations ? "Webhook pausado não recebe eventos nem acumula entregas." : `O plano ${s.planName} não tem Integrações: os webhooks voltam quando a conta mudar para o Agência ou o Escala.`}
          empty="Nenhum webhook."
          locked={s.planId === "cancelado" || !s.limits.integrations}
        />
      )}
      {s.actions.pausedByPlan > 0 && (
        <section className="card mt-6 p-5 text-sm">
          <h2 className="font-semibold">Ações dos chatbots</h2>
          <p className="mt-1 text-ink-2">
            {s.actions.pausedByPlan === 1 ? "1 ação está pausada" : `${s.actions.pausedByPlan} ações estão pausadas`}: o plano {s.planName} não tem Integrações. Elas voltam sozinhas quando a conta mudar
            para o Agência ou o Escala.
          </p>
        </section>
      )}
    </div>
  );
}

function Section({ kind, title, rows, limit, note, empty, locked }: { kind: PlanItemKind; title: string; rows: Row[]; limit: number; note: string; empty: string; locked: boolean }) {
  const active = rows.filter((r) => !r.paused).length;
  const room = active < limit;
  return (
    <section className="card mt-6 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className={active > limit ? "text-sm font-semibold text-danger" : "text-sm text-muted"}>
          {active} de {limit} ativos
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{note}</p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.title}</div>
                <div className="truncate text-xs text-muted">{r.detail}</div>
              </div>
              {r.paused ? <PlanPausedBadge /> : <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">Ativo</span>}
              <div className="w-full sm:w-auto">
                {r.fixed ? (
                  <span className="text-xs text-muted">{r.fixed}</span>
                ) : locked ? null : r.paused ? (
                  <ActionForm action={setPlanItemPaused.bind(null, kind, r.id, false)} success="Ativado.">
                    <SubmitButton pendingLabel="Ativando…" className="btn-primary w-full sm:w-auto" disabled={!room} title={room ? undefined : "Sem vaga no plano: pause outro antes"}>
                      Ativar
                    </SubmitButton>
                  </ActionForm>
                ) : (
                  <ActionForm action={setPlanItemPaused.bind(null, kind, r.id, true)} success="Pausado.">
                    <SubmitButton pendingLabel="Pausando…" className="btn-ghost w-full sm:w-auto">
                      Pausar
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {!locked && !room && rows.some((r) => r.paused) && <p className="mt-3 text-xs text-muted">Para ativar um item pausado, pause outro antes.</p>}
    </section>
  );
}
