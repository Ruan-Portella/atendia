import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UIMessage } from "ai";
import { AGE_NO, AGE_YES, AGE_NO_REASK_DAYS, ageNote, getAge, resetAge, setAge } from "../gate/age";
import { decideEntrance, parseClassification, type Classification } from "../gate/entrance";
import { isChatLink, regulatedChannelNote, regulatedDestination } from "../gate/sales-channel";
import { ageAnswer, historyUpTo } from "../gate/flow";
import { gatedContext, hiddenNote } from "../gate/context";
import { scopeReminder } from "../ai";
import type { GateCategory } from "../gate/rules";

/* ------------------------------------------------------------------ canal de venda de regulamentados */

describe("canal para bebida e remédio", () => {
  it("link de WhatsApp ou de DM nunca serve", () => {
    for (const u of ["https://wa.me/5521999990000", "https://api.whatsapp.com/send?phone=55", "https://chat.whatsapp.com/abc", "https://ig.me/m/bardoze", "https://m.me/bardoze", "https://www.instagram.com/direct/inbox", "https://www.messenger.com/t/x"]) {
      expect(isChatLink(u), u).toBe(true);
    }
    for (const u of ["https://bardoze.com.br/cardapio", "https://www.ifood.com.br/delivery/rio/bar-do-ze", "https://ze.delivery/x", "https://www.instagram.com/bardoze"]) expect(isChatLink(u), u).toBe(false);
  });

  it("ordem única: site → app → telefone → retirada (só com endereço)", () => {
    expect(regulatedDestination({ site: "https://bardoze.com.br", app: "https://ifood.com.br/x", phone: "(21) 3333-4444", pickup: true }, "Rua A, 1")).toEqual({ canal: "site", destino: "https://bardoze.com.br" });
    expect(regulatedDestination({ app: "https://ifood.com.br/x", phone: "(21) 3333-4444" })).toEqual({ canal: "app", destino: "https://ifood.com.br/x" });
    expect(regulatedDestination({ site: "https://wa.me/55219", phone: "(21) 3333-4444" })?.destino).toBe("ligue para (21) 3333-4444");
    expect(regulatedDestination({ pickup: true }, "Rua A, 1")?.destino).toBe("retirada em Rua A, 1");
    expect(regulatedDestination({ pickup: true }, null)).toBeNull();
    expect(regulatedDestination(null)).toBeNull();
  });

  it("nota do prompt: manda o caminho e nunca anota o pedido; sem canal, usa o da base", () => {
    const withSite = regulatedChannelNote({ site: "https://bardoze.com.br/cardapio" });
    expect(withSite).toContain("https://bardoze.com.br/cardapio");
    expect(withSite).toContain("nunca anote o pedido");
    const none = regulatedChannelNote(null);
    expect(none).toContain("CONTEXTO");
    expect(none).toContain("Esse item não conseguimos vender por aqui.");
  });
});

/* ------------------------------------------------------------------ base que a IA vê */

describe("base sem os itens barrados", () => {
  const MENU = [
    "[1] Cardápio",
    "Bar do Zé - Cardápio",
    "Pizzas: calabresa R$ 45, marguerita R$ 42.",
    "Bebidas sem álcool: refrigerante lata R$ 6, suco natural R$ 9.",
    "Cervejas: Heineken long neck R$ 12, Brahma lata R$ 7.",
    "Drinks: caipirinha de limão R$ 18. Sobremesa: pudim R$ 12.",
    "Vendemos também cigarro avulso.",
    "Camisa cor vinho R$ 80.",
    "Pedidos pelo site: bardoze.com.br/cardapio ou pelo iFood.",
  ].join("\n");
  const view = (age: "sim" | "nao" | null, contactPhone = "5521999990000") => gatedContext(MENU, { channel: "whatsapp", contactPhone, age });

  it("sem 18+ confirmado: some bebida (por frase) e proibido; o resto fica", () => {
    const v = view(null);
    for (const t of ["Heineken", "Brahma", "caipirinha", "cigarro"]) expect(v.context).not.toContain(t);
    for (const t of ["calabresa", "refrigerante", "Sobremesa: pudim R$ 12.", "cor vinho", "bardoze.com.br/cardapio", "[1] Cardápio"]) expect(v.context).toContain(t);
    expect(v.hidden.sort()).toEqual(["bebida", "tabaco"]);
    expect(view("nao").context).toBe(v.context);
  });

  it("com 18+ confirmado: bebida volta, proibido continua fora", () => {
    const v = view("sim");
    expect(v.context).toContain("Heineken long neck R$ 12");
    expect(v.context).toContain("caipirinha");
    expect(v.context).not.toContain("cigarro");
    expect(v.hidden).toEqual(["tabaco"]);
  });

  it("WhatsApp de fora do Brasil: bebida some mesmo com Sim", () => {
    expect(view("sim", "14155550123").context).not.toContain("Heineken");
  });

  it("nota dos itens ocultos só quando bebida ou remédio ficaram de fora", () => {
    expect(hiddenNote(["bebida"], null)).toContain("pedir_confirmacao_18");
    expect(hiddenNote(["bebida"], "nao")).toContain("não tem 18 anos");
    expect(hiddenNote(["bebida"], "sim")).toBeNull();
    expect(hiddenNote(["tabaco"], null)).toBeNull();
    expect(hiddenNote([], null)).toBeNull();
  });

  it("lembrete final leva as linhas do portão só quando pedido", () => {
    expect(scopeReminder("Bar do Zé")).not.toContain("18");
    expect(scopeReminder("Bar do Zé", ["linha do portão"])).toMatch(/\n- linha do portão$/);
  });
});

/* ------------------------------------------------------------------ portão na entrada */

const classifyAs = (pedidas: GateCategory[], tem_outro_assunto = false) => vi.fn(async (): Promise<Classification> => ({ pedidas, tem_outro_assunto }));
const BAR = "Cervejas: Heineken long neck R$ 12, Brahma lata R$ 7. Pizzas: calabresa R$ 45.";
const entrance = (text: string, o: Partial<Parameters<typeof decideEntrance>[0]> = {}) =>
  decideEntrance({ text, channel: "whatsapp", contactPhone: "5521999990000", age: null, context: BAR, companyName: "Bar do Zé", classify: classifyAs([]), ...o });

describe("portão na entrada", () => {
  it("sem nada no dicionário: segue para a IA sem chamar o classificador", async () => {
    const classify = classifyAs([]);
    expect(await entrance("quanto custa a pizza?", { classify })).toEqual({ kind: "ia", regulated: [], prohibited: [] });
    expect(classify).not.toHaveBeenCalled();
  });

  it("só pedido proibido: texto fixo, sem IA principal", async () => {
    expect(await entrance("vocês vendem cigarro?", { classify: classifyAs(["tabaco"]) })).toEqual({ kind: "proibido", categories: ["tabaco"] });
  });

  it("proibido junto com outro assunto: aviso fixo antes e instrução para não citar o item", async () => {
    const d = await entrance("qual o horário? e vendem cigarro?", { classify: classifyAs(["tabaco"], true) });
    expect(d.kind).toBe("ia");
    if (d.kind !== "ia") return;
    expect(d.prefix).toBe("Um dos itens que você pediu não conseguimos atender por aqui.");
    expect(d.instruction).toContain("não cite o item");
  });

  it("pede bebida, idade não confirmada e a base tem o item: pergunta de 18+ direto", async () => {
    expect(await entrance("tem Heineken?", { classify: classifyAs(["bebida"]) })).toEqual({ kind: "pede_18", categories: ["bebida"] });
  });

  it("pede bebida que a base não tem: a IA decide (sem atalho)", async () => {
    const d = await entrance("tem cerveja?", { classify: classifyAs(["bebida"]), context: "Pizzas: calabresa R$ 45." });
    expect(d).toMatchObject({ kind: "ia", regulated: ["bebida"], prohibited: [] });
  });

  it("disse que não tem 18: instrução para não falar do item", async () => {
    const d = await entrance("tem Heineken?", { classify: classifyAs(["bebida"]), age: "nao" });
    expect(d.kind).toBe("ia");
    if (d.kind === "ia") expect(d.instruction).toContain("não tem 18 anos");
  });

  it("confirmou 18+: segue sem instrução extra", async () => {
    expect(await entrance("tem Heineken?", { classify: classifyAs(["bebida"]), age: "sim" })).toEqual({ kind: "ia", prefix: undefined, instruction: undefined, regulated: ["bebida"], prohibited: [] });
  });

  it("só menciona (não pede): nada", async () => {
    expect(await entrance("bebi cerveja ontem, posso tomar dipirona?", { classify: classifyAs([], true) })).toEqual({ kind: "ia", prefix: undefined, instruction: undefined, regulated: [], prohibited: [] });
  });

  it("WhatsApp de fora do Brasil: bebida vira proibido", async () => {
    expect(await entrance("tem Heineken?", { classify: classifyAs(["bebida"]), contactPhone: "14155550123" })).toEqual({ kind: "proibido", categories: ["bebida"] });
  });

  it("resposta do classificador: só \"menciona\" tira a categoria; o resto conta como pedido", () => {
    expect(parseClassification('{"categorias": {"tabaco": "pede"}, "tem_outro_assunto": true}', ["tabaco"])).toEqual({ pedidas: ["tabaco"], tem_outro_assunto: true });
    expect(parseClassification('{"categorias": {"bebida": "menciona", "medicamento": "Menciona"}, "tem_outro_assunto": true}', ["bebida", "medicamento"])).toEqual({ pedidas: [], tem_outro_assunto: true });
    // categoria esquecida ou valor estranho: pedida
    expect(parseClassification('{"categorias": {"bebida": "menciona"}}', ["bebida", "tabaco"])).toEqual({ pedidas: ["tabaco"], tem_outro_assunto: false });
    expect(parseClassification('```json\n{"categorias": {"tabaco": "talvez"}}\n```', ["tabaco"]).pedidas).toEqual(["tabaco"]);
    // resposta quebrada: tudo pedido
    expect(parseClassification("não sei", ["tabaco"])).toEqual({ pedidas: ["tabaco"], tem_outro_assunto: true });
  });

  it("o classificador só recebe o que o dicionário acusou", async () => {
    const classify = classifyAs(["bebida"]);
    await entrance("tem Heineken?", { classify });
    expect(classify).toHaveBeenCalledWith("tem Heineken?", ["bebida"], "Bar do Zé");
  });
});

/* ------------------------------------------------------------------ resposta da pergunta de 18+ */

describe("resposta da pergunta de 18+", () => {
  const now = Date.parse("2026-10-01T12:00:00Z");
  const pending = { question: "tem Heineken?", askedAt: "2026-10-01T11:00:00Z" };

  it("botão vale sempre", () => {
    expect(ageAnswer("Sim", AGE_YES, null, now)).toBe("sim");
    expect(ageAnswer("Não", AGE_NO, null, now)).toBe("nao");
  });

  it("digitado só com a pergunta em aberto, até 24 h", () => {
    for (const t of ["sim", "Sim!", "S", "tenho sim", "sou maior de idade"]) expect(ageAnswer(t, null, pending, now), t).toBe("sim");
    for (const t of ["não", "nao", "N", "não tenho", "sou menor"]) expect(ageAnswer(t, null, pending, now), t).toBe("nao");
    expect(ageAnswer("sim", null, null, now)).toBeNull();
    expect(ageAnswer("sim", null, { question: null, askedAt: pending.askedAt }, now)).toBeNull();
    expect(ageAnswer("sim", null, { ...pending, askedAt: "2026-09-29T11:00:00Z" }, now)).toBeNull();
  });

  it("frase que não é resposta direta não conta", () => {
    for (const t of ["sim, e quanto custa?", "quero uma pizza", "não sei"]) expect(ageAnswer(t, null, pending, now), t).toBeNull();
  });

  it("depois do Sim, o histórico vai até a pergunta que ficou esperando", () => {
    const msg = (id: string, role: "user" | "assistant", text: string): UIMessage => ({ id, role, parts: [{ type: "text", text }] });
    const history = [msg("1", "user", "oi"), msg("2", "assistant", "Olá!"), msg("3", "user", "tem Heineken?"), msg("4", "assistant", "Antes de continuar: você tem 18 anos ou mais?"), msg("5", "user", "Sim")];
    expect(historyUpTo(history, "tem Heineken?").map((m) => m.id)).toEqual(["1", "2", "3"]);
    const missing = historyUpTo(history.slice(0, 2), "tem Heineken?");
    expect(missing.at(-1)).toMatchObject({ role: "user", parts: [{ type: "text", text: "tem Heineken?" }] });
  });
});

/* ------------------------------------------------------------------ idade gravada */

/** Banco de mentira só com o que age.ts usa (contact_ages). */
function fakeDb() {
  const rows = new Map<string, { status: string; decided_at: string; source: string }>();
  const db = {
    from: () => {
      const f: Record<string, string> = {};
      let del = false;
      const q = {
        select: () => q,
        eq: (k: string, v: string) => ((f[k] = v), q),
        maybeSingle: async () => ({ data: rows.get(`${f.bot_id}:${f.contact_hash}`) ?? null }),
        upsert: async (row: { bot_id: string; contact_hash: string; status: string; decided_at: string; source: string }) => (rows.set(`${row.bot_id}:${row.contact_hash}`, row), { error: null }),
        delete: () => ((del = true), q),
        then: (resolve: (v: unknown) => void) => {
          if (del) rows.delete(`${f.bot_id}:${f.contact_hash}`);
          resolve({ error: null });
        },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, rows };
}

describe("idade do contato", () => {
  beforeEach(() => vi.stubEnv("CONTACT_HASH_KEY", "chave-de-teste-com-16+"));
  afterEach(() => vi.unstubAllEnvs());
  const who = { botId: "bot-1", channel: "whatsapp" as const, contact: "5521999990000" };

  it("sem resposta: não confirmada", async () => {
    expect(await getAge(fakeDb().db, who)).toBeNull();
  });

  it("Sim fica gravado e vale com e sem o 9", async () => {
    const { db } = fakeDb();
    await setAge(db, who, "sim");
    expect(await getAge(db, who)).toBe("sim");
    expect(await getAge(db, { ...who, contact: "552199990000" })).toBe("sim");
    expect(await getAge(db, { ...who, botId: "outro-bot" })).toBeNull();
  });

  it("o Não sempre vence um Sim depois", async () => {
    const { db } = fakeDb();
    await setAge(db, who, "nao");
    await setAge(db, who, "sim");
    expect(await getAge(db, who)).toBe("nao");
  });

  it(`Não com mais de ${AGE_NO_REASK_DAYS} dias volta a ser não confirmada`, async () => {
    const { db } = fakeDb();
    await setAge(db, who, "nao");
    expect(await getAge(db, who, Date.now() + (AGE_NO_REASK_DAYS + 1) * 86_400_000)).toBeNull();
    expect(await getAge(db, who, Date.now() + (AGE_NO_REASK_DAYS - 1) * 86_400_000)).toBe("nao");
  });

  it("zerar pelo painel apaga a resposta", async () => {
    const { db } = fakeDb();
    await setAge(db, who, "sim");
    await resetAge(db, who);
    expect(await getAge(db, who)).toBeNull();
  });

  it("nota do prompt para cada estado", () => {
    expect(ageNote(null)).toContain("pedir_confirmacao_18");
    expect(ageNote("nao")).toContain("NÃO tem 18 anos");
    expect(ageNote("sim")).toContain("sem fechar a venda aqui");
  });
});
