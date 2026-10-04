import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "./supabase/admin";

/*
 * Módulo único de chaves (leva S; spec "Auditoria, criptografia e suporte"):
 * - chave mestra da plataforma, com versão. A v1 é a de sempre (sha256 de WHATSAPP_TOKEN_KEY,
 *   que já cifra tokens e segredos); FIELD_MASTER_KEYS="2:<base64 de 32 bytes>,3:…" acrescenta
 *   versões e a maior é a atual. Trocar não exige recifrar: o cabeçalho de cada valor diz a versão;
 * - chave de cada cliente (32 bytes aleatórios), guardada cifrada pela chave mestra em
 *   client_keys. Apagar o cliente apaga a chave (o que ela cifrou fica ilegível, inclusive em
 *   cópias); transferir o cliente para outra agência muda a dona sem recifrar;
 * - a chave de hash (CONTACT_HASH_KEY) é separada, em hash.ts.
 * Só este arquivo lê client_keys (um teste confere).
 */

/** Versões da chave mestra disponíveis. */
export function masterKeys(): Map<number, Buffer> {
  const out = new Map<number, Buffer>();
  const raw = process.env.WHATSAPP_TOKEN_KEY;
  if (raw && raw.length >= 16) out.set(1, createHash("sha256").update(raw).digest());
  for (const part of (process.env.FIELD_MASTER_KEYS ?? "").split(",")) {
    const m = /^\s*(\d+):([A-Za-z0-9+/=_-]+)\s*$/.exec(part);
    if (!m || Number(m[1]) < 2) continue;
    const key = Buffer.from(m[2], "base64");
    if (key.length === 32) out.set(Number(m[1]), key);
  }
  return out;
}

/** A chave mestra atual (a maior versão), ou uma versão específica (para abrir o que já existe). */
export function masterKey(version?: number): { version: number; key: Buffer } {
  const keys = masterKeys();
  if (!keys.size) throw new Error("chave mestra não configurada (WHATSAPP_TOKEN_KEY, mínimo 16 caracteres)");
  const v = version ?? Math.max(...keys.keys());
  const key = keys.get(v);
  if (!key) throw new Error(`chave mestra v${v} não configurada (FIELD_MASTER_KEYS)`);
  return { version: v, key };
}

/** AES-256-GCM: "iv.tag.dado" em base64url, com dado adicional autenticado (aad) opcional. */
export function gcmSeal(key: Buffer, plain: string | Buffer, aad?: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const data = Buffer.concat([c.update(plain), c.final()]);
  return [iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

export function gcmOpen(key: Buffer, packed: string, aad?: string): Buffer {
  const [iv, tag, data] = packed.split(".");
  if (!iv || !tag || data === undefined) throw new Error("valor cifrado em formato desconhecido");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]);
}

/** Cifra com a chave mestra atual: "v1.iv.tag.dado" (versão 1, o formato de sempre) ou "m<versão>.…". */
export function sealWithMaster(plain: string | Buffer): string {
  const { version, key } = masterKey();
  return `${version === 1 ? "v1" : `m${version}`}.${gcmSeal(key, plain)}`;
}

export function openWithMaster(sealed: string): Buffer {
  const dot = sealed.indexOf(".");
  const head = sealed.slice(0, dot);
  const version = head === "v1" ? 1 : /^m(\d+)$/.test(head) ? Number(head.slice(1)) : NaN;
  if (Number.isNaN(version)) throw new Error("segredo em formato desconhecido");
  return gcmOpen(masterKey(version).key, sealed.slice(dot + 1));
}

/* ------------------------------------------------------------------ chave do cliente */

export interface ClientKeyStore {
  /** A chave mais antiga do cliente (a que cifra o que é novo), ou null. */
  find(clientId: string): Promise<{ id: string; key_enc: string } | null>;
  byId(keyId: string): Promise<{ key_enc: string } | null>;
  create(clientId: string, keyEnc: string): Promise<void>;
}

const adminStore: ClientKeyStore = {
  async find(clientId) {
    const { data } = await createAdminClient().from("client_keys").select("id, key_enc").eq("client_id", clientId).order("created_at").limit(1).maybeSingle();
    return data ? { id: String(data.id), key_enc: String(data.key_enc) } : null;
  },
  async byId(keyId) {
    const { data } = await createAdminClient().from("client_keys").select("key_enc").eq("id", keyId).maybeSingle();
    return data ? { key_enc: String(data.key_enc) } : null;
  },
  async create(clientId, keyEnc) {
    const { error } = await createAdminClient().from("client_keys").insert({ client_id: clientId, key_enc: keyEnc });
    if (error) throw new Error(`chave do cliente não criada: ${error.message}`);
  },
};

let store: ClientKeyStore = adminStore;
const TTL_MS = 10 * 60_000;
const forSeal = new Map<string, { id: string; key: Buffer; at: number }>();
const byKeyId = new Map<string, { key: Buffer | null; at: number }>();

/** Troca o lugar das chaves (testes). */
export function setClientKeyStore(s: ClientKeyStore | null): void {
  store = s ?? adminStore;
  forSeal.clear();
  byKeyId.clear();
}

/** A chave que cifra o que é novo deste cliente (criada na primeira vez). */
export async function clientKeyForSeal(clientId: string): Promise<{ id: string; key: Buffer }> {
  const hit = forSeal.get(clientId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit;
  let row = await store.find(clientId);
  if (!row) {
    await store.create(clientId, sealWithMaster(randomBytes(32)));
    // duas criações ao mesmo tempo: vale a mais antiga (as duas abrem, o cabeçalho diz qual)
    row = await store.find(clientId);
    if (!row) throw new Error("chave do cliente não encontrada depois de criada");
  }
  const entry = { id: row.id, key: openWithMaster(row.key_enc), at: Date.now() };
  forSeal.set(clientId, entry);
  byKeyId.set(row.id, { key: entry.key, at: entry.at });
  return entry;
}

/** A chave pelo id do cabeçalho; null se foi apagada (cliente excluído). */
export async function clientKeyById(keyId: string): Promise<Buffer | null> {
  const hit = byKeyId.get(keyId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.key;
  const row = await store.byId(keyId);
  const key = row ? openWithMaster(row.key_enc) : null;
  byKeyId.set(keyId, { key, at: Date.now() });
  return key;
}
