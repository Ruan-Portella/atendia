import type { ActionResult } from "@/lib/action-result";
import { needsConfirmation, type ActionRow } from "@/lib/actions";
import { ResultForm } from "@/components/admin/result-form";
import { SubmitButton } from "@/components/ui/submit-button";

export const EXAMPLE_SCHEMA = `{
  "type": "object",
  "properties": {
    "categoria": { "type": "string", "description": "categoria do cardápio, ex.: pizzas" }
  },
  "required": []
}`;

/** Cadastro de uma ação, consulta ou "executa" (painel da agência e backoffice dos pilotos). savedHeaders: os nomes já guardados. */
export function ActionFields({ action, a, label, savedHeaders = [] }: { action: (fd: FormData) => Promise<ActionResult>; a?: ActionRow; label: string; savedHeaders?: string[] }) {
  const p = a?.id ?? "nova";
  return (
    <ResultForm action={action}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`name-${p}`}>Nome (snake_case)</label>
          <input id={`name-${p}`} name="name" required defaultValue={a?.name ?? ""} className="input font-mono" placeholder="buscar_cardapio" />
        </div>
        <div>
          <label className="label" htmlFor={`url-${p}`}>URL (HTTPS)</label>
          <input id={`url-${p}`} name="url" required defaultValue={a?.url ?? ""} className="input" placeholder="https://api.loja.com/boavoz/cardapio" />
        </div>
      </div>
      <div>
        <label className="label" htmlFor={`desc-${p}`}>Descrição (o que a IA lê para decidir quando chamar)</label>
        <textarea id={`desc-${p}`} name="description" required rows={2} maxLength={500} defaultValue={a?.description ?? ""} className="input" placeholder="Use quando o cliente perguntar o que tem no cardápio, preços ou se um prato está disponível." />
      </div>
      <div>
        <label className="label" htmlFor={`schema-${p}`}>Parâmetros (JSON Schema, até 10, tipos simples)</label>
        <textarea id={`schema-${p}`} name="params_schema" rows={6} defaultValue={a ? JSON.stringify(a.params_schema, null, 2) : EXAMPLE_SCHEMA} className="input font-mono text-xs" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor={`type-${p}`}>Tipo</label>
          <select id={`type-${p}`} name="type" defaultValue={a?.type ?? "query"} className="input">
            <option value="query">consulta (só lê: a IA chama na hora)</option>
            <option value="execute">executa (cria, altera ou cancela: só depois do Confirmar do contato)</option>
          </select>
        </div>
        <div className="flex flex-col justify-end">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="supports_preview" defaultChecked={a?.supports_preview ?? false} /> esta ação aceita prévia (mode: &quot;preview&quot;)
          </label>
          <p className="text-xs text-muted">Só marque se o endpoint não cria nada quando recebe mode: &quot;preview&quot; e devolve confirmation {"{summary, items, total_cents}"} para o resumo do Confirmar.</p>
        </div>
        <div>
          <label className="label" htmlFor={`level-${p}`}>Nível mínimo do contato</label>
          <select id={`level-${p}`} name="min_level" defaultValue={a?.min_level ?? "anonimo"} className="input">
            <option value="anonimo">anônimo (qualquer contato)</option>
            <option value="canal">canal (telefone conhecido no WhatsApp)</option>
            <option value="usuario">usuário (identificado pela empresa)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`ctx-${p}`}>Contexto (workspace, loja)</label>
          <select id={`ctx-${p}`} name="context_required" defaultValue={a?.context_required ?? "none"} className="input">
            <option value="none">não exige</option>
            <option value="signed">exige contexto (só aparece com a conta da pessoa: token, pareamento ou roteiro)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`out-${p}`}>Resultados (opcional, separados por vírgula)</label>
          <input id={`out-${p}`} name="outcomes" defaultValue={a?.outcomes?.join(", ") ?? ""} className="input font-mono" />
        </div>
      </div>
      <HeaderFields id={p} saved={savedHeaders} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="routine_only" className="mt-1" defaultChecked={a?.routine_only ?? false} />
        <span>
          Só no roteiro
          <span className="block text-xs text-muted">A IA só usa esta ação no passo de um roteiro ligado: desligar o roteiro tira a ação junto. Desmarcada, a IA usa a ação sempre que precisar.</span>
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={a ? a.active : true} /> Ativa
      </label>
      <SubmitButton className="btn-primary self-start py-1.5" pendingLabel="Salvando (classificando o efeito)…">
        {label}
      </SubmitButton>
    </ResultForm>
  );
}

/**
 * Testar: chama o endpoint de verdade com test: true. Numa ação com Confirmar ("executa", ou
 * pedido, reserva e cobrança), só com o aviso marcado (vai com confirmed: true) ou só a prévia.
 */
export function ActionTestForm({ action, a }: { action: (fd: FormData) => Promise<ActionResult>; a: ActionRow }) {
  const confirm = needsConfirmation(a);
  return (
    <ResultForm action={action} className="border-t border-line-2 pt-3">
      <label className="label" htmlFor={`test-${a.id}`}>Testar (chama o endpoint de verdade, com test: true)</label>
      <textarea id={`test-${a.id}`} name="params" rows={3} className="input font-mono text-xs" defaultValue="{}" />
      {confirm && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="real" /> isto chama meu endpoint de verdade (com confirmed: true); use dados de teste
        </label>
      )}
      {a.supports_preview && (
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" name="preview" /> só a prévia (mode: &quot;preview&quot;: o endpoint não cria nada)
        </label>
      )}
      <SubmitButton className="btn-ghost self-start py-1.5" pendingLabel="Chamando…">Testar</SubmitButton>
    </ResultForm>
  );
}

/**
 * Cabeçalhos personalizados (ex.: x-api-key do gateway do cliente): os valores ficam cifrados e
 * nunca voltam à tela. Texto novo troca todos; vazio mantém os guardados.
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
