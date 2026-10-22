import { describe, expect, it } from "vitest";
import { appointmentText, busiestDay, parseSheetTime, reminderRowsFromCsv, reminderRowsFromTable, sendFromAppointment, tableRowFromSheet, validateReminderRows } from "../reminder-sheet";
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
    expect(errors.map((e) => e.message)).toEqual(["telefone inválido (abc)", "data inválida (31/02/2026); use dd/mm/aaaa", "sem hora", "01/10/2026 09:30 já passou", "falta o campo 1 do modelo", "agende para no máximo 90 dias à frente"]);
  });

  it("a lista da tela vira as linhas: envio, horário marcado e os campos", () => {
    const rows = [
      { name: "Ana Souza", phone: "21 99999-0000", at: "2026-10-15T14:30", date: "", time: "", vars: ["", "", "", "Dra. Lia"] },
      { name: "", phone: "", at: "", date: "", time: "", vars: [] },
      { name: "", phone: "21 98888-0000", at: "2026-10-16T09:00", date: "2026-10-12", time: "10:00", vars: [] },
    ];
    const slots = [
      { src: "name" as const, value: "cliente" },
      { src: "date" as const, value: "" },
      { src: "time" as const, value: "" },
      { src: "row" as const, value: "" },
    ];
    const before = reminderRowsFromTable(rows, slots, { mode: "before", lead: "1d", at: "" });
    // a linha vazia fica fora, mas a numeração segue a da lista
    expect(before.map((r) => r.line)).toEqual([1, 3]);
    expect(before[0]).toEqual({ line: 1, phone: "21 99999-0000", name: "Ana Souza", date: "2026-10-14", time: "14:30", vars: ["Ana", "15/10", "14h30", "Dra. Lia"] });
    expect(before[1].vars).toEqual(["cliente", "16/10", "9h", ""]);
    expect(reminderRowsFromTable(rows, slots, { mode: "same", date: "2026-10-13", time: "08:00" })[1]).toMatchObject({ date: "2026-10-13", time: "08:00" });
    expect(reminderRowsFromTable(rows, slots, { mode: "each" })[1]).toMatchObject({ date: "2026-10-12", time: "10:00" });
    // e o servidor lê a data do campo de data (aaaa-mm-dd)
    const { valid } = validateReminderRows(before.slice(0, 1), { vars: 4, tz: "America/Sao_Paulo", now });
    expect(valid[0]).toMatchObject({ local: "14/10/2026 14:30", variables: ["Ana", "15/10", "14h30", "Dra. Lia"] });
  });

  it("antes do horário marcado e o texto do dia e da hora", () => {
    expect(sendFromAppointment("2026-10-15T08:30", "2h")).toEqual({ date: "2026-10-15", time: "06:30" });
    expect(sendFromAppointment("2026-10-15T00:30", "1h")).toEqual({ date: "2026-10-14", time: "23:30" });
    expect(sendFromAppointment("2026-11-01T10:00", "2d")).toEqual({ date: "2026-10-30", time: "10:00" });
    expect(sendFromAppointment("2026-10-01T10:00", "vespera", "18:00")).toEqual({ date: "2026-09-30", time: "18:00" });
    expect(sendFromAppointment("", "1d")).toBeNull();
    expect(appointmentText("2026-10-15T09:05")).toEqual({ date: "15/10", time: "9h05" });
    expect(appointmentText("2026-10-15T14:00")).toEqual({ date: "15/10", time: "14h" });
  });

  it("a planilha importada entra na lista com o envio de cada linha", () => {
    expect(tableRowFromSheet({ line: 2, phone: "21 99999-0000", name: "Ana", date: "15/10/2026", time: "9:30", vars: ["x"] })).toEqual({ name: "Ana", phone: "21 99999-0000", at: "", date: "2026-10-15", time: "09:30", vars: ["x"] });
    expect(tableRowFromSheet({ line: 3, phone: "1", name: "", date: "31/02/2026", time: "manhã", vars: [] })).toMatchObject({ date: "", time: "" });
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
