import Link from "next/link";
import { Kpi } from "@/components/kpi";
import { requireAdmin } from "@/lib/platform-admin";
import { botRefs, getBaseGateStats, getQuality, type BotRef } from "@/lib/backoffice-ops";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { classifyBaseNow } from "./actions";
import { RANGE_LABEL, isRangeKey, rangeFor, type RangeKey } from "@/lib/backoffice";
import { num } from "@/lib/plans";
import { cn, relativeTime } from "@/lib/utils";

export const metadata = { title: "Qualidade da IA" };
// o botão "Classificar agora" roda até ~4 minutos (server action desta página)
export const maxDuration = 300;

const GATE_LABEL: Record<string, string> = {
  "entrada:proibido": "Entrada · item proibido (texto fixo)",
  "entrada:proibido_misto": "Entrada · proibido junto com outro assunto",
  "entrada:pede_18": "Entrada · pergunta de 18+",
  "entrada:regulamentado": "Entrada · bebida/remédio (18+ ok)",
  "entrada:nao_18": "Entrada · disse que não tem 18",
  "saida:proibido": "Saída · item proibido tirado da resposta",
  "saida:pede_18": "Saída · item 18+ tirado (botão Ver opções 18+)",
  "saida:nao_18": "Saída · item 18+ tirado (não tem 18)",
  "saida:pagamento": "Saída · pagamento tirado da resposta",
};
const RANGES: RangeKey[] = ["7d", "30d", "mes"];

const botLabel = (bots: Map<string, BotRef>, id: string) => {
  const b = bots.get(id);
  return b ? `${b.name} · ${b.client}${b.agency ? ` (${b.agency})` : ""}` : "bot apagado";
};

function Counts({ title, rows, label = (k: string) => k, empty }: { title: string; rows?: Array<{ key: string; n: number }>; label?: (k: string) => string; empty: string }) {
  return (
    <section className="card flex flex-col gap-2 p-5">
      <h2 className="text-base font-bold">{title}</h2>
      {rows?.length ? (
        <table className="w-full text-sm">
          <tbody>{rows.slice(0, 10).map((r) => <tr key={r.key} className="border-t border-line-2 first:border-0"><td className="py-1.5 pr-2">{label(r.key)}</td><td className="py-1.5 text-right tabular">{num(r.n)}</td></tr>)}</tbody>
        </table>
      ) : (
        <p className="text-sm text-muted">{empty}</p>
      )}
    </section>
  );
}

export default async function AdminQuality({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/qualidade");
  const sp = await searchParams;
  const key: RangeKey = typeof sp.periodo === "string" && isRangeKey(sp.periodo) && RANGES.includes(sp.periodo) ? sp.periodo : "30d";
  const range = rangeFor(key);
  const [q, base] = await Promise.all([getQuality(range.since), getBaseGateStats()]);
  const baseBots = await botRefs(base.bots.map((b) => b.bot));
  const g = q.grouped;
  const total = (m: string) => (g[m] ?? []).reduce((t, r) => t + r.n, 0);
  const handoff = Object.fromEntries((g.atendente ?? []).map((r) => [r.key, r.n]));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold">Qualidade da IA</h1>
          <p className="text-sm text-muted">O que o assistente não soube, recusou ou barrou, e os pedidos urgentes. Perguntas sem resposta: as pendentes de sempre; o resto, no período.</p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-sm">
          {RANGES.map((k) => <Link key={k} href={`/admin/qualidade?periodo=${k}`} className={cn("rounded-full border px-3 py-1", k === key ? "border-ink bg-ink text-ground" : "border-line bg-panel")}>{RANGE_LABEL[k]}</Link>)}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Sem resposta (pendentes)" value={num(total("sem_resposta_bot"))} sub={`em ${(g.sem_resposta_bot ?? []).length} bots`} />
        <Kpi label="Recusas de escopo" value={num(total("recusa_nivel"))} sub={(g.recusa_nivel ?? []).map((r) => `${r.n} ${r.key}`).join(" · ") || "nenhuma"} />
        <Kpi label="Portão (bloqueios)" value={num(total("portao"))} sub={`${num((g.portao ?? []).filter((r) => r.key.startsWith("saida")).reduce((t, r) => t + r.n, 0))} na saída`} />
        <Kpi label="Pedidos de atendente" value={num(handoff.pedidos ?? 0)} sub={`${num(handoff.urgentes ?? 0)} urgentes (risco à vida)`} />
      </section>

      {q.urgent.length > 0 && (
        <section className="card flex flex-col gap-2 border-danger/40 p-5">
          <h2 className="text-base font-bold text-danger">Pedidos urgentes (risco à vida)</h2>
          <ul className="flex flex-col divide-y divide-line-2 text-sm">
            {q.urgent.map((c) => (
              <li key={c.id as string} className="flex flex-wrap justify-between gap-2 py-2">
                <span>{botLabel(q.bots, c.bot_id as string)} · {c.channel as string}</span>
                <span className="text-xs text-muted">{relativeTime(c.handoff_urgent_at as string)} · {c.handled_at ? "atendido" : <strong className="text-danger">sem atendimento</strong>}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card flex flex-col gap-3 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">Classificação da base (portão)</h2>
            <p className="text-sm text-muted">Cada trecho das fontes passa uma vez pela IA, que marca as frases que oferecem bebida, remédio (conferido com a lista da Anvisa) ou item proibido. Sem classificação, o portão usa só o dicionário. Roda sozinha depois de cada fonte nova e na rotina diária (que não roda na dev).</p>
          </div>
          <ActionForm action={classifyBaseNow} className="shrink-0">
            <SubmitButton className="btn-ghost" pendingLabel="Classificando… (até 4 min)" disabled={!base.pending}>Classificar agora</SubmitButton>
          </ActionForm>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
          <span><strong className="tabular">{num(base.total - base.pending)}</strong> de {num(base.total)} trechos classificados</span>
          <span><strong className="tabular">{num(base.restricted)}</strong> com item restrito</span>
          {base.pending > 0 && <span className="text-amber-ink"><strong className="tabular">{num(base.pending)}</strong> pendentes</span>}
          <span className="text-xs text-muted">versão {base.version}</span>
        </div>
        {base.bots.length > 0 && (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-semibold">Bot</th><th className="py-1.5 text-right font-semibold">Com item restrito</th><th className="py-1.5 text-right font-semibold">Pendentes</th><th className="py-1.5 text-right font-semibold">Trechos</th></tr></thead>
            <tbody>
              {base.bots.slice(0, 10).map((b) => (
                <tr key={b.bot} className="border-t border-line-2"><td className="py-1.5">{botLabel(baseBots, b.bot)}</td><td className="py-1.5 text-right tabular">{num(b.restricted)}</td><td className="py-1.5 text-right tabular">{num(b.pending)}</td><td className="py-1.5 text-right tabular">{num(b.total)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Counts title="Bots com mais perguntas sem resposta" rows={g.sem_resposta_bot} label={(k) => botLabel(q.bots, k)} empty="Nenhuma pendente." />
        <Counts title="Bots que mais recusam (escopo)" rows={g.recusa_bot} label={(k) => botLabel(q.bots, k)} empty="Nenhuma recusa no período." />
        <Counts title="Portão por etapa e decisão" rows={g.portao} label={(k) => GATE_LABEL[k] ?? k} empty="Nada barrado no período." />
        <Counts title="Portão por categoria" rows={g.portao_categoria} empty="Nada barrado no período." />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card flex flex-col gap-2 p-5">
          <h2 className="text-base font-bold">Últimas perguntas sem resposta</h2>
          <ul className="flex flex-col divide-y divide-line-2 text-sm">
            {q.unanswered.map((u) => (
              <li key={u.id as string} className="flex flex-col gap-0.5 py-2">
                <span>{u.hidden ? <span className="text-muted">(texto oculto: a agência não liberou o suporte)</span> : u.question}</span>
                <span className="text-xs text-muted">{botLabel(q.bots, u.bot_id as string)} · {relativeTime(u.created_at as string)}</span>
              </li>
            ))}
            {!q.unanswered.length && <li className="py-2 text-muted">Nenhuma pendente.</li>}
          </ul>
        </section>
        <section className="card flex flex-col gap-2 p-5">
          <h2 className="text-base font-bold">Últimas recusas de escopo</h2>
          <ul className="flex flex-col divide-y divide-line-2 text-sm">
            {q.refusals.map((r) => (
              <li key={r.id as number} className="flex flex-col gap-0.5 py-2">
                <span>{r.hidden ? <span className="text-muted">(texto oculto: a agência não liberou o suporte)</span> : (r.request ?? <span className="text-muted">(sem resumo)</span>)}</span>
                <span className="text-xs text-muted">{r.level as string} · {botLabel(q.bots, r.bot_id as string)} · {relativeTime(r.created_at as string)}</span>
              </li>
            ))}
            {!q.refusals.length && <li className="py-2 text-muted">Nenhuma no período.</li>}
          </ul>
        </section>
      </div>
    </>
  );
}
