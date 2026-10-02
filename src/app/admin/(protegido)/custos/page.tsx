import Link from "next/link";
import { Kpi } from "@/components/kpi";
import { DayBars } from "@/components/admin/day-bars";
import { requireAdmin } from "@/lib/platform-admin";
import { FixedCosts } from "@/components/admin/fixed-costs";
import { RANGE_LABEL, fixedMonthlyBrl, getAgencies, getAiCosts, getFixedCosts, getOpenAiCosts, getWhatsAppUsage, isRangeKey, kindLabel, rangeFor, usd, usdBrl, type RangeKey } from "@/lib/backoffice";
import { CATEGORY_LABEL } from "@/lib/whatsapp-usage";
import { brl, num } from "@/lib/plans";
import { cn, currentPeriodBR } from "@/lib/utils";

export const metadata = { title: "Custos" };

const CHANNEL_LABEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site (widget)", painel: "Teste no painel", demo: "Demo", "—": "Sem canal (leitura de fontes)" };

function Breakdown({ title, rows, label = (k: string) => k, total }: { title: string; rows: Array<{ key: string; cost: number; calls?: number }>; label?: (k: string) => string; total: number }) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <h2 className="text-base font-bold">{title}</h2>
      {rows.length ? (
        <table className="w-full text-sm">
          <tbody>
            {rows.slice(0, 12).map((r) => (
              <tr key={r.key} className="border-t border-line-2 first:border-0">
                <td className="py-1.5 pr-2">{label(r.key)}</td>
                <td className="py-1.5 text-right text-xs text-muted tabular">{r.calls !== undefined ? `${num(r.calls)} chamadas` : ""}</td>
                <td className="py-1.5 pl-3 text-right tabular">{usd(r.cost, r.cost < 1 ? 4 : 2)}</td>
                <td className="w-12 py-1.5 pl-2 text-right text-xs text-muted tabular">{total ? Math.round((r.cost / total) * 100) : 0}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-sm text-muted">Nada no período.</p>
      )}
    </section>
  );
}

export default async function AdminCosts({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin("/admin/custos");
  const sp = await searchParams;
  const key: RangeKey = typeof sp.periodo === "string" && isRangeKey(sp.periodo) ? sp.periodo : "mes";
  const range = rangeFor(key);
  // WhatsApp é contado por mês: o do período (mês passado) ou o corrente
  const waPeriod = currentPeriodBR(key === "mes-passado" ? range.since : undefined);
  const [{ summary: s, daily }, openai, agencies, fixed, whatsapp] = await Promise.all([getAiCosts(range.since, range.until), getOpenAiCosts(range.since, range.until), getAgencies(), getFixedCosts(), getWhatsAppUsage(waPeriod)]);
  const agencyName = new Map(agencies.map((a) => [a.id, a.name]));
  const fx = usdBrl();
  const real = openai && !("error" in openai) ? openai : null;

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold">Custos</h1>
          <p className="text-sm text-muted">IA medida pelo sistema (tabela de uso) e, ao lado, o valor real da conta da OpenAI. Dólar a {brl(fx)}.</p>
        </div>
        <div className="flex flex-wrap gap-1.5 text-sm">
          {(Object.keys(RANGE_LABEL) as RangeKey[]).map((k) => (
            <Link key={k} href={`/admin/custos?periodo=${k}`} className={cn("rounded-full border px-3 py-1", k === key ? "border-ink bg-ink text-ground" : "border-line bg-panel")}>{RANGE_LABEL[k]}</Link>
          ))}
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="IA medida no período" value={usd(s.total.cost)} sub={`≈ ${brl(s.total.cost * fx)} · ${num(s.total.calls)} chamadas${s.total.unpriced ? ` · ${s.total.unpriced} sem preço` : ""}`} />
        <Kpi label="Custo por resposta" value={usd(s.answers.perAnswer, 5)} sub={`${num(s.answers.calls)} respostas · ${s.answers.cachePct}% da entrada do cache`} />
        <Kpi label="Tokens por resposta" value={num(s.answers.avgInput)} sub={`de entrada · ${num(s.answers.avgOutput)} de saída`} />
        <Kpi label="Conta da OpenAI" value={real ? usd(real.total) : "—"} sub={real ? `medido ${usd(s.total.cost)} · diferença ${usd(real.total - s.total.cost)}` : openai && "error" in openai ? "erro ao consultar" : "falta OPENAI_ADMIN_KEY"} />
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-bold">Custo de IA por dia (medido)</h2>
          <span className="text-xs text-muted">{range.label}{s.audioMinutes ? ` · ${num(Math.round(s.audioMinutes))} min de áudio` : ""}</span>
        </div>
        <DayBars caption="Custo de IA por dia" days={daily.map((d) => ({ day: d.day, value: d.cost, detail: `${num(d.calls)} chamadas` }))} format={(v) => usd(v, v < 1 ? 4 : 2)} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Breakdown title="Por tipo" rows={s.byKind} label={kindLabel} total={s.total.cost} />
        <Breakdown title="Por modelo" rows={s.byModel} total={s.total.cost} />
        <Breakdown title="Por canal" rows={s.byChannel} label={(k) => CHANNEL_LABEL[k] ?? k} total={s.total.cost} />
        <Breakdown title="Agências que mais gastam" rows={s.byAgency} label={(k) => agencyName.get(k) ?? "agência vitrine (demos)"} total={s.total.cost} />
      </div>

      <FixedCosts costs={fixed} totalBrl={fixedMonthlyBrl(fixed, fx)} />

      <section className="card flex flex-col gap-4 p-5">
        <div>
          <h2 className="text-lg font-bold">WhatsApp (Meta) · {waPeriod}</h2>
          <p className="text-sm text-muted">A Meta cobra no cartão de cada cliente, não da BoaVoz: não entra na margem. Serve para o suporte (quem está gastando com modelos, por exemplo). Estimativa pela tabela de referência (WHATSAPP_PRICES_BRL).</p>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <div className="rounded-lg bg-ground px-4 py-3"><div className="kpi-label">Mensagens enviadas</div><div className="text-xl font-bold tabular">{num(whatsapp.sent)}</div></div>
          <div className="rounded-lg bg-ground px-4 py-3"><div className="kpi-label">Cobradas pela Meta</div><div className="text-xl font-bold tabular">{num(whatsapp.billed)}</div></div>
          <div className="rounded-lg bg-ground px-4 py-3"><div className="kpi-label">Estimativa (clientes)</div><div className="text-xl font-bold tabular">{brl(whatsapp.estimateBrl)}</div>{whatsapp.unpriced.length > 0 && <div className="text-xs text-muted">sem preço: {whatsapp.unpriced.join(", ")}</div>}</div>
        </div>
        {whatsapp.sent > 0 && (
          <div className="grid gap-6 lg:grid-cols-2">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-semibold">Categoria</th><th className="py-1.5 text-right font-semibold">Enviadas</th><th className="py-1.5 text-right font-semibold">Cobradas</th></tr></thead>
              <tbody>{whatsapp.categories.map((c) => <tr key={c.category} className="border-t border-line-2"><td className="py-1.5">{CATEGORY_LABEL[c.category] ?? c.category}</td><td className="py-1.5 text-right tabular">{num(c.sent)}</td><td className="py-1.5 text-right tabular">{num(c.billed)}</td></tr>)}</tbody>
            </table>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-semibold">Agência</th><th className="py-1.5 text-right font-semibold">Enviadas</th><th className="py-1.5 text-right font-semibold">Estimativa</th></tr></thead>
              <tbody>{whatsapp.agencies.slice(0, 10).map((a) => <tr key={a.agency} className="border-t border-line-2"><td className="py-1.5">{agencyName.get(a.agency) ?? "agência vitrine (demos)"}</td><td className="py-1.5 text-right tabular">{num(a.sent)}</td><td className="py-1.5 text-right tabular">{brl(a.estimateBrl)}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-4 p-5">
        <h2 className="text-lg font-bold">Conta da OpenAI (valor real)</h2>
        {!openai && (
          <div className="flex flex-col gap-2 text-sm text-muted">
            <p>Para ver o valor real cobrado pela OpenAI, crie uma chave de admin e coloque na Vercel:</p>
            <ol className="ml-5 list-decimal">
              <li>No painel da OpenAI: Settings → Organization → Admin keys → Create new admin key (só leitura de uso basta).</li>
              <li>Na Vercel, no projeto da dev: Settings → Environment Variables → <code className="rounded bg-ground px-1 text-ink">OPENAI_ADMIN_KEY</code>.</li>
              <li>Faça um novo deploy.</li>
            </ol>
          </div>
        )}
        {openai && "error" in openai && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Não deu para consultar a OpenAI: {openai.error}</p>}
        {real && (
          <>
            <p className="text-sm text-muted">Inclui tudo da organização: produção, dev, avaliações e testes. As avaliações da IA entram no medido como &ldquo;Avaliações da IA&rdquo; (desde 02/10/2026; as de antes não foram registradas). A diferença que sobra é o que roda fora do sistema (testes locais, outros projetos na mesma conta) e os arredondamentos da OpenAI.</p>
            <DayBars caption="Custo real por dia" days={real.daily.map((d) => ({ day: d.day, value: d.cost }))} format={(v) => usd(v, v < 1 ? 4 : 2)} />
            <div className="grid gap-6 lg:grid-cols-2">
              <Breakdown title="Por projeto da OpenAI" rows={real.byProject} total={real.total} />
              <Breakdown title="Por item (modelo, entrada/saída)" rows={real.byItem} total={real.total} />
            </div>
          </>
        )}
      </section>
    </>
  );
}
