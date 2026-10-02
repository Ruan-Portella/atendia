import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalPhone } from "../phone";
import { canonicalPhone as suppressionCanonical } from "../suppression";
import { changeWhatsAppIdentity, metaPhoneHash, previousBsuid, typedPhoneHash, whatsappContact, whatsappIdentityOf } from "../contacts";
import { checkHashSentinel } from "../hash";

describe("telefone canônico", () => {
  it("celular brasileiro sempre com o 9; fixo e estrangeiro como estão", () => {
    expect(canonicalPhone("5521999998888")).toBe("5521999998888");
    expect(canonicalPhone("552199998888")).toBe("5521999998888"); // celular antigo, sem o 9
    expect(canonicalPhone("552133334444")).toBe("552133334444"); // fixo (começa com 2 a 5): sem 9
    expect(canonicalPhone("12025550123")).toBe("12025550123"); // EUA, wa_id da Meta: não ganha 55
    expect(canonicalPhone("+55 (21) 9 9999-8888")).toBe("5521999998888");
  });

  it("digitado por alguém: DDD + número ganha o 55", () => {
    expect(canonicalPhone("21 99999-8888", { typed: true })).toBe("5521999998888");
    expect(canonicalPhone("(21) 3333-4444", { typed: true })).toBe("552133334444");
    expect(canonicalPhone("2199998888", { typed: true })).toBe("5521999998888");
  });

  it("recusa o que não é telefone (BSUID, curto ou longo demais)", () => {
    expect(canonicalPhone("BR.1234567890")).toBeNull();
    expect(canonicalPhone("12345")).toBeNull();
    expect(canonicalPhone("1234567890123456")).toBeNull();
    expect(canonicalPhone(null)).toBeNull();
    expect(whatsappIdentityOf("BR.1234567890")).toEqual({ bsuid: "BR.1234567890" });
    expect(whatsappIdentityOf("5521999998888")).toEqual({ phone: "5521999998888" });
  });

  it("a supressão continua igual para o wa_id da Meta (nenhum pedido de SAIR se perde)", () => {
    for (const id of ["5521999998888", "552199998888", "552133334444", "12025550123"]) expect(suppressionCanonical(id)).toBe(canonicalPhone(id));
    expect(suppressionCanonical("BR.123")).toBe("BR.123");
  });

  it("aviso de troca da Meta: o BSUID antigo sai do texto", () => {
    expect(previousBsuid("User Ana changed from BR.111 to BR.222")).toBe("BR.111");
    expect(previousBsuid("algo diferente")).toBeNull();
  });
});

describe("hash do contato", () => {
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16"));
  afterEach(() => vi.unstubAllEnvs());

  it("com e sem o 9, digitado ou vindo da Meta: o mesmo hash; nunca o telefone em texto", () => {
    expect(typedPhoneHash("21 99999-8888")).toBe(metaPhoneHash("552199998888"));
    expect(metaPhoneHash("5521999998888")).toBe(metaPhoneHash("552199998888"));
    expect(metaPhoneHash("5521999998888")).not.toContain("5521");
    expect(metaPhoneHash("BR.123")).toBeNull();
  });

  it("sentinela: grava na primeira vez, confere depois e acusa se a chave mudar", async () => {
    let stored: string | null = null;
    const db = {
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { hash_sentinel: stored } }) }) }),
        update: (v: { hash_sentinel: string }) => ({ eq: async () => ((stored = v.hash_sentinel), { error: null }) }),
      }),
    } as unknown as SupabaseClient;
    expect(await checkHashSentinel(db)).toBe(true);
    expect(stored).toBeTruthy();
    expect(await checkHashSentinel(db)).toBe(true);
    vi.stubEnv("CONTACT_HASH_KEY", "outra-chave-com-mais-de-16-letras");
    expect(await checkHashSentinel(db)).toBe(false);
  });
});

/** Banco falso, só a tabela contacts, com os filtros que a biblioteca usa. */
function fakeContacts() {
  const rows: Array<Record<string, unknown>> = [];
  let seq = 0;
  const query = (filters: Array<(r: Record<string, unknown>) => boolean> = []) => {
    const match = () => rows.filter((r) => filters.every((f) => f(r)));
    const q = {
      select: () => q,
      eq: (k: string, v: unknown) => query([...filters, (r) => r[k] === v]),
      neq: (k: string, v: unknown) => query([...filters, (r) => r[k] !== v]),
      not: (k: string) => query([...filters, (r) => r[k] != null]),
      maybeSingle: async () => ({ data: match()[0] ? { ...match()[0] } : null }),
    };
    return q;
  };
  const table = {
    ...query(),
    insert: (v: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          for (const k of ["phone_hash", "wa_user_hash"]) if (v[k] && rows.some((r) => r.bot_id === v.bot_id && r[k] === v[k])) return { data: null, error: { message: "duplicate key" } };
          const row = { id: `c${++seq}`, first_inbound_at: null, last_inbound_at: null, phone_hash: null, wa_user_hash: null, ig_hash: null, ...v };
          rows.push(row);
          return { data: { ...row }, error: null };
        },
      }),
    }),
    update: (v: Record<string, unknown>) => {
      const run = (filters: Array<(r: Record<string, unknown>) => boolean>) => {
        const chain = {
          eq: (k: string, val: unknown) => run([...filters, (r) => r[k] === val]),
          neq: (k: string, val: unknown) => run([...filters, (r) => r[k] !== val]),
          not: (k: string) => run([...filters, (r) => r[k] != null]),
          then: (resolve: (x: { error: null }) => unknown) => {
            for (const r of rows.filter((x) => filters.every((f) => f(x)))) Object.assign(r, v);
            return resolve({ error: null });
          },
        };
        return chain;
      };
      return run([]);
    },
  };
  return { db: { from: () => table } as unknown as SupabaseClient, rows };
}

describe("ficha do contato do WhatsApp", () => {
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-mais-de-16"));
  afterEach(() => vi.unstubAllEnvs());
  const bot = { id: "b1", agency_id: "a1" };

  it("acha o mesmo contato com e sem o 9 e completa o BSUID quando ele aparece", async () => {
    const { db, rows } = fakeContacts();
    const a = await whatsappContact(db, bot, { phone: "552199998888" });
    const b = await whatsappContact(db, bot, { phone: "5521999998888", bsuid: "BR.1" });
    expect(b?.id).toBe(a?.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].wa_user_hash).toBeTruthy();
    // depois, só pelo BSUID (a pessoa ligou o nome de usuário): o mesmo contato
    expect((await whatsappContact(db, bot, { bsuid: "BR.1" }))?.id).toBe(a?.id);
  });

  it("mesmo telefone com outro BSUID, sem o aviso de troca: número reciclado, contato novo", async () => {
    const { db, rows } = fakeContacts();
    const old = await whatsappContact(db, bot, { phone: "5521999998888", bsuid: "BR.1" });
    const fresh = await whatsappContact(db, bot, { phone: "5521999998888", bsuid: "BR.2" });
    expect(fresh?.id).not.toBe(old?.id);
    expect(rows.find((r) => r.id === old?.id)?.phone_hash).toBeNull();
    expect(rows.find((r) => r.id === fresh?.id)?.phone_hash).toBeTruthy();
  });

  it("aviso de troca de número: o mesmo contato fica com o telefone e o BSUID novos", async () => {
    const { db, rows } = fakeContacts();
    const c = await whatsappContact(db, bot, { phone: "5521999998888", bsuid: "BR.1" });
    expect(await changeWhatsAppIdentity(db, "b1", { phone: "5521999998888", bsuid: "BR.1" }, { phone: "5511988887777", bsuid: "BR.9" })).toBe(true);
    expect((await whatsappContact(db, bot, { phone: "5511988887777", bsuid: "BR.9" }))?.id).toBe(c?.id);
    expect(rows).toHaveLength(1);
  });

  it("sem telefone nem BSUID: nenhum contato", async () => {
    const { db } = fakeContacts();
    expect(await whatsappContact(db, bot, {})).toBeNull();
  });
});
