import type { ActionResult } from "@/lib/action-result";
import type { ActionRow } from "@/lib/actions";
import { ResultForm } from "@/components/admin/result-form";
import { SubmitButton } from "@/components/ui/submit-button";

export const EXAMPLE_SCHEMA = `{
  "type": "object",
  "properties": {
    "categoria": { "type": "string", "description": "categoria do cardápio, ex.: pizzas" }
  },
  "required": []
}`;

/** Cadastro de uma ação de consulta (painel da agência e backoffice dos pilotos). savedHeaders: os nomes já guardados. */
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
            <option value="signed">exige contexto assinado (só aparece com ele)</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={`out-${p}`}>Resultados (opcional, separados por vírgula)</label>
          <input id={`out-${p}`} name="outcomes" defaultValue={a?.outcomes?.join(", ") ?? ""} className="input font-mono" />
        </div>
      </div>
      <HeaderFields id={p} saved={savedHeaders} />
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
