import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { RECOVERY_CONFIRM_HOURS, RECOVERY_WAIT_HOURS } from "@/lib/mfa-recovery";
import type { ActionResult } from "@/lib/action-result";

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

/**
 * "Perdi o app autenticador" (painel e área do cliente): o pedido de recuperação pelo suporte, ou
 * o pedido em aberto. support: quem remove ("o suporte do BoaVoz" ou "a equipe da agência");
 * notified: quem recebe o alerta.
 */
export function MfaRecoveryRequest({ email, open, action, backHref, support, notified }: { email: string; open: { status: "pendente" | "confirmado"; createdAt: string; availableAt: string | null } | null; action: (fd: FormData) => Promise<ActionResult>; backHref: string; support: string; notified: string }) {
  return (
    <div className="card flex w-full max-w-[460px] flex-col gap-4 p-6">
      <div>
        <h1 className="text-xl font-normal">Perdi o app autenticador</h1>
        <p className="text-sm text-muted">Celular perdido, trocado ou app apagado: {support} remove o app antigo da sua conta e você cadastra um novo.</p>
      </div>
      {open?.status === "pendente" ? (
        <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">
          Pedido feito em {when(open.createdAt)}. Falta confirmar pelo link que foi para <strong>{email}</strong> (vale {RECOVERY_CONFIRM_HOURS} horas). Confira também o spam.
        </p>
      ) : open?.status === "confirmado" ? (
        <p className="rounded-lg bg-ground px-3 py-2 text-sm text-ink-2">
          Pedido confirmado. {open.availableAt ? `A partir de ${when(open.availableAt)}, ` : ""}
          {support} remove o app e você recebe um e-mail. Encontrou o app? Volte e digite o código: o pedido cai sozinho.
        </p>
      ) : (
        <>
          <ol className="ml-4 flex list-decimal flex-col gap-1 text-sm text-ink-2">
            <li>Um link vai para <strong>{email}</strong>: confirme em até {RECOVERY_CONFIRM_HOURS} horas.</li>
            <li>Por segurança, a remoção só acontece {RECOVERY_WAIT_HOURS} horas depois da confirmação. {notified} recebe um alerta.</li>
            <li>Removido o app, você recebe um e-mail e cadastra um novo no próximo acesso.</li>
          </ol>
          <ActionForm action={action} className="flex flex-col gap-3">
            <div>
              <label htmlFor="reason" className="label">O que aconteceu? (opcional)</label>
              <textarea id="reason" name="reason" maxLength={500} rows={3} className="input" placeholder="Ex.: troquei de celular e não passei o app para o novo" />
            </div>
            <SubmitButton className="btn-primary" pendingLabel="Enviando…">Pedir a recuperação</SubmitButton>
          </ActionForm>
        </>
      )}
      <Link href={backHref} className="self-start text-xs text-muted hover:underline">Voltar e digitar o código</Link>
    </div>
  );
}
