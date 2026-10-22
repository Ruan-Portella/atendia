import Link from "next/link";
import { requirePermission } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { auditFilters, auditPeople } from "@/lib/audit-view";
import { RequestsSection } from "./requests-section";
import { AuditSection } from "./audit-section";
import { AccessSection } from "./access-section";
import { SupportSection } from "./support-section";
import { MfaSection } from "./mfa-section";
import { requireAgencyMfa } from "@/lib/agency-mfa";
import { AccountSection } from "./account-section";
import { cn } from "@/lib/utils";

export const metadata = { title: "Segurança" };

const TABS = [
  ["pedidos", "Pedidos do titular", "Os contatos que pediram para apagar os dados (LGPD)."],
  ["auditoria", "Auditoria", "Quem fez o quê na sua conta."],
  ["acessos", "Acessos", "Quem entrou no painel e na área do cliente, com o IP."],
  ["suporte", "Acesso do suporte", "Quando a equipe do BoaVoz pode ler as conversas da sua conta."],
  ["fator", "Segundo fator", "O app autenticador e onde ele é pedido."],
  // só o dono vê (Lançamento, parte 1)
  ["conta", "Excluir a conta", "Apagar a conta e tudo o que ela tem."],
] as const;
type Tab = (typeof TABS)[number][0];

/**
 * Segurança (leva S): pedidos do titular, auditoria e acessos ao painel. Redesenho, etapa 5: as abas
 * no molde das outras telas, com quantos pedidos esperam, e cada aba em linhas e modais.
 */
export default async function SecurityPage({ searchParams }: PageProps<"/painel/seguranca">) {
  const sp = await searchParams;
  // só dono e administrador (equipe, leva B1'); "Excluir a conta", só o dono
  const { agency, userId, role } = await requirePermission("security");
  const tabs = TABS.filter(([t]) => t !== "conta" || role === "owner");
  const tab = (tabs.some(([t]) => t === sp.aba) ? sp.aba : "pedidos") as Tab;
  // a Segurança pede o segundo fator (cadastro na hora, na primeira vez)
  await requireAgencyMfa(`/painel/seguranca?aba=${tab}`);
  const page = Math.max(0, Math.min(200, Number(sp.pagina) || 0));
  const { count: waiting } = await (await createClient()).from("data_subject_requests").select("id", { count: "exact", head: true }).eq("status", "aguardando");

  return (
    <div className="flex max-w-[960px] flex-col gap-5">
      <div className="flex flex-col gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-normal sm:text-[28px]">Segurança e auditoria</h1>
          <p className="text-sm text-muted">{tabs.find(([t]) => t === tab)?.[2]}</p>
        </div>
        <nav aria-label="Segurança" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
          <span className="flex shrink-0 gap-1 rounded-[14px] bg-panel p-1 shadow-[inset_0_0_0_1px_var(--color-line)]">
            {tabs.map(([key, label]) => (
              <Link
                key={key}
                href={`/painel/seguranca?aba=${key}`}
                aria-current={tab === key ? "page" : undefined}
                className={cn("flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[10px] px-3.5 py-1.5 text-sm font-medium transition-colors duration-[120ms]", tab === key ? "bg-raised text-ink shadow-[inset_0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink", key === "conta" && tab !== key && "hover:text-danger")}
              >
                {label}
                {key === "pedidos" && Boolean(waiting) && <span className="rounded-full bg-amber-soft px-1.5 text-[11px] font-semibold tabular-nums text-amber-ink">{waiting}</span>}
              </Link>
            ))}
          </span>
        </nav>
      </div>
      {tab === "pedidos" && <RequestsSection />}
      {tab === "auditoria" && <AuditSection agencyId={agency.id} people={await auditPeople(createAdminClient(), agency.id, userId)} filters={auditFilters(sp)} page={page} />}
      {tab === "acessos" && <AccessSection agencyId={agency.id} people={await auditPeople(createAdminClient(), agency.id, userId)} />}
      {tab === "suporte" && <SupportSection agencyId={agency.id} />}
      {tab === "fator" && <MfaSection bare verifyHref={`/painel/verificar?next=${encodeURIComponent("/painel/seguranca?aba=fator")}`} />}
      {tab === "conta" && <AccountSection agency={agency} />}
    </div>
  );
}
