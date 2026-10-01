/*
 * Canal para itens regulamentados (bebida, MIP): onde o contato finaliza o pedido, porque no
 * WhatsApp e no Instagram a venda nunca fecha no chat. Ordem única (aba Textos legais): link
 * direto (site ou marketplace) → telefone para ligação → retirada (só com endereço) → "Esse item
 * não conseguimos vender por aqui.". Nunca WhatsApp nem DM.
 */

export interface RegulatedChannel {
  /** Link direto do item ou do cardápio no site. */
  site?: string | null;
  /** Link de app ou marketplace (iFood, Zé Delivery, Rappi, aiqfome). */
  app?: string | null;
  /** Telefone para ligação (o bot sempre escreve "ligue para"). */
  phone?: string | null;
  /** Retirada no local (precisa de endereço cadastrado no Atendimento humano). */
  pickup?: boolean | null;
}

/** Links de WhatsApp e de DM não servem: a venda iria para o chat de novo. */
export function isChatLink(url: string): boolean {
  return /(^|\/\/|\.)(wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|whatsapp\.com|ig\.me|m\.me|messenger\.com)\b|instagram\.com\/direct/i.test(url);
}

/** Para onde o bot manda finalizar ("finalize aqui"), na ordem única. null = não vende por aqui. */
export function regulatedDestination(ch: RegulatedChannel | null | undefined, address?: string | null): { canal: string; destino: string } | null {
  if (!ch) return null;
  if (ch.site && !isChatLink(ch.site)) return { canal: "site", destino: ch.site };
  if (ch.app && !isChatLink(ch.app)) return { canal: "app", destino: ch.app };
  if (ch.phone) return { canal: "telefone", destino: `ligue para ${ch.phone}` };
  if (ch.pickup && address) return { canal: "retirada", destino: `retirada em ${address}` };
  return null;
}

/** Linha para o prompt: como a pessoa finaliza a compra de item regulamentado. */
export function regulatedChannelNote(ch: RegulatedChannel | null | undefined, address?: string | null): string {
  const d = regulatedDestination(ch, address);
  return d
    ? `Para comprar bebida alcoólica ou remédio, a pessoa finaliza fora do chat: ${d.destino}. Mande esse caminho; nunca anote o pedido desses itens, nunca confirme pedido e nunca mande pagamento aqui.`
    : "Para comprar bebida alcoólica ou remédio, indique o site, o app de delivery, o telefone ou a loja que estiverem no CONTEXTO (nunca WhatsApp nem mensagem direta); se não houver nenhum, diga \"Esse item não conseguimos vender por aqui.\". Nunca anote o pedido desses itens nem mande pagamento.";
}
