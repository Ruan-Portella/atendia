import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contactLines, handoffNotice, nextOpening } from "../handoff-hours";
import { aiDisclosure } from "../chat";

// segunda a sexta, 9h às 18h (horário de Brasília)
const hours = { "1": ["09:00", "18:00"], "2": ["09:00", "18:00"], "3": ["09:00", "18:00"], "4": ["09:00", "18:00"], "5": ["09:00", "18:00"] } as const;
/** Data em Brasília (UTC-3). 2026-10-02 é sexta. */
const br = (iso: string) => new Date(`${iso}-03:00`);

describe("horário de atendimento", () => {
  it("dentro do horário: sem aviso de volta", () => {
    expect(nextOpening(hours, br("2026-10-02T10:00:00"))).toBeNull();
    expect(handoffNotice(hours, br("2026-10-02T10:00:00"))).toBe("Deixei seu pedido registrado e nossa equipe responde assim que possível.");
  });

  it("sexta à noite: volta segunda às 9h", () => {
    expect(handoffNotice(hours, br("2026-10-02T21:30:00"))).toBe("Nossa equipe volta segunda às 9h. Deixei seu pedido registrado e respondemos assim que possível.");
  });

  it("de madrugada: volta hoje; depois do expediente: amanhã", () => {
    expect(handoffNotice(hours, br("2026-10-01T06:00:00"))).toContain("volta hoje às 9h");
    expect(handoffNotice(hours, br("2026-09-30T19:00:00"))).toContain("volta amanhã às 9h");
  });

  it("sem horário configurado: texto padrão, sem data", () => {
    expect(handoffNotice(null)).toBe("Deixei seu pedido registrado e nossa equipe responde assim que possível.");
    expect(handoffNotice({})).toBe("Deixei seu pedido registrado e nossa equipe responde assim que possível.");
  });

  it("meia hora no horário de abertura", () => {
    expect(handoffNotice({ "6": ["09:30", "12:00"] }, br("2026-10-02T20:00:00"))).toContain("volta amanhã às 9h30");
  });

  it("contatos para o prompt, só os preenchidos", () => {
    expect(contactLines({ phone: "(21) 3333-4444", email: null, site: "clinica.com.br" })).toEqual(["telefone (21) 3333-4444", "site clinica.com.br"]);
    expect(contactLines(null)).toEqual([]);
  });
});

describe("aviso de IA", () => {
  /** Banco de mentira: última mensagem que não é do contato e se a IA já falou. */
  function db(last: { role: string } | null, aiSpoke: boolean) {
    let call = 0;
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => (call++ === 0 ? { data: last } : { data: aiSpoke ? { id: 1 } : null }),
    };
    return { from: () => chain } as unknown as SupabaseClient;
  }
  const bot = { name: "Lia", client_name: "Clínica Sorriso" };

  it("primeira resposta da IA na conversa: se apresenta como assistente virtual", async () => {
    expect(await aiDisclosure(db(null, false), bot, "c1")).toBe("Sou Lia, assistente virtual de Clínica Sorriso.");
    // a equipe abriu com um modelo, mas a IA nunca falou: apresenta (não é "Voltei!")
    expect(await aiDisclosure(db({ role: "agent" }, false), bot, "c1")).toBe("Sou Lia, assistente virtual de Clínica Sorriso.");
  });

  it("voltou de um atendente: \"Voltei!\"; IA falou por último: nada", async () => {
    expect(await aiDisclosure(db({ role: "agent" }, true), bot, "c1")).toBe("Voltei! Sou Lia, assistente virtual. Se precisar, é só pedir um atendente.");
    expect(await aiDisclosure(db({ role: "assistant" }, true), bot, "c1")).toBeNull();
  });
});
