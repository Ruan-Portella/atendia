import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { CopyButton } from "@/components/copy-button";
import { appUrl, relativeTime } from "@/lib/utils";
import { brl } from "@/lib/plans";

export const metadata = { title: "Afiliados" };

export default async function AfiliadosPage() {
  const { agency } = await requireAgency();
  const supabase = await createClient();
  const { data: refs } = await supabase.from("referrals").select("id, status, commission_cents, created_at").eq("referrer_id", agency.id).order("created_at", { ascending: false });
  const link = appUrl(`/?ref=${agency.referral_code}`);
  const total = (refs ?? []).reduce((s, r) => s + r.commission_cents, 0) / 100;
  const paying = (refs ?? []).filter((r) => r.status === "paying").length;
  return (
    <div className="max-w-[720px]">
      <h1 className="text-[28px] font-bold">Indique e ganhe 30% para sempre</h1>
      <p className="text-sm text-muted">Toda agência que assinar pelo seu link paga 30% de comissão todo mês, enquanto for cliente.</p>
      <div className="card mt-6 flex flex-wrap items-center gap-3 p-5">
        <code className="flex-1 truncate rounded-lg bg-ground px-3 py-2.5 text-sm">{link}</code>
        <CopyButton text={link} label="Copiar link" className="btn-dark" />
      </div>
      <div className="mt-4 grid gap-3.5 sm:grid-cols-3">
        <div className="card px-[18px] py-4"><div className="kpi-label">Indicações</div><div className="display text-[30px] font-bold">{refs?.length ?? 0}</div></div>
        <div className="card px-[18px] py-4"><div className="kpi-label">Pagando</div><div className="display text-[30px] font-bold">{paying}</div></div>
        <div className="card px-[18px] py-4"><div className="kpi-label">Comissão acumulada</div><div className="display text-[30px] font-bold">{brl(total)}</div></div>
      </div>
      <div className="card mt-4 overflow-hidden">
        {(refs ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhuma indicação ainda. Compartilhe o link em grupos de agências, no seu Instagram ou com quem te pergunta “que ferramenta você usa”.</p>}
        {(refs ?? []).map((r) => (
          <div key={r.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 text-sm last:border-0">
            <span className="text-muted">{relativeTime(r.created_at)}</span>
            <span className="font-medium">{r.status === "paying" ? "Assinante" : r.status === "churned" ? "Cancelou" : "Em teste"}</span>
            <span className="ml-auto tabular">{brl(r.commission_cents / 100)}</span>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-muted">Pagamento das comissões: por PIX, todo dia 10, para valores acima de R$ 100. [defina sua regra]</p>
    </div>
  );
}
