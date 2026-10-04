/*
 * Cifra por campo do que vem do contato (spec "Cifra por campo"; leva S). Na S: AES-256-GCM na
 * aplicação com a chave do cliente, formato "v2.<escopo e versão>.<iv>.<tag>.<dado>" e dado
 * adicional autenticado igual a "tabela.coluna". Até lá, grava o valor sem cifra (protegido pela
 * cifra de disco do Supabase e pela RLS), e a migração da S cifra tudo de uma vez; a leitura vai
 * reconhecer os dois formatos pelo cabeçalho.
 *
 * Só a camada única chama estas funções (messages.ts e contacts.ts): a cifra entra num lugar só.
 */

/** Colunas com conteúdo do contato, cifradas na S. */
export type CipherField = "messages.content" | "contacts.phone_enc" | "contacts.wa_user_enc" | "contacts.ig_enc" | "contacts.external_id_enc" | "conversations.context_enc";

/** Valor como vai para o banco. Hoje: sem cifra. */
export function sealField(_field: CipherField, value: string): string {
  return value;
}

/** Valor como sai do banco. Hoje: sem cifra. */
export function openField(_field: CipherField, value: string): string {
  return value;
}

/** sealField que aceita vazio (coluna nula continua nula). */
export const sealNullable = (field: CipherField, value: string | null | undefined): string | null => (value ? sealField(field, value) : null);
