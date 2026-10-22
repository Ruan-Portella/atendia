"use client";

import Link from "next/link";
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { NoticeStatus } from "@/lib/team-whatsapp";
import { dismissNoticeWhatsAppCard, requestNoticeWhatsApp, resendNoticeWhatsApp } from "@/app/painel/perfil/actions";

/**
 * O convite para os avisos no WhatsApp (leva de 19/10/2026), num cartão dentro dos Avisos do painel
 * (o sino; redesenho, 22/10); o campo do número abre no "Ativar no WhatsApp". Some quando a pessoa
 * confirma ou toca em "Agora não" (o cartão completo fica em Meu perfil) e volta quando o WhatsApp
 * do número muda, mesmo depois do "Agora não": os avisos pararam e só ela resolve. Sem o assistente
 * pronto, nada aparece.
 */
export function TeamWhatsAppStrip({ status, brand, consent }: { status: NoticeStatus; brand: string; consent: string }) {
  const [open, setOpen] = useState(false);
  if (!status.available) return null;
  const identityAlert = status.status === "confirmed" && status.identityChanged;
  if (status.status === "confirmed" && !identityAlert) return null;
  if (status.dismissed && !identityAlert) return null;

  let text: React.ReactNode;
  let action: React.ReactNode = null;
  if (status.status === "pending") {
    text = (
      <>
        Mandamos a mensagem para <b>{status.masked}</b>: abra o WhatsApp e toque em <b>Confirmar</b>.
      </>
    );
    action = (
      <>
        <ActionForm action={resendNoticeWhatsApp} success="Mensagem enviada de novo.">
          <SubmitButton className="btn-ghost py-1.5 text-xs" pendingLabel="Mandando…">
            Mandar de novo
          </SubmitButton>
        </ActionForm>
        <Link href="/painel/perfil#avisos" className="text-xs font-semibold text-brand hover:underline">
          Trocar o número
        </Link>
      </>
    );
  } else if (status.status === "confirmed") {
    text = (
      <>
        O WhatsApp do número <b>{status.masked}</b> mudou (aparelho novo ou outra pessoa com o número) e os avisos pararam.
      </>
    );
    action = (
      <>
        <ActionForm action={resendNoticeWhatsApp} success="Mensagem enviada.">
          <SubmitButton className="btn-primary py-1.5 text-xs" pendingLabel="Mandando…">
            Confirmar de novo
          </SubmitButton>
        </ActionForm>
        <Link href="/painel/perfil#avisos" className="text-xs font-semibold text-brand hover:underline">
          Parar os avisos
        </Link>
      </>
    );
  } else if (status.status === "refused") {
    text = (
      <>
        O número <b>{status.masked}</b> respondeu &quot;Não fui eu&quot; e não recebe mensagens da {brand}.
      </>
    );
    action = (
      <Link href="/painel/perfil#avisos" className="btn-ghost py-1.5 text-xs">
        Usar outro número
      </Link>
    );
  } else {
    text = (
      <>
        <b>Avisos no seu WhatsApp:</b> atendimento urgente, lead novo e cobrança chegam pelo número da {brand}, e o assistente de lá responde sobre o painel.
      </>
    );
    if (!open)
      action = (
        <button type="button" onClick={() => setOpen(true)} className="btn-primary py-1.5 text-xs">
          Ativar no WhatsApp
        </button>
      );
  }

  return (
    <div data-aviso data-tom={identityAlert ? "warn" : "info"} className="flex flex-wrap items-start gap-x-2.5 gap-y-3 rounded-[14px] border border-brand-line bg-brand-soft p-3.5 text-sm leading-relaxed text-ink">
      <MessageCircle size={16} className="mt-0.5 shrink-0 text-brand" aria-hidden />
      <span className="min-w-0 flex-1">{text}</span>
      <div className="flex basis-full flex-wrap items-center gap-x-3 gap-y-2 pl-[26px]">
        {action}
        {/* o alerta de identidade não fecha: some quando ela confirma de novo ou para os avisos */}
        {!identityAlert && (
          <ActionForm action={dismissNoticeWhatsAppCard}>
            <SubmitButton className="text-xs text-muted hover:underline" pendingLabel="…">
              Agora não
            </SubmitButton>
          </ActionForm>
        )}
      </div>
      {open && status.status === null && (
        <div className="flex basis-full flex-col gap-1.5 pl-[26px]">
          <ActionForm action={requestNoticeWhatsApp} success="Mensagem enviada." className="flex flex-wrap items-center gap-2">
            <label htmlFor="aviso_phone_top" className="sr-only">
              Seu WhatsApp
            </label>
            <input id="aviso_phone_top" name="phone" type="tel" inputMode="tel" autoComplete="tel" required autoFocus className="input w-56 max-w-full py-1.5" placeholder="(41) 99999-0000" />
            <SubmitButton className="btn-primary py-1.5 text-xs" pendingLabel="Mandando…">
              Receber no WhatsApp
            </SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:underline">
              Cancelar
            </button>
          </ActionForm>
          <p className="max-w-3xl text-[11px] leading-relaxed text-muted">{consent}</p>
        </div>
      )}
    </div>
  );
}
