import { Store, Tags } from "lucide-react";
import { SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { KeyValueField } from "@/components/integrations/context-fields";
import type { ActionResult } from "@/lib/action-result";
import { asContext } from "@/lib/bot-context";

/** Os atalhos dos dados da loja mais comuns (o nome do par é o que a IA lê, com "_" virando espaço). */
const DISPLAY_SUGGESTIONS = [
  { key: "nome", label: "Nome da unidade" },
  { key: "endereco", label: "Endereço" },
  { key: "horario", label: "Horário" },
  { key: "telefone", label: "Telefone" },
  { key: "cidade", label: "Cidade" },
];

/** O resumo da linha: "loja_id: 42 · ativo: sim". */
const pairs = (v: unknown) =>
  Object.entries(asContext(v) ?? {})
    .map(([k, x]) => `${k}: ${typeof x === "boolean" ? (x ? "sim" : "não") : String(x)}`)
    .join(" · ");

/**
 * O contexto fixo do chatbot (D', parte 1), na aba Ações (redesenho, etapa 5: uma linha que abre um
 * modal, em pares de nome e valor no lugar do JSON). Vai em toda chamada de ação e escolhe as fontes
 * com a mesma etiqueta; a IA não vê. Os dados da loja (display) ficam na Base de conhecimento
 * (StoreDataRow).
 */
export function FixedContextCard({ value, manage, save }: { value: unknown; manage: boolean; save: (fd: FormData) => Promise<ActionResult> }) {
  const label = pairs(value);
  return (
    <section className="mt-5 flex max-w-[860px] flex-col gap-2">
      <SettingGroup title="Identificação nas ações">
        {manage ? (
          <SettingRow
            icon={<Tags size={18} />}
            title="Contexto fixo"
            summary={label || "Nenhum: as ações vão sem contexto fixo"}
            description="Vai em toda chamada de ação deste chatbot (no campo context), para o sistema saber de qual loja ou cliente é, por cima do contexto do token ou do pareamento. A IA não vê. Também escolhe as fontes enviadas pela API com a mesma etiqueta."
            action={save}
            size="lg"
          >
            <KeyValueField name="fixed_context" initial={value} typed keyLabel="Nome" keyPlaceholder="loja_id" valuePlaceholder="42" empty="Sem contexto fixo. Ex.: loja_id com o número da loja na plataforma." />
          </SettingRow>
        ) : (
          <SettingRow icon={<Tags size={18} />} title="Contexto fixo" summary={label || "Nenhum"} />
        )}
      </SettingGroup>
    </section>
  );
}

/**
 * O que a IA sabe da loja (o display do chatbot, D' parte 4a), na Base de conhecimento: o nome da
 * unidade, o horário, o endereço, em pares de nome e valor. A IA usa nas respostas; não vai para as
 * ações. Vai dentro de um SettingGroup.
 */
export function StoreDataRow({ display, save }: { display: unknown; save: (fd: FormData) => Promise<ActionResult> }) {
  const shown = pairs(display);
  return (
    <SettingRow
      icon={<Store size={18} />}
      title="O que a IA sabe da loja"
      summary={shown || "Nada além das fontes: o nome da unidade, o horário, o endereço…"}
      description="Dados desta unidade que a IA usa nas respostas, além das fontes: o nome, o horário, o endereço. Não vão para as ações. Quem integra pela API envia como display."
      action={save}
      size="lg"
    >
      <KeyValueField name="fixed_display" initial={display} suggestions={DISPLAY_SUGGESTIONS} keyLabel="Informação" keyPlaceholder="horario" valuePlaceholder="terça a domingo, das 18h às 23h" empty="Nenhum dado ainda. Comece por um dos atalhos abaixo." />
    </SettingRow>
  );
}
