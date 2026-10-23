import Link from "next/link";
import { ChevronRight, History, Layers, Plus, Unlock } from "lucide-react";
import { ClientPicker } from "@/components/client-picker";
import { Status } from "@/components/status";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { AutoSwitch, DialogButton, SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { StatusPill } from "@/components/ui/form-section";
import { KeyValueField } from "@/components/integrations/context-fields";
import type { ActionResult } from "@/lib/action-result";
import type { ClientOption } from "@/lib/panel";
import { TEMPLATE_FIELDS, TEMPLATE_FIELD_LABEL, type TemplateField, type TemplateVersion } from "@/lib/bot-template";

export interface DerivedItem {
  id: string;
  name: string;
  client_name: string;
  status: string;
}

const when = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

/**
 * Aba Herança do bot modelo (D', parte 2b): o que cada derivado pode mudar, os derivados e "novo
 * chatbot deste modelo" (um por cliente ou loja, com o contexto fixo opcional). Redesenho
 * (23/10/2026): cada campo numa chave que salva na hora (travar pergunta antes), os derivados e as
 * versões em linhas, e o Novo chatbot num modal com o contexto em pares de nome e valor.
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
  // as chaves salvam juntas (o setTemplateUnlockedAction lê todos os campos): cada uma leva as outras liberadas
  const others = (skip: TemplateField): Record<string, string> => Object.fromEntries(unlocked.filter((f) => f !== skip).map((f) => [`f_${f}`, "on"]));
  return (
    <div className="flex flex-col gap-5">
      {/* o botão fica no alto, ao lado do título, sem quebrar a linha (rodada 2 das telas) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 max-w-[720px] flex-1">
          <h2 className="text-[22px] font-medium">Herança</h2>
          <p className="text-sm text-muted">Cada chatbot criado deste modelo recebe o que você publica aqui: a personalidade, as instruções, os assuntos do negócio, as ações, os roteiros e a base de conhecimento. Ele fica com o próprio cliente, os canais, o horário e o destino do atendimento e o contexto fixo.</p>
        </div>
        {manage && (
          <DialogButton label="Novo chatbot deste modelo" icon={<Plus size={15} />} className="btn-primary shrink-0 self-start whitespace-nowrap" title="Novo chatbot deste modelo" description="Um por cliente ou loja. Ele nasce com a versão em uso do modelo." action={createDerived} saveLabel="Criar chatbot" size="lg">
            <ClientPicker clients={clients} defaultClientId={null} idPrefix="deriv" />
            <div className="flex flex-col gap-1.5">
              <span className="label">Contexto fixo (opcional): a loja ou o cliente no seu sistema</span>
              <KeyValueField name="fixed_context" initial={null} typed keyLabel="Nome" keyPlaceholder="loja_id" valuePlaceholder="42" empty="Sem contexto fixo. Ex.: loja_id com o número da loja na plataforma." />
            </div>
          </DialogButton>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <SettingGroup title="O que cada chatbot derivado pode mudar">
          {TEMPLATE_FIELDS.map((f) => {
            const on = unlocked.includes(f);
            return (
              <SettingRow
                key={f}
                icon={<Unlock size={18} />}
                title={TEMPLATE_FIELD_LABEL[f]}
                summary={on ? "Liberado: cada derivado pode mudar" : "Travado: vem do modelo"}
                summaryTone={on ? "ok" : "muted"}
                trailing={
                  manage ? (
                    <AutoSwitch
                      checked={on}
                      action={saveUnlocked}
                      name={`f_${f}`}
                      fields={others(f)}
                      label={TEMPLATE_FIELD_LABEL[f]}
                      confirmOff={{ title: `Travar ${TEMPLATE_FIELD_LABEL[f].toLowerCase()}?`, description: "Os derivados voltam ao valor do modelo. O valor que cada um tinha fica guardado e volta se você liberar de novo.", confirmLabel: "Travar", danger: false }}
                    />
                  ) : undefined
                }
              />
            );
          })}
        </SettingGroup>
        <p className="px-1 text-xs text-muted">Na saudação do modelo, o nome da empresa vira o nome do cliente de cada derivado, e o nome do assistente, o de cada um.</p>
      </section>

      <SettingGroup title={`Chatbots derivados · ${derived.length}`}>
        {derived.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhum ainda. Crie o primeiro pelo “Novo chatbot deste modelo”.</p>}
        {derived.map((d) => (
          <Link key={d.id} href={`/painel/bots/${d.id}`} className="group/set flex items-center gap-3 px-4 py-3.5 transition-colors duration-[120ms] hover:bg-raised/40">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-raised text-ink-2">
              <Layers size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-ink">{d.name}</span>
              <span className="mt-0.5 block truncate text-[12.5px] text-muted">{d.client_name}</span>
            </span>
            <Status status={d.status} />
            <ChevronRight size={16} className="shrink-0 text-muted transition-transform duration-[120ms] group-hover/set:translate-x-0.5" />
          </Link>
        ))}
      </SettingGroup>

      <section className="flex flex-col gap-2">
        <SettingGroup title="Versões publicadas">
          {versions.length === 0 && <p className="px-4 py-5 text-sm text-muted">Nenhuma versão ainda: a primeira sai ao publicar ou ao criar o primeiro derivado.</p>}
          {versions.map((v) => (
            <SettingRow
              key={v.id}
              icon={<History size={18} />}
              title={`Versão ${v.number}`}
              summary={`${when(v.publishedAt)}${v.publishedBy ? ` · ${v.publishedBy}` : ""}`}
              trailing={
                v.id === currentVersionId ? (
                  <StatusPill tone="ok">em uso</StatusPill>
                ) : manage ? (
                  <ConfirmAction action={restoreVersion.bind(null, v.id)} title={`Usar a versão ${v.number}?`} description="Os derivados voltam para esta versão. O rascunho do modelo continua como está." confirmLabel="Usar esta versão" danger={false} className="btn-ghost py-1.5 text-xs">
                    Usar esta versão
                  </ConfirmAction>
                ) : undefined
              }
            />
          ))}
        </SettingGroup>
        <p className="px-1 text-xs text-muted">O que você muda no modelo fica no rascunho, e o teste ao vivo usa ele. Os derivados só recebem ao publicar (o botão no topo). A base de conhecimento e o que vem pela API valem na hora.</p>
      </section>

      {manage && (
        <p className="text-xs text-muted">
          Pela API (pacote Plataforma): <code>POST /v1/bots</code> com <code className="select-all">{`"template_id": "bot_${templateId}"`}</code>, um cliente criado por <code>POST /v1/clients</code> e o contexto e os dados de cada loja. Veja em{" "}
          <Link href="/docs/api/provisionamento" className="font-semibold text-brand underline">
            Lojas pela API
          </Link>
          .
        </p>
      )}
    </div>
  );
}
