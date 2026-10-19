import { MessageCircle } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { NOTICE_CONSENT_TEXT, NOTICE_NO, NOTICE_YES, type NoticeStatus } from "@/lib/team-whatsapp";
import { company } from "@/lib/company";
import { dismissNoticeWhatsAppCard, requestNoticeWhatsApp, resendNoticeWhatsApp, stopNoticeWhatsApp } from "@/app/painel/perfil/actions";

const dateBr = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));

/** O campo do número com o aceite do lado do botão. */
function RequestForm({ label = "Receber no WhatsApp" }: { label?: string }) {
  return (
    <div className="flex flex-col gap-2">
      <ActionForm action={requestNoticeWhatsApp} success="Mensagem enviada." className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="aviso_phone" className="label">
            Seu WhatsApp
          </label>
          <input id="aviso_phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" required className="input" placeholder="(41) 99999-0000" />
        </div>
        <SubmitButton className="btn-primary" pendingLabel="Mandando…">
          {label}
        </SubmitButton>
      </ActionForm>
      <p className="text-[11px] leading-relaxed text-muted">{NOTICE_CONSENT_TEXT}</p>
    </div>
  );
}

/**
 * Avisos e ajuda no WhatsApp (leva de 19/10/2026): o número da pessoa, com o aceite confirmado pelo
 * botão que chega no WhatsApp. "top": o cartão no topo do painel até ela confirmar (com "Agora
 * não"); "profile": Meu perfil, com todos os estados. Sem o assistente da BoaVoz, nada aparece.
 */
export function TeamWhatsAppCard({ status, variant }: { status: NoticeStatus; variant: "top" | "profile" }) {
  if (!status.available) return null;
  const top = variant === "top";
  // no topo: até confirmar, e de novo quando o WhatsApp do número mudou (precisa confirmar outra vez)
  if (top && (status.dismissed || (status.status === "confirmed" && !status.identityChanged))) return null;

  return (
    <section className={`card flex flex-col gap-3 ${top ? "border-brand/30 p-4" : "p-6"}`}>
      <div className="flex items-start gap-3">
        <MessageCircle size={18} className="mt-0.5 shrink-0 text-brand" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Avisos e ajuda no seu WhatsApp</h2>
          <p className="text-xs text-muted">
            Os avisos da conta (atendimento urgente, lead novo, cobrança) chegam pelo número da {company.brand}, e o assistente de lá responde sobre o painel. É o mesmo atendimento que os seus clientes vão ter.
          </p>
        </div>
      </div>

      {status.status === "confirmed" && status.identityChanged && (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            O WhatsApp do número {status.masked} mudou (aparelho novo ou outra pessoa com o número) e os avisos pararam. Para voltar, confirme de novo: mandamos a mensagem e você toca em &quot;{NOTICE_YES}&quot;.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ActionForm action={resendNoticeWhatsApp} success="Mensagem enviada.">
              <SubmitButton className="btn-primary py-1.5 text-xs" pendingLabel="Mandando…">
                Confirmar de novo
              </SubmitButton>
            </ActionForm>
            <ActionForm action={stopNoticeWhatsApp}>
              <SubmitButton className="text-xs font-semibold text-danger hover:underline" pendingLabel="Esquecendo…">
                Esquecer o número
              </SubmitButton>
            </ActionForm>
          </div>
        </div>
      )}

      {status.status === "confirmed" && !status.stopped && !status.identityChanged && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            <span className="font-semibold">{status.masked}</span>
            <span className="text-muted"> · confirmado{status.confirmedAt ? ` em ${dateBr(status.confirmedAt)}` : ""}</span>
          </p>
          <ActionForm action={stopNoticeWhatsApp}>
            <SubmitButton className="text-xs font-semibold text-danger hover:underline" pendingLabel="Parando…">
              Parar os avisos e esquecer o número
            </SubmitButton>
          </ActionForm>
        </div>
      )}

      {status.status === "confirmed" && status.stopped && !status.identityChanged && (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Você mandou SAIR no WhatsApp ({status.masked}) e os avisos pararam. Para voltar, toque em &quot;Foi engano&quot; na resposta que chegou por lá.
          </p>
          <ActionForm action={stopNoticeWhatsApp}>
            <SubmitButton className="text-xs font-semibold text-danger hover:underline" pendingLabel="Esquecendo…">
              Esquecer o número
            </SubmitButton>
          </ActionForm>
        </div>
      )}

      {status.status === "pending" && (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            Mandamos a mensagem para <span className="font-semibold">{status.masked}</span>. Abra o WhatsApp e toque em &quot;{NOTICE_YES}&quot;. Se não foi você que pediu, a pessoa do número toca em &quot;{NOTICE_NO}&quot;.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <ActionForm action={resendNoticeWhatsApp} success="Mensagem enviada de novo.">
              <SubmitButton className="btn-ghost py-1.5 text-xs" pendingLabel="Mandando…">
                Mandar de novo
              </SubmitButton>
            </ActionForm>
            <ActionForm action={stopNoticeWhatsApp} success="Pedido cancelado.">
              <SubmitButton className="text-xs text-muted hover:underline" pendingLabel="Cancelando…">
                Cancelar o pedido
              </SubmitButton>
            </ActionForm>
          </div>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted">Trocar o número</summary>
            <div className="mt-2">
              <RequestForm label="Mandar para este número" />
            </div>
          </details>
        </div>
      )}

      {status.status === "refused" && (
        <div className="flex flex-col gap-3 text-sm">
          <p>
            O número {status.masked} respondeu &quot;{NOTICE_NO}&quot; e não recebe mais mensagens da {company.brand}. Confira o número e peça de novo.
          </p>
          <RequestForm />
        </div>
      )}

      {status.status === null && <RequestForm />}

      {top && (
        <ActionForm action={dismissNoticeWhatsAppCard}>
          <SubmitButton className="text-xs text-muted hover:underline" pendingLabel="…">
            Agora não
          </SubmitButton>
        </ActionForm>
      )}
    </section>
  );
}
