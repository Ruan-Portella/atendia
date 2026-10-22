import type { ActionResult } from "@/lib/action-result";
import { needsConfirmation, type ActionRow } from "@/lib/actions";
import { ResultForm } from "@/components/admin/result-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ActionFieldsBody } from "@/components/integrations/action-editor";
import { TestParams } from "@/components/integrations/params-builder";

/** Cadastro de uma ação no backoffice dos pilotos: os mesmos campos, com o resultado embaixo. */
export function ActionFields({ action, a, label, savedHeaders = [] }: { action: (fd: FormData) => Promise<ActionResult>; a?: ActionRow; label: string; savedHeaders?: string[] }) {
  return (
    <ResultForm action={action} className="gap-4">
      <ActionFieldsBody a={a} savedHeaders={savedHeaders} />
      <SubmitButton className="btn-primary self-start py-1.5" pendingLabel="Salvando (classificando o efeito)…">
        {label}
      </SubmitButton>
    </ResultForm>
  );
}

/**
 * Testar: chama o endpoint de verdade com test: true, com um campo por parâmetro. Numa ação com
 * Confirmar ("executa", ou pedido, reserva e cobrança), só com o aviso marcado (vai com
 * confirmed: true) ou só a prévia.
 */
export function ActionTestForm({ action, a }: { action: (fd: FormData) => Promise<ActionResult>; a: ActionRow }) {
  const confirm = needsConfirmation(a);
  return (
    <ResultForm action={action} className="gap-3">
      <TestParams schema={a.params_schema} />
      {confirm && (
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" name="real" className="mt-0.5" /> Isto chama meu endpoint de verdade (com confirmed: true); vou usar dados de teste.
        </label>
      )}
      {a.supports_preview && (
        <label className="flex items-start gap-2 text-xs">
          <input type="checkbox" name="preview" className="mt-0.5" /> Só a prévia (mode: &quot;preview&quot;: o endpoint não cria nada).
        </label>
      )}
      <SubmitButton className="btn-primary self-start py-1.5" pendingLabel="Chamando…">
        Testar agora
      </SubmitButton>
    </ResultForm>
  );
}

/**
 * Cabeçalhos personalizados num campo de texto (os webhooks, em Integrações): os valores ficam
 * cifrados e nunca voltam à tela. Texto novo troca todos; vazio mantém os guardados.
 */
export function HeaderFields({ id, saved }: { id: string; saved: string[] }) {
  return (
    <div>
      <label className="label" htmlFor={`headers-${id}`}>Cabeçalhos personalizados (opcional; um por linha, Nome: valor)</label>
      <textarea id={`headers-${id}`} name="headers" rows={2} className="input font-mono text-xs" placeholder={saved.length ? "Deixe vazio para manter os guardados" : "x-api-key: valor"} autoComplete="off" />
      <p className="mt-1 text-xs text-muted">
        {saved.length ? (
          <>
            Guardados (valores ocultos): <span className="font-mono">{saved.join(", ")}</span>. Escrever aqui troca todos.{" "}
            <label className="inline-flex items-center gap-1">
              <input type="checkbox" name="headers_clear" /> apagar todos
            </label>
          </>
        ) : (
          "Vão cifrados e junto da assinatura; os de assinatura, de transporte e o Content-Type são reservados."
        )}
      </p>
    </div>
  );
}
