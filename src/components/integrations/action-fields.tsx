import type { ActionResult } from "@/lib/action-result";
import { needsConfirmation, type ActionRow } from "@/lib/actions";
import { ResultForm } from "@/components/admin/result-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { SwitchField } from "@/components/ui/setting-row";
import { HeadersBuilder, ParamsBuilder, TestParams } from "@/components/integrations/params-builder";

/** Opções em cartões (um rádio por cartão), com a explicação de cada uma. */
function RadioCards({ name, defaultValue, options }: { name: string; defaultValue: string; options: Array<{ value: string; label: string; hint: string }> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer items-start gap-2.5 rounded-[14px] border border-line p-3 transition-colors duration-[120ms] hover:border-line-strong has-checked:border-brand has-checked:bg-brand-soft/60">
          <input type="radio" name={name} value={o.value} defaultChecked={defaultValue === o.value} className="mt-1 accent-brand" />
          <span>
            <span className="block text-sm font-medium text-ink">{o.label}</span>
            <span className="mt-0.5 block text-xs leading-snug text-muted">{o.hint}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

/**
 * Os campos de uma ação, consulta ou "executa" (redesenho, etapa 5: em seções, com os parâmetros e
 * os cabeçalhos em linhas no lugar do JSON). No painel vão no modal da ação (o formulário e o Salvar
 * são do modal); no backoffice, dentro de ActionFields. savedHeaders: os nomes já guardados.
 */
export function ActionFieldsBody({ a, savedHeaders = [] }: { a?: ActionRow; savedHeaders?: string[] }) {
  const p = a?.id ?? "nova";
  return (
    <>
      <section className="flex flex-col gap-3">
        <h3 className="kpi-label">O que a ação faz</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor={`name-${p}`}>Nome (snake_case)</label>
            <input id={`name-${p}`} name="name" required defaultValue={a?.name ?? ""} className="input font-mono" placeholder="buscar_cardapio" />
          </div>
          <div>
            <label className="label" htmlFor={`url-${p}`}>Endereço (HTTPS)</label>
            <input id={`url-${p}`} name="url" type="url" required defaultValue={a?.url ?? ""} className="input" placeholder="https://api.loja.com/boavoz/cardapio" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor={`desc-${p}`}>Descrição (o que a IA lê para decidir quando chamar)</label>
          <textarea id={`desc-${p}`} name="description" required rows={2} maxLength={500} defaultValue={a?.description ?? ""} className="input" placeholder="Use quando o cliente perguntar o que tem no cardápio, preços ou se um prato está disponível." />
        </div>
        <RadioCards
          name="type"
          defaultValue={a?.type ?? "query"}
          options={[
            { value: "query", label: "Consulta", hint: "Só lê: a IA chama na hora (status do pedido, agenda, saldo)." },
            { value: "execute", label: "Executa", hint: "Cria, altera ou cancela: só depois do Confirmar do contato." },
          ]}
        />
        <SwitchField name="supports_preview" defaultChecked={a?.supports_preview ?? false} label={<>Aceita prévia (mode: &quot;preview&quot;)</>} hint={<>Só ligue se o endpoint não cria nada quando recebe mode: &quot;preview&quot; e devolve confirmation {"{summary, items, total_cents}"} para o resumo do Confirmar.</>} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="kpi-label">Parâmetros</h3>
        <ParamsBuilder initial={a?.params_schema ?? null} />
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="kpi-label">Quem pode usar</h3>
        <div>
          <label className="label" htmlFor={`level-${p}`}>Nível mínimo do contato</label>
          <select id={`level-${p}`} name="min_level" defaultValue={a?.min_level ?? "anonimo"} className="input">
            <option value="anonimo">Qualquer contato</option>
            <option value="canal">Telefone conhecido no WhatsApp</option>
            <option value="usuario">Identificado pela empresa</option>
          </select>
        </div>
        <SwitchField name="context_required" value="signed" defaultChecked={a?.context_required === "signed"} label="Exige a conta da pessoa (workspace, loja)" hint="A ação só aparece com a conta da pessoa: token, pareamento ou roteiro." />
        <SwitchField name="routine_only" defaultChecked={a?.routine_only ?? false} label="Só no roteiro" hint="A IA só usa esta ação no passo de um roteiro ligado: desligar o roteiro tira a ação junto. Desligado, a IA usa a ação sempre que precisar." />
        <div>
          <label className="label" htmlFor={`out-${p}`}>Resultados possíveis (opcional)</label>
          <input id={`out-${p}`} name="outcomes" defaultValue={a?.outcomes?.join(", ") ?? ""} className="input font-mono" placeholder="encontrado, nao_encontrado" />
          <p className="mt-1 text-xs text-muted">Separados por vírgula. Nos roteiros, cada resultado leva a um caminho.</p>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h3 className="kpi-label">Cabeçalhos (opcional)</h3>
        <HeadersBuilder saved={savedHeaders} />
      </section>

      <SwitchField name="active" defaultChecked={a ? a.active : true} label="Ativa" hint="Desativada, a IA não chama esta ação." className="rounded-[14px] border border-line px-4 py-3" />
    </>
  );
}

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
