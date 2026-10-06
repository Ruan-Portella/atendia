import { checkActionReply, type ExitInput } from "./exit";
import type { GateCategory } from "./rules";
import type { MessageComponent } from "../components";

/*
 * Portão nos botões, lista e link da IA (Peça 10 na Peça 5): no WhatsApp e no Instagram, cada
 * opção e o link passam pela mesma conferência dura do reply de ação. Fica fora de components.ts
 * para o widget (navegador) não levar o dicionário do portão.
 */

export type ComponentGateInput = Omit<ExitInput, "text" | "destination">;

/**
 * Portão nos componentes (WhatsApp e Instagram), como no texto: opção ou link com item proibido
 * sai; com item 18+ sem o "Sim", sai e `offerAdult` pede o botão "Ver opções 18+"; dado de
 * pagamento numa conversa com esses itens sai. Pura.
 */
export function gateComponent(c: MessageComponent | null, input: ComponentGateInput): { component: MessageComponent | null; prohibited: GateCategory[]; regulated: GateCategory[]; offerAdult: boolean } {
  const prohibited = new Set<GateCategory>();
  const regulated = new Set<GateCategory>();
  const passes = (text: string) => {
    const r = checkActionReply({ text, ...input });
    r.prohibited.forEach((x) => prohibited.add(x));
    r.regulated.forEach((x) => regulated.add(x));
    return r.ok;
  };
  let component: MessageComponent | null = c;
  if (c?.type === "options") {
    const kept = c.options.filter((o) => passes(o.title));
    component = kept.length ? { type: "options", options: kept.map((o, i) => ({ id: `op_${i + 1}`, title: o.title })) } : null;
  } else if (c?.type === "link") {
    component = passes(`${c.label} ${c.url}`) ? c : null;
  }
  return { component, prohibited: [...prohibited], regulated: [...regulated], offerAdult: regulated.size > 0 && input.age === null };
}
