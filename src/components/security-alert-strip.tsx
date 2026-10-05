import Link from "next/link";
import { NoticeStrip } from "@/components/notice-strip";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { markSecurityAlertsSeen } from "@/app/painel/actions";
import type { PendingAlert } from "@/lib/security-alerts";

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/** Faixa do topo do painel com os eventos graves ainda não vistos (também vão por e-mail na hora). */
export function SecurityAlertStrip({ alerts }: { alerts: PendingAlert[] }) {
  return (
    <NoticeStrip
      tone="warn"
      action={
        <span className="flex items-center gap-2">
          <Link href="/painel/seguranca?aba=auditoria" className="font-semibold underline">Ver na auditoria</Link>
          <ActionForm action={markSecurityAlertsSeen}>
            <SubmitButton className="btn-ghost py-1 text-xs">Entendi</SubmitButton>
          </ActionForm>
        </span>
      }
    >
      <strong>Alerta de segurança:</strong> {alerts.map((a) => `${a.label} (${when(a.created_at)})`).join(" · ")}
    </NoticeStrip>
  );
}
