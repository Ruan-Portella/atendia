import { describe, expect, it } from "vitest";
import { busiestDay, parseSheetTime, reminderRowsFromCsv, validateReminderRows } from "../reminder-sheet";
import { reminderExclusionOf } from "../campaign-audience";

// 09/10/2026 12:00 em Brasília
const now = new Date("2026-10-09T15:00:00Z");
const row = (o: Partial<{ line: number; phone: string; name: string; date: string; time: string; vars: string[] }> = {}) => ({ line: 2, phone: "21 99999-0000", name: "Ana", date: "15/10/2026", time: "09:30", vars: ["Ana"], ...o });

describe("planilha de lembretes", () => {
  it("lê o cabeçalho com nomes variados e as variáveis em ordem", () => {
    const csv = "﻿Telefone;Nome;Data;Horário;Variável 1;variavel2;extra\r\n21 99999-0000;Ana;15/10/2026;9:30;Ana;15/10\r\n";
    const r = reminderRowsFromCsv(csv);
    expect(r.hasPhone && r.hasDate).toBe(true);
    expect(r.unknown).toEqual(["extra"]);
    expect(r.rows[0]).toEqual({ line: 2, phone: "21 99999-0000", name: "Ana", date: "15/10/2026", time: "9:30", vars: ["Ana", "15/10"] });
  });

  it("hora em vários formatos", () => {
    expect(parseSheetTime("14:30")).toEqual([14, 30]);
    expect(parseSheetTime("9h05")).toEqual([9, 5]);
    expect(parseSheetTime("14h")).toEqual([14, 0]);
    expect(parseSheetTime("1430")).toEqual([14, 30]);
    expect(parseSheetTime("25:00")).toBeNull();
    expect(parseSheetTime("manhã")).toBeNull();
  });

  it("data e hora no fuso do cliente; fora de 8h a 20h só avisa", () => {
    const { valid, errors } = validateReminderRows([row(), row({ line: 3, time: "21:00" })], { vars: 1, tz: "America/Sao_Paulo", now });
    expect(errors).toEqual([]);
    expect(valid[0]).toMatchObject({ phone: "5521999990000", sendAt: "2026-10-15T12:30:00.000Z", local: "15/10/2026 09:30", offHours: false, variables: ["Ana"] });
    expect(valid[1].offHours).toBe(true);
    const manaus = validateReminderRows([row()], { vars: 1, tz: "America/Manaus", now });
    expect(manaus.valid[0].sendAt).toBe("2026-10-15T13:30:00.000Z");
  });

  it("a mesma pessoa pode ter dois lembretes", () => {
    const { valid } = validateReminderRows([row(), row({ line: 3, time: "15:00" })], { vars: 1, tz: "America/Sao_Paulo", now });
    expect(valid.map((v) => v.phone)).toEqual(["5521999990000", "5521999990000"]);
  });

  it("erros por linha", () => {
    const { valid, errors } = validateReminderRows(
      [row({ phone: "abc" }), row({ line: 3, date: "31/02/2026" }), row({ line: 4, time: "" }), row({ line: 5, date: "01/10/2026" }), row({ line: 6, vars: [] }), row({ line: 7, date: "15/03/2027" })],
      { vars: 1, tz: "America/Sao_Paulo", now },
    );
    expect(valid).toEqual([]);
    expect(errors.map((e) => e.message)).toEqual(["telefone inválido (abc)", "data inválida (31/02/2026); use dd/mm/aaaa", "sem hora", "01/10/2026 09:30 já passou", "falta a variável 1 (coluna variavel1)", "agende para no máximo 90 dias à frente"]);
  });

  it("dia mais cheio, para comparar com o limite de 24 h", () => {
    expect(busiestDay([{ local: "15/10/2026 09:00" }, { local: "15/10/2026 10:00" }, { local: "16/10/2026 09:00" }])).toEqual({ day: "15/10/2026", count: 2 });
    expect(busiestDay([])).toBeNull();
  });
});

describe("quem recebe o lembrete", () => {
  it("SAIR dos lembretes tira; SAIR só das promoções não", () => {
    expect(reminderExclusionOf({ suppressed: ["utility"], declared: true, messaged: true })).toBe("suppressed");
    expect(reminderExclusionOf({ suppressed: ["all"], declared: true, messaged: true })).toBe("suppressed");
    expect(reminderExclusionOf({ suppressed: ["marketing"], declared: true, messaged: true })).toBeNull();
  });

  it("sem a declaração do cliente, só quem já mandou mensagem ao chatbot", () => {
    expect(reminderExclusionOf({ suppressed: [], declared: false, messaged: true })).toBeNull();
    expect(reminderExclusionOf({ suppressed: [], declared: false, messaged: false })).toBe("no_declaration");
    expect(reminderExclusionOf({ suppressed: [], declared: true, messaged: false })).toBeNull();
  });
});
