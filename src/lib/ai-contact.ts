import { AsyncLocalStorage } from "node:async_hooks";
import { hmacHex } from "./hash";

/*
 * Identificador do contato nas chamadas ao provedor de IA (spec, Infraestrutura, queda do provedor;
 * leva Pendências do MVP, parte 1): toda chamada feita enquanto o BoaVoz cuida da mensagem de um
 * contato leva um HMAC de chatbot e contato (o `safety_identifier` da OpenAI), nunca o telefone. Se
 * a OpenAI bloquear esse identificador por abuso, só as chamadas daquele contato falham: a conversa
 * dele cai no caminho de sempre da falha de IA (vira pedido de atendente) e as dos outros contatos
 * seguem. O BoaVoz nunca troca de provedor por isso (senão o abuso passava para a conta reserva).
 * O identificador vai pelo contexto da execução: quem atende um contato embrulha o trabalho em
 * withContactId, e modelCallOptions (ai.ts) lê daqui, sem passar o contato de função em função.
 */

const scope = new AsyncLocalStorage<string>();

/** O identificador de um contato num chatbot (32 caracteres hex), ou null sem a chave de hash. */
export function contactSafetyId(botId: string, contactKey: string): string | null {
  try {
    return hmacHex(`ia:${botId}:${contactKey}`).slice(0, 32);
  } catch {
    return null;
  }
}

/** Roda fn com o identificador do contato valendo para as chamadas de IA feitas dentro dela. */
export function withContactId<T>(botId: string, contactKey: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  const id = contactKey ? contactSafetyId(botId, contactKey) : null;
  return id ? scope.run(id, fn) : fn();
}

/** O identificador da execução atual (null fora de withContactId: tarefas sem contato, como a análise do bot). */
export const currentContactId = (): string | null => scope.getStore() ?? null;
