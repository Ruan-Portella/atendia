import { describe, expect, it } from "vitest";
import { memoryDb } from "../memory-db";
import { findContactIds } from "../contacts";
import { findLeadsByContact, nationalDigits } from "../leads";
import { loadBotActions } from "../action-tools";

/*
 * Pedido de titular pelo painel (relatório de segurança de 23/10/2026, M1 e M2): o e-mail compara
 * ao pé da letra e o telefone pelo número inteiro, com DDD. Antes, joao_silva levava joao.silva
 * junto e 21 99999-0000 levava os leads de 11 99999-0000 (sem desfazer).
 */

describe("pedido de titular: só a pessoa certa", () => {
  it("e-mail: _ e % não são curingas", async () => {
    const db = memoryDb({
      contacts: [
        { id: "k1", bot_id: "b1", email: "joao_silva@x.com" },
        { id: "k2", bot_id: "b1", email: "joao.silva@x.com" },
        { id: "k3", bot_id: "b1", email: "JOAO_SILVA@X.COM" },
      ],
      leads: [
        { id: "l1", bot_id: "b1", email: "joao_silva@x.com", conversation_id: "c1" },
        { id: "l2", bot_id: "b1", email: "joaoXsilva@x.com", conversation_id: "c2" },
      ],
    });
    expect((await findContactIds(db, ["b1"], { email: "joao_silva@x.com" })).sort()).toEqual(["k1", "k3"]);
    expect(await findContactIds(db, ["b1"], { email: "%@%.%" })).toEqual([]);
    expect((await findLeadsByContact(db, ["b1"], { email: "joao_silva@x.com" })).map((l) => l.id)).toEqual(["l1"]);
  });

  it("telefone: o número inteiro com DDD, com ou sem +55 e formatação", async () => {
    expect(nationalDigits("+55 (21) 99999-0000")).toBe("21999990000");
    expect(nationalDigits("21999990000")).toBe("21999990000");
    expect(nationalDigits("(21) 3333-4444")).toBe("2133334444");
    const db = memoryDb({
      leads: [
        { id: "rio", bot_id: "b1", phone: "(21) 99999-0000", phone_enc: null, conversation_id: "c1" },
        { id: "rio-55", bot_id: "b1", phone: "+55 21 99999-0000", phone_enc: null, conversation_id: "c2" },
        { id: "sp", bot_id: "b1", phone: "11999990000", phone_enc: null, conversation_id: "c3" },
        { id: "bh", bot_id: "b1", phone: "31 99999-0000", phone_enc: null, conversation_id: "c4" },
      ],
    });
    const found = await findLeadsByContact(db, ["b1"], { phone: "21 99999-0000", phoneHash: null });
    expect(found.map((l) => l.id).sort()).toEqual(["rio", "rio-55"]);
    // sem DDD não casa com nenhum (o painel pede o DDD antes)
    expect(await findLeadsByContact(db, ["b1"], { phone: "99999-0000", phoneHash: null })).toEqual([]);
  });
});

describe("ações de outra conta (relatório de segurança de 23/10/2026, C1)", () => {
  const tables = () => ({
    bots: [
      { id: "vitima", agency_id: "B", template_id: null },
      { id: "meu", agency_id: "A", template_id: null, config_bot_id: "vitima" },
    ],
    actions: [{ id: "act-1", bot_id: "vitima", name: "consultar_cpf", active: true }],
    agency_packs: [
      { agency_id: "A", pack: "integracoes", ends_at: null },
      { agency_id: "B", pack: "integracoes", ends_at: null },
    ],
  });

  it("o chatbot apontado para a versão de outra conta não recebe as ações (nem o segredo) dela", async () => {
    const db = memoryDb(tables());
    expect(await loadBotActions(db, { id: "meu", agency_id: "A", config_bot_id: "vitima" })).toEqual([]);
    // a dona continua com as dela
    expect((await loadBotActions(db, { id: "vitima", agency_id: "B" })).map((a) => a.id)).toEqual(["act-1"]);
  });
});
