import type { ActionResult } from "@/lib/action-result";
import { SIGNATURE_FORMATS, SIGNATURE_LABEL, type SignatureFormat } from "@/lib/signature";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

/**
 * Minha assinatura (Caixa de entrada, parte 5): o formato das minhas mensagens no WhatsApp e no
 * Instagram. Vale nos chatbots que não travam o formato; nos outros, vale o do chatbot.
 */
export function SignatureCard({ value, action }: { value: SignatureFormat | null; action: (fd: FormData) => Promise<ActionResult> }) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-base font-medium">Minha assinatura</h2>
        <p className="text-sm text-muted">Como o seu nome aparece nas suas mensagens pelo WhatsApp e pelo Instagram. Vale nos chatbots que não travam o formato; nos outros, vale o que o chatbot define.</p>
      </div>
      <ActionForm action={action} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="label">Formato</span>
          <select name="signature" defaultValue={value ?? "chatbot"} className="input max-w-[460px]">
            <option value="chatbot">O do chatbot</option>
            {SIGNATURE_FORMATS.map((f) => <option key={f} value={f}>{SIGNATURE_LABEL[f]}</option>)}
          </select>
        </label>
        <SubmitButton className="btn-primary" pendingLabel="Salvando…">Salvar</SubmitButton>
      </ActionForm>
    </section>
  );
}
