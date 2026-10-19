"use client";

import Link from "next/link";
import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import type { NoticeStatus } from "@/lib/team-whatsapp";
import { dismissNoticeWhatsAppCard, requestNoticeWhatsApp, resendNoticeWhatsApp } from "@/app/painel/perfil/actions";

/**
 * A faixa do topo do painel com o convite para os avisos no WhatsApp (leva de 19/10/2026): uma linha
 * só, como as outras faixas; o campo do número abre no "Ativar no WhatsApp". Some quando a pessoa
 * confirma ou toca em "Agora não" (o cartão completo fica em Meu perfil) e volta quando o WhatsApp
 * do número muda. Sem o assistente pronto, nada aparece.
 */
export function TeamWhatsAppStrip({ status, brand, consent }: { status: NoticeStatus; brand: string; consent: string }) {
  const [open, setOpen] = useState(false);
  if (!status.available || status.dismissed) return null;
  if (status.status === "confirmed" && !status.identityChanged) return null;

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
      <ActionForm action={resendNoticeWhatsApp} success="Mensagem enviada.">
        <SubmitButton className="btn-primary py-1.5 text-xs" pendingLabel="Mandando…">
          Confirmar de novo
        </SubmitButton>
      </ActionForm>
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#cfe3d8] bg-brand-soft px-4 py-2.5 text-sm text-ink sm:px-6 lg:px-9">
      <MessageCircle size={16} className="shrink-0 text-brand" aria-hidden />
      {/* largura mínima no texto: no celular, os botões descem para a linha de baixo em vez de espremer o texto */}
      <span className="min-w-[15rem] flex-1">{text}</span>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {action}
        <ActionForm action={dismissNoticeWhatsAppCard}>
          <SubmitButton className="text-xs text-muted hover:underline" pendingLabel="…">
            Agora não
          </SubmitButton>
        </ActionForm>
      </div>
      {open && status.status === null && (
        <div className="flex basis-full flex-col gap-1.5 sm:pl-7">
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
