import type { IdMap } from "./action-gate";

/*
 * O carrinho do catálogo da Meta (mensagem do tipo order no WhatsApp; itens menores da conferência
 * de 20/10, parte 3; spec, Conformidade: "mensagem do tipo order com item regulamentado é tratada
 * como pedido misto"). O pedido vira texto para a IA e para o portão; a Meta só manda o código de
 * cada item (product_retailer_id), então os itens que as ações já mostraram na conversa ganham o
 * nome pelo mapa de ids (com a categoria: bebida ou remédio no carrinho pede o 18+ e vai para o
 * site, como num pedido misto escrito). Item que nunca apareceu fica só com o código: na
 * coexistência, o caminho é tirar a bebida do catálogo do app.
 */

export const ORDER_MARK = "[Pedido pelo carrinho do WhatsApp]";

export interface OrderPayload {
  catalog_id?: string;
  text?: string;
  product_items?: Array<{ product_retailer_id?: string; quantity?: number | string; item_price?: number | string; currency?: string }>;
}

const money = (v: number, currency = "BRL") => {
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency }).format(v);
  } catch {
    return v.toFixed(2);
  }
};

/** O carrinho como texto: "[Pedido pelo carrinho do WhatsApp] 2× ABC (R$ 10,00 cada); 1× XYZ. Observação: …". Pura. */
export function orderText(o: OrderPayload | undefined | null): string | null {
  const items = (o?.product_items ?? []).filter((i) => i.product_retailer_id);
  if (!items.length) return null;
  const lines = items.map((i) => {
    const qty = Number(i.quantity) > 0 ? Number(i.quantity) : 1;
    const price = Number(i.item_price);
    return `${qty}× ${String(i.product_retailer_id).slice(0, 80)}${Number.isFinite(price) && price > 0 ? ` (${money(price, i.currency || "BRL")} cada)` : ""}`;
  });
  const note = o?.text?.trim() ? ` Observação: ${o.text.trim().slice(0, 500)}` : "";
  return `${ORDER_MARK} ${lines.join("; ")}.${note}`;
}

export const isOrderText = (t: string | null | undefined) => Boolean(t?.startsWith(ORDER_MARK));

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Os códigos que as ações já mostraram ganham o nome ("2× Cerveja Heineken 350 ml (SKU-9)"). Pura. */
export function orderWithLabels(text: string, map: IdMap): string {
  if (!isOrderText(text)) return text;
  let out = text;
  for (const [id, entry] of Object.entries(map)) {
    if (!entry.rotulo) continue;
    out = out.replace(new RegExp(`(\\d+× )${escape(id)}(?=[ ;.(])`, "g"), `$1${entry.rotulo} (${id})`);
  }
  return out;
}
