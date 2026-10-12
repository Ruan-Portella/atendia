import { timingSafeEqual } from "node:crypto";
import { hmacHex } from "./hash";
import { appUrl } from "./utils";

/*
 * Link assinado da rota de arquivos (spec "Arquivos", leva S; C pública, parte 3c): quem não tem
 * sessão no painel (a API, o widget do site e, na 3d, os webhooks) abre /api/files/{id}?exp=&sig=.
 * Vale 1 hora e é gerado de novo a cada leitura. A assinatura usa a chave da plataforma com um
 * prefixo próprio (não serve para nenhum outro hash).
 */

export const FILE_LINK_TTL_SECONDS = 3600;

const signature = (id: string, exp: number) => hmacHex(`arquivo:${id}:${exp}`);

/** Link de 1 hora para o arquivo. */
export function signedFileUrl(id: string, now = Date.now()): { url: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + FILE_LINK_TTL_SECONDS;
  return { url: appUrl(`/api/files/${id}?exp=${exp}&sig=${signature(id, exp)}`), expiresAt: new Date(exp * 1000).toISOString() };
}

/** O link assinado vale para este arquivo e ainda não venceu? */
export function validFileLink(id: string, exp: string | null, sig: string | null, now = Date.now()): boolean {
  const e = Number(exp);
  if (!exp || !sig || !Number.isSafeInteger(e) || e * 1000 < now || e * 1000 > now + FILE_LINK_TTL_SECONDS * 1000 + 60_000) return false;
  const want = Buffer.from(signature(id, e));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Anexo de mensagem de atendente no widget: o primeiro arquivo, com o link de 1 hora. */
export interface WidgetFile {
  url: string;
  name: string | null;
  kind: "image" | "document";
}

export function widgetFile(files: Array<{ id: string; doc_type: string; filename: string | null }> | undefined, now = Date.now()): WidgetFile | null {
  const f = files?.[0];
  if (!f) return null;
  return { url: signedFileUrl(f.id, now).url, name: f.filename, kind: f.doc_type === "image" ? "image" : "document" };
}
