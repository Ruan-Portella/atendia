import { redirect } from "next/navigation";
import { businessMode } from "@/lib/business-mode";
import Link from "next/link";
import { ChevronDown, Flame, Globe, Plus } from "lucide-react";
import { requirePermission } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { DemoGenerator } from "@/components/demo-generator";
import { CopyButton } from "@/components/copy-button";
import { cn, relativeTime } from "@/lib/utils";
import { agencyBaseUrl } from "@/lib/domain";
import { BotRowActions } from "@/components/bot-row-actions";
import { DialogButton } from "@/components/ui/setting-row";
import { HowItWorks, StatusPill } from "@/components/ui/form-section";
import { deleteBot } from "@/app/painel/actions";
import { DEMOS_PER_MONTH, DEMOS_PER_MONTH_FREE, DEMO_ANSWERS, DEMO_DAYS } from "@/lib/plans";
import { monthBoundsBR } from "@/lib/billing";
import { FREE_LINKED_DEMO, freeLinked } from "@/lib/person-signals";

const dayBR = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

type DemoRow = { id: string; client_name: string; client_site: string | null; demo_slug: string; demo_views: number; status: string; created_at: string; demo_expires_at: string | null; demo_answers_used: number | null };

/** A situação da demo: no ar (até quando e quantas respostas), terminou ou deu erro ao ler o site. */
// a hora de agora fica no padrão do parâmetro (fora da renderização)
function demoState(d: DemoRow, now = Date.now()): { tone: "ok" | "muted" | "danger"; label: string; ended: boolean } {
  if (d.status === "error") return { tone: "danger", label: "Erro ao ler o site", ended: false };
  if (d.demo_expires_at && Date.parse(d.demo_expires_at) <= now) return { tone: "muted", label: `Terminou em ${dayBR(d.demo_expires_at)}`, ended: true };
  if (Number(d.demo_answers_used ?? 0) >= DEMO_ANSWERS) return { tone: "muted", label: `Usou as ${DEMO_ANSWERS} respostas`, ended: true };
  return { tone: "ok", label: `No ar${d.demo_expires_at ? ` até ${dayBR(d.demo_expires_at)}` : ""} · ${Number(d.demo_answers_used ?? 0)} de ${DEMO_ANSWERS} respostas`, ended: false };
}

export const metadata = { title: "Demos" };

/**
 * Demos para prospects: cole o site de um prospect e mande o link. Redesenho, etapa 5: quantas do mês
 * numa barra, a "Nova demo" num modal, cada demo numa linha com a situação em pílula, o "quente", o
 * Mandar no WhatsApp e o Copiar link, e as terminadas fechadas embaixo.
 */
export default async function DemosPage() {
  const { agency } = await requirePermission("config");
  // as demos são ferramenta de venda da agência: no perfil do negócio, não aparecem (23/10/2026)
  if (await businessMode(await createClient(), agency)) redirect("/painel");
  const monthLimit = agency.billing_status === "none" ? DEMOS_PER_MONTH_FREE : DEMOS_PER_MONTH;
  const usedThisMonth = agency.demo_month === monthBoundsBR().firstDay ? agency.demo_month_count : 0;
  const supabase = await createClient();
  const { data } = await supabase.from("bots").select("id, client_name, client_site, demo_slug, demo_views, status, created_at, demo_expires_at, demo_answers_used").eq("agency_id", agency.id).eq("is_demo", true).order("created_at", { ascending: false });
  const demos = (data ?? []) as DemoRow[];
  const rows = demos.map((d) => ({ d, state: demoState(d) }));
  const live = rows.filter((r) => !r.state.ended);
  const ended = rows.filter((r) => r.state.ended);
  const full = usedThisMonth >= monthLimit;

  const row = ({ d, state }: (typeof rows)[number]) => {
    const url = `${agencyBaseUrl(agency)}/demo/${d.demo_slug}`;
    const whatsapp = `https://wa.me/?text=${encodeURIComponent(`Olá! Montei um assistente de IA para o site de ${d.client_name}. Testa aqui: ${url}`)}`;
    return (
      <li key={d.id} className={cn("flex flex-wrap items-center gap-3 px-4 py-3.5", state.ended && "opacity-70")}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">
          <Globe size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/painel/bots/${d.id}`} className="truncate text-[15px] font-medium text-ink hover:underline">
              {d.client_name}
            </Link>
            <StatusPill tone={state.tone}>{state.label}</StatusPill>
            {d.demo_views > 3 && !state.ended && (
              <span title="Aberta mais de 3 vezes: o prospect está olhando" className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2 py-0.5 text-[11.5px] font-medium text-amber-ink">
                <Flame size={11} /> quente
              </span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted">
            {d.client_site?.replace(/^https?:\/\//, "")} · gerada {relativeTime(d.created_at)} · aberta {d.demo_views} {d.demo_views === 1 ? "vez" : "vezes"}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {!state.ended && d.status !== "error" && (
            <>
              <CopyButton text={url} label="Copiar link" className="btn-ghost py-1.5 text-xs" />
              <a href={whatsapp} target="_blank" rel="noopener" className="btn-primary py-1.5 text-xs">
                Mandar no WhatsApp
              </a>
            </>
          )}
          <BotRowActions bot={{ id: d.id, name: "Demo", client_name: d.client_name, is_demo: true, status: d.status }} demoUrl={url} embedSnippet={null} whatsappUrl={null} onDelete={deleteBot.bind(null, d.id)} />
        </span>
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1 className="text-2xl font-normal sm:text-[28px]">Demos para prospects</h1>
          <p className="text-sm text-muted">Cole o site de um prospect e, em um minuto, tem um link para mandar no WhatsApp dele.</p>
          <HowItWorks label="Como funcionam as demos">
            <p>
              A demo lê até 40 páginas do site e monta um assistente com a sua marca. Cada uma vale {DEMO_DAYS} dias e responde até {DEMO_ANSWERS} vezes; depois, o link mostra que terminou. Aberta mais de 3 vezes, ela ganha a etiqueta &ldquo;quente&rdquo;: o prospect está
              olhando.
            </p>
            <p>
              Por mês, {DEMOS_PER_MONTH_FREE} demos na conta grátis e {DEMOS_PER_MONTH} com assinatura. Fechou negócio? Abra a demo e transforme num cliente, ou crie o chatbot do zero.
            </p>
          </HowItWorks>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <DialogButton label="Nova demo" icon={<Plus size={15} />} className="btn-primary" title="Nova demo" description={`Cole o site do prospect. A demo vale ${DEMO_DAYS} dias e responde até ${DEMO_ANSWERS} vezes.`} footer="close">
            {full ? <p className="rounded-[12px] bg-amber-soft px-3 py-2 text-sm text-amber-ink">As {monthLimit} demos deste mês já foram usadas. No dia 1º, o contador volta a zero.</p> : <DemoGenerator inPanel />}
          </DialogButton>
          <span className="flex items-center gap-2 text-xs text-muted">
            <span className="tabular">
              {usedThisMonth} de {monthLimit} no mês
            </span>
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-line-2" aria-hidden>
              <span className={cn("block h-full rounded-full", full ? "bg-amber" : "bg-brand")} style={{ width: `${Math.min(100, Math.round((usedThisMonth / Math.max(1, monthLimit)) * 100))}%` }} />
            </span>
          </span>
        </div>
      </div>
      {agency.billing_status === "none" && (
        <p className="text-xs text-muted">
          Na conta grátis, {DEMOS_PER_MONTH_FREE} demos por mês; com assinatura, até {DEMOS_PER_MONTH}.{" "}
          <Link href="/painel/cobranca" className="font-medium text-brand hover:underline">
            Assinar
          </Link>
        </p>
      )}
      {freeLinked(agency) && <p className="card px-4 py-3 text-sm text-ink-2">{FREE_LINKED_DEMO}</p>}

      {demos.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-5 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-[12px] bg-raised text-ink-2">
            <Globe size={20} />
          </span>
          <span className="text-[15px] font-medium text-ink">Nenhuma demo ainda</span>
          <span className="max-w-[420px] text-sm text-muted">Cole o site de um prospect em &ldquo;Nova demo&rdquo;. A demo aparece aqui, com o link para mandar no WhatsApp dele.</span>
        </div>
      ) : (
        <>
          {live.length > 0 ? <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden">{live.map(row)}</ul> : <p className="card px-5 py-6 text-center text-sm text-muted">Nenhuma demo no ar agora.</p>}
          {ended.length > 0 && (
            <details className="group/end">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
                Terminadas ({ended.length})
                <ChevronDown size={14} className="transition-transform duration-[220ms] group-open/end:rotate-180" />
              </summary>
              <ul className="card mt-2 flex flex-col divide-y divide-line-2 overflow-hidden">{ended.map(row)}</ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
