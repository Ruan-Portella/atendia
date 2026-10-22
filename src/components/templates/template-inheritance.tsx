import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ClientPicker } from "@/components/client-picker";
import { Status } from "@/components/status";
import type { ActionResult } from "@/lib/action-result";
import type { ClientOption } from "@/lib/panel";
import { TEMPLATE_FIELDS, TEMPLATE_FIELD_LABEL, type TemplateField, type TemplateVersion } from "@/lib/bot-template";

export interface DerivedItem {
  id: string;
  name: string;
  client_name: string;
  status: string;
}

/**
 * Aba Herança do bot modelo (D', parte 2b): o que cada derivado pode mudar, os derivados e "novo
 * chatbot deste modelo" (um por cliente ou loja, com o contexto fixo opcional).
 */
export function TemplateInheritance({
  templateId,
  unlocked,
  derived,
  clients,
  manage,
  saveUnlocked,
  createDerived,
  versions,
  currentVersionId,
  restoreVersion,
}: {
  /** O id do modelo, para o POST /v1/bots (D', parte 4a). */
  templateId: string;
  unlocked: TemplateField[];
  derived: DerivedItem[];
  clients: ClientOption[];
  manage: boolean;
  saveUnlocked: (fd: FormData) => Promise<ActionResult>;
  createDerived: (fd: FormData) => Promise<ActionResult>;
  /** As versões publicadas (parte 3), a mais nova primeiro, e a que os derivados usam. */
  versions: TemplateVersion[];
  currentVersionId: string | null;
  restoreVersion: (versionId: string) => Promise<ActionResult>;
}) {
  return (
    <div className="flex max-w-[860px] flex-col gap-5">
      <div>
        <h2 className="text-[22px] font-medium">Herança</h2>
        <p className="text-sm text-muted">
          Cada chatbot criado deste modelo recebe na hora o que você muda aqui: a personalidade, as instruções, os assuntos do negócio, as ações, os roteiros e a base de conhecimento. Ele fica com o próprio cliente, os canais, o horário e o destino do atendimento e o contexto fixo.
        </p>
      </div>

      <section className="card flex flex-col gap-3 p-5">
        <h3 className="text-base font-medium">O que cada chatbot derivado pode mudar</h3>
        <ActionForm action={saveUnlocked} className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {TEMPLATE_FIELDS.map((f) => (
              <label key={f} className="flex items-center gap-2 text-sm">
                <input type="checkbox" name={`f_${f}`} defaultChecked={unlocked.includes(f)} disabled={!manage} className="accent-brand" />
                {TEMPLATE_FIELD_LABEL[f]}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">Travar um campo faz os derivados voltarem ao valor do modelo; o valor que cada um tinha fica guardado e volta se você liberar de novo. Na saudação do modelo, {"{empresa}"} vira o nome do cliente e {"{assistente}"}, o nome do assistente.</p>
          {manage && <SubmitButton className="btn-ghost self-start" pendingLabel="Salvando…">Salvar</SubmitButton>}
        </ActionForm>
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <h3 className="text-base font-medium">
          Chatbots derivados <span className="font-normal text-muted">({derived.length})</span>
        </h3>
        {derived.length === 0 ? (
          <p className="text-sm text-muted">Nenhum ainda. Crie o primeiro abaixo.</p>
        ) : (
          <ul className="flex flex-col">
            {derived.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 py-2 text-sm last:border-0">
                <Link href={`/painel/bots/${d.id}`} className="font-semibold hover:underline">
                  {d.name} · {d.client_name}
                </Link>
                <Status status={d.status} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card flex flex-col gap-3 p-5">
        <div>
          <h3 className="text-base font-medium">Versões publicadas</h3>
          <p className="text-sm text-muted">O que você muda no modelo fica no rascunho, e o teste ao vivo usa ele. Os derivados só recebem ao publicar (o botão no topo). A base de conhecimento e o que vem pela API valem na hora.</p>
        </div>
        {versions.length === 0 ? (
          <p className="text-sm text-muted">Nenhuma versão ainda: a primeira sai ao publicar ou ao criar o primeiro derivado.</p>
        ) : (
          <ul className="flex flex-col">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-2 py-2 text-sm last:border-0">
                <span className="font-semibold">Versão {v.number}</span>
                <span className="text-muted">
                  {new Date(v.publishedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                  {v.publishedBy ? ` · ${v.publishedBy}` : ""}
                </span>
                {v.id === currentVersionId ? (
                  <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">em uso</span>
                ) : (
                  manage && (
                    <ActionForm action={restoreVersion.bind(null, v.id)} className="ml-auto">
                      <SubmitButton className="text-xs font-semibold text-brand hover:underline" pendingLabel="Voltando…">Usar esta versão</SubmitButton>
                    </ActionForm>
                  )
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {manage && (
        <section className="card flex flex-col gap-3 p-5">
          <h3 className="text-base font-medium">Novo chatbot deste modelo</h3>
          <ActionForm action={createDerived} className="flex flex-col gap-3">
            <ClientPicker clients={clients} defaultClientId={null} idPrefix="deriv" />
            <div>
              <label htmlFor="deriv-context" className="label">Contexto fixo (opcional, JSON): a loja ou o cliente no seu sistema</label>
              <textarea id="deriv-context" name="fixed_context" rows={3} placeholder='{"loja_id": "42"}' spellCheck={false} className="input font-mono text-sm" />
            </div>
            <SubmitButton className="btn-primary self-start" pendingLabel="Criando…">Criar chatbot</SubmitButton>
          </ActionForm>
          <p className="text-xs text-muted">
            Pela API (pacote Plataforma): <code>POST /v1/bots</code> com <code className="select-all">{`"template_id": "bot_${templateId}"`}</code>, um cliente criado por <code>POST /v1/clients</code> e o contexto e os dados de cada loja. Veja em <Link href="/docs/api/provisionamento" className="font-semibold text-brand underline">Lojas pela API</Link>.
          </p>
        </section>
      )}
    </div>
  );
}
