import { Store, Tags } from "lucide-react";
import { ActionForm } from "@/components/ui/action-form";
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
 * Contexto fixo e dados da loja do chatbot (D', partes 1 e 4a), na aba Ações (redesenho, etapa 5:
 * em linhas que abrem um modal, com pares de nome e valor no lugar do JSON). O contexto vai em toda
 * chamada de ação e escolhe as fontes com a mesma etiqueta (a IA não vê); os dados da loja são o que
 * a IA sabe da unidade (nome, horário) e não vão para as ações. Um formulário só: o servidor lê os
 * dois campos juntos (saveFixedContext).
 */
export function FixedContextCard({ value, display, manage, save }: { value: unknown; display: unknown; manage: boolean; save: (fd: FormData) => Promise<ActionResult> }) {
  const label = pairs(value);
  const shown = pairs(display);
  const count = (v: unknown) => Object.keys(asContext(v) ?? {}).length;
  const rows = (
    <>
      <SettingRow
        icon={<Store size={18} />}
        title="O que a IA sabe da loja"
        summary={shown || "Nada além da base: o nome da unidade, o horário, o endereço…"}
        description="Dados desta unidade que a IA usa nas respostas, além da base de conhecimento: o nome, o horário, o endereço. Não vão para as ações. Quem integra pela API envia como display."
        size="lg"
      >
        {manage ? (
          <KeyValueField
            name="fixed_display"
            initial={display}
            suggestions={DISPLAY_SUGGESTIONS}
            keyLabel="Informação"
            keyPlaceholder="horario"
            valuePlaceholder="terça a domingo, das 18h às 23h"
            empty="Nenhum dado ainda. Comece por um dos atalhos abaixo."
          />
        ) : null}
      </SettingRow>
      <SettingRow
        icon={<Tags size={18} />}
        title="Identificação nas ações (contexto)"
        summary={label || "Nenhuma: as ações vão sem contexto fixo"}
        description="Vai em toda chamada de ação deste chatbot (no campo context), para o sistema saber de qual loja ou cliente é, por cima do contexto do token ou do pareamento. A IA não vê. Também escolhe as fontes enviadas pela API com a mesma etiqueta."
        size="lg"
      >
        {manage ? (
          <KeyValueField
            name="fixed_context"
            initial={value}
            typed
            keyLabel="Nome"
            keyPlaceholder="loja_id"
            valuePlaceholder="42"
            empty="Sem contexto fixo. Ex.: loja_id com o número da loja na plataforma."
          />
        ) : null}
      </SettingRow>
    </>
  );
  return (
    <section className="mt-5 flex max-w-[860px] flex-col gap-2">
      {manage ? (
        <ActionForm action={save}>
          <SettingGroup title={`Dados deste chatbot${count(value) + count(display) ? "" : " (opcional)"}`}>{rows}</SettingGroup>
        </ActionForm>
      ) : (
        <SettingGroup title="Dados deste chatbot">
          <SettingRow icon={<Store size={18} />} title="O que a IA sabe da loja" summary={shown || "Nada além da base"} />
          <SettingRow icon={<Tags size={18} />} title="Identificação nas ações (contexto)" summary={label || "Nenhuma"} />
        </SettingGroup>
      )}
    </section>
  );
}
