import type { ActionResult } from "@/lib/action-result";
import { OPTIN_BUTTONS, optInOfferText } from "@/lib/marketing-consent";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Aba WhatsApp: oferecer novidades (leva B3). Ligada, o assistente oferece uma vez a cada contato,
 * no fim natural da conversa, com botões Sim e Não; a resposta fica guardada como prova.
 */
export function MarketingOptInForm({ botId, on, company, canEdit, action }: { botId: string; on: boolean; company: string; canEdit: boolean; action: (fd: FormData) => Promise<ActionResult> }) {
  return (
    <ActionForm key={`${botId}${on}`} action={action} className="card flex flex-col gap-3 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Oferecer novidades</h3>
        <span className={on ? "rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand" : "text-xs text-muted"}>{on ? "Ligado" : "Desligado"}</span>
      </div>
      <p className="text-sm text-ink-2">
        O assistente pergunta uma vez a cada contato, quando a conversa termina (a pessoa deixou o contato ou agradeceu), se ela quer receber novidades e promoções por aqui. No chat do
        site, a pergunta vai para quem deixou o WhatsApp como contato. Só quem aceita poderá receber campanhas. A resposta, o texto e a data ficam guardados como prova; quem responde SAIR
        deixa de receber na hora. Quem disse que não tem 18 anos não recebe a pergunta.
      </p>
      <div className="flex flex-col gap-2 rounded-xl bg-ground p-3 text-sm" aria-label="Prévia da mensagem">
        <span className="text-xs font-semibold text-muted">Prévia no WhatsApp</span>
        <p className="max-w-[440px] rounded-lg bg-panel px-3 py-2">{optInOfferText(company)}</p>
        <div className="flex flex-wrap gap-2">
          {OPTIN_BUTTONS.map((b) => (
            <span key={b.id} className="rounded-full border border-line bg-panel px-3 py-1 text-xs font-semibold text-brand">{b.title}</span>
          ))}
        </div>
      </div>
      {canEdit ? (
        <>
          <label className="flex items-center gap-2.5 text-sm">
            <input type="checkbox" name="offer" defaultChecked={on} />
            Oferecer novidades no WhatsApp
          </label>
          <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
        </>
      ) : (
        <p className="text-xs text-muted">Só quem configura o chatbot muda esta opção.</p>
      )}
    </ActionForm>
  );
}
