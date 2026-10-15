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
 * Portão nos componentes (WhatsApp e Instagram), como no texto: opção, card ou link com item
 * proibido sai; com item 18+ sem o "Sim", sai e `offerAdult` pede o botão "Ver opções 18+"; dado
 * de pagamento numa conversa com esses itens sai. Pura.
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
    // as opções da IA (op_N) são renumeradas; os outros ids (Confirmar de uma ação, botões do
    // portão) seguem como vieram: o clique é resolvido por eles
    // a lista continua lista (o rótulo do botão e as descrições ficam), só sem os itens barrados
    component = kept.length ? { ...c, options: kept.map((o, i) => ({ ...o, id: /^op_\d+$/.test(o.id) ? `op_${i + 1}` : o.id })) } : null;
  } else if (c?.type === "link") {
    component = passes(`${c.label} ${c.url}`) ? c : null;
  } else if (c?.type === "carousel") {
    // card a card (é estrutural): o card com item proibido ou 18+ sem o "Sim" sai inteiro, e os
    // outros ficam como vieram (mesmo tipo e quantidade de botões); 1 card vira mensagem com imagem
    const kept = c.cards.filter((card) => passes([card.title, card.text, ...(card.buttons ?? []).map((b) => b.title), card.link ? `${card.link.label} ${card.link.url}` : null].filter(Boolean).join("\n")));
    component = kept.length ? { type: "carousel", cards: kept } : null;
  }
  return { component, prohibited: [...prohibited], regulated: [...regulated], offerAdult: regulated.size > 0 && input.age === null };
}
