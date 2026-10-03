import { createAdminClient } from "@/lib/supabase/admin";
import { cn, relativeTime } from "@/lib/utils";
import { WHATSAPP_BILLING_URL, hasPaymentMethod, phoneDiagnostics } from "@/lib/whatsapp";
import { nameLine, qualityLine, restrictionLines, statusLine, type DiagLine, type DiagTone } from "@/lib/whatsapp-diagnostics";
import type { MetaAccountDetail } from "@/lib/meta-enforcement";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { recheckWhatsAppPayment } from "@/app/painel/actions";

const DOT: Record<DiagTone, string> = { ok: "bg-brand", atencao: "bg-amber", problema: "bg-danger" };

/**
 * Diagnóstico do número (L1): situação, nome de exibição e nota de qualidade (consultados na Meta
 * a cada abertura da aba), forma de pagamento (com "Já cadastrei o cartão"), o alerta do erro
 * 131042 e as ordens, restrições e infrações da Meta ativas. Quem renderiza já conferiu o dono.
 */
export async function WhatsAppDiagnostics({ botId }: { botId: string }) {
  const admin = createAdminClient();
  const { data: ch } = await admin.from("whatsapp_channels").select("phone_number_id, waba_id, access_token_enc, business_id, payment_issue_at, coexistence").eq("bot_id", botId).maybeSingle();
  if (!ch) return null;
  // número de teste do app (sem portfólio do cliente): não tem pagamento próprio na Meta
  const ownBilling = Boolean(ch.waba_id && ch.business_id);
  const [info, funded, { data: measures }] = await Promise.all([
    phoneDiagnostics(ch).catch(() => null),
    ownBilling ? hasPaymentMethod({ ...ch, waba_id: ch.waba_id! }).catch(() => null) : Promise.resolve(undefined),
    ch.waba_id
      ? admin.from("enforcement_actions").select("source, feature, reason, detail").eq("waba_id", ch.waba_id).is("lifted_at", null).in("source", ["meta_order", "meta_restriction", "meta_violation"])
      : Promise.resolve({ data: [] as Array<{ source: string; feature: string; reason: string; detail: unknown }> }),
  ]);
  // cartão entrou: o alerta de pagamento sai (o número volta a responder)
  const paymentIssue = funded === true ? null : (ch.payment_issue_at as string | null);
  if (funded === true && ch.payment_issue_at) await admin.from("whatsapp_channels").update({ payment_issue_at: null }).eq("bot_id", botId);

  const lines: DiagLine[] = [];
  if (info) {
    const status = statusLine(info.status);
    if (status) lines.push(status);
    lines.push(nameLine(info.name_status, info.verified_name), qualityLine(info.quality_rating));
  } else {
    lines.push({ label: "Meta", value: "não consegui consultar o número agora", tone: "atencao", hint: "Abra a aba de novo em alguns minutos. Se continuar, o acesso à conta pode ter caído." });
  }
  if (paymentIssue) {
    lines.push({ label: "Pagamento na Meta", value: `a Meta está recusando mensagens por falta de pagamento (desde ${relativeTime(paymentIssue)})`, tone: "problema", hint: "O assistente não responde por WhatsApp até o cliente cadastrar um cartão no Gerenciador do WhatsApp, em Configurações de pagamento." });
  } else if (funded === true) {
    lines.push({ label: "Pagamento na Meta", value: "cartão cadastrado (a Meta cobra direto do cliente)", tone: "ok" });
  } else if (funded === false) {
    lines.push({ label: "Pagamento na Meta", value: "sem forma de pagamento", tone: "atencao", hint: "O cliente precisa cadastrar um cartão no Gerenciador do WhatsApp, em Configurações de pagamento. Sem cartão, o assistente responde enquanto houver mensagens grátis; depois a Meta recusa." });
  } else if (funded === null) {
    lines.push({ label: "Pagamento na Meta", value: "não consegui conferir agora", tone: "atencao" });
  }
  for (const m of measures ?? []) {
    const detail = (m.detail ?? {}) as MetaAccountDetail;
    if (m.source === "meta_restriction") {
      const r = restrictionLines(detail.restriction_info);
      lines.push(...(r.length ? r : [{ label: "Restrição da Meta", value: m.reason, tone: "problema" as const }]));
    } else if (m.source === "meta_order") {
      lines.push({ label: "Ordem da Meta", value: m.reason, tone: m.feature === "channel" ? "problema" : "atencao", hint: m.feature === "channel" ? "Nada entra nem sai por este número até a Meta reativar a conta." : "O número ainda funciona. Veja o aviso no Gerenciador do WhatsApp." });
    } else {
      lines.push({ label: "Infração na Meta", value: m.reason.replace(/^infração na Meta: /, ""), tone: "atencao", hint: "A Meta registrou uma infração das regras de comércio. A equipe BoaVoz revisa o caso; veja o aviso no Gerenciador do WhatsApp." });
    }
  }
  if (ch.coexistence) {
    lines.push({ label: "App do celular", value: "o número também está no app WhatsApp Business", tone: "ok", hint: "Abra o app no celular pelo menos 1 vez por semana: parado uns 14 dias, a Meta desconecta o número." });
  }

  const payable = ownBilling && (paymentIssue || funded === false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-line-2 px-3 py-3">
      <div className="text-sm font-semibold">Diagnóstico do número</div>
      <ul className="flex flex-col gap-1.5 text-sm">
        {lines.map((l, i) => (
          <li key={i} className="flex gap-2">
            <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[l.tone])} aria-hidden />
            <span>
              <span className="text-muted">{l.label}:</span> <span className={l.tone === "problema" ? "font-semibold text-danger" : ""}>{l.value}</span>
              {/* no app do celular, a dica vale sempre; nos outros, só quando há o que fazer */}
              {l.hint && (l.tone !== "ok" || l.label === "App do celular") && <span className="block text-xs text-muted">{l.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {payable && (
          <ActionForm action={recheckWhatsAppPayment.bind(null, botId)}>
            <SubmitButton className="btn-ghost py-1 text-xs" pendingLabel="Conferindo na Meta…">Já cadastrei o cartão</SubmitButton>
          </ActionForm>
        )}
        <a href={WHATSAPP_BILLING_URL} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold underline">
          Abrir o Gerenciador do WhatsApp
        </a>
      </div>
    </div>
  );
}
