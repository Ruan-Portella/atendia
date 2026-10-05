import Link from "next/link";
import { requireAgency } from "@/lib/agency";
import { auditFilters } from "@/lib/audit-view";
import { RequestsSection } from "./requests-section";
import { AuditSection } from "./audit-section";
import { AccessSection } from "./access-section";
import { SupportSection } from "./support-section";
import { MfaSection } from "./mfa-section";
import { requireAgencyMfa } from "@/lib/agency-mfa";

export const metadata = { title: "Segurança" };

const TABS = [
  ["pedidos", "Pedidos do titular"],
  ["auditoria", "Auditoria"],
  ["acessos", "Acessos"],
  ["suporte", "Acesso do suporte"],
  ["fator", "Segundo fator"],
] as const;
type Tab = (typeof TABS)[number][0];

/** Segurança (leva S): pedidos do titular, auditoria e acessos ao painel. */
export default async function SecurityPage({ searchParams }: PageProps<"/painel/seguranca">) {
  const sp = await searchParams;
  const tab = (TABS.some(([t]) => t === sp.aba) ? sp.aba : "pedidos") as Tab;
  const { agency } = await requireAgency();
  // a Segurança pede o segundo fator (cadastro na hora, na primeira vez)
  await requireAgencyMfa(`/painel/seguranca?aba=${tab}`);
  const page = Math.max(0, Math.min(200, Number(sp.pagina) || 0));

  return (
    <div className="flex max-w-[960px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-[28px]">Segurança</h1>
        <p className="text-sm text-muted">Pedidos de exclusão dos contatos (LGPD), o que foi feito na sua conta, quem acessou o painel e o acesso do suporte BoaVoz.</p>
      </div>
      <nav aria-label="Seções" className="flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none]">
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/painel/seguranca?aba=${key}`} className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm ${tab === key ? "border-brand font-semibold text-brand" : "border-transparent font-medium text-ink-2 hover:text-ink"}`}>
            {label}
          </Link>
        ))}
      </nav>
      {tab === "pedidos" && <RequestsSection />}
      {tab === "auditoria" && <AuditSection agencyId={agency.id} ownerId={agency.owner_id} filters={auditFilters(sp)} page={page} />}
      {tab === "acessos" && <AccessSection agencyId={agency.id} ownerId={agency.owner_id} />}
      {tab === "suporte" && <SupportSection agencyId={agency.id} />}
      {tab === "fator" && <MfaSection />}
    </div>
  );
}
