import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isAdultOn, parseCsv, parseSheetDate, rowsFromCsv, validateImportRows, type RawImportRow } from "../contact-import";

const today = new Date("2026-10-07T15:00:00Z");
const row = (o: Partial<RawImportRow>): RawImportRow => ({ line: 2, phone: "", name: "", tags: "", consentOrigin: "", consentDate: "", consentText: "", age: "", ageOrigin: "", birth: "", ...o });

describe("planilha de contatos: leitura", () => {
  it("separador ; ou , e aspas com separador, aspas e quebra de linha dentro", () => {
    expect(parseCsv("a;b\r\n1;2\r\n")).toEqual([["a", "b"], ["1", "2"]]);
    expect(parseCsv('a,b\n"x, y","diz ""oi""\nem duas linhas"')).toEqual([["a", "b"], ["x, y", 'diz "oi"\nem duas linhas']]);
    expect(parseCsv("﻿a;b\n\n1;2\n;\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("cabeçalho com acento, maiúscula e espaço; colunas desconhecidas avisadas", () => {
    const r = rowsFromCsv("Telefone;Nome;Origem do aceite;Data do aceite;Data de nascimento;Origem da idade;Cidade\n21 99999-0000;Ana;balcão;10/09/2026;01/01/1990;documento;Rio");
    expect(r.hasPhone).toBe(true);
    expect(r.unknown).toEqual(["Cidade"]);
    expect(r.rows[0]).toMatchObject({ line: 2, phone: "21 99999-0000", name: "Ana", consentOrigin: "balcão", consentDate: "10/09/2026", birth: "01/01/1990", ageOrigin: "documento" });
  });

  it("o modelo para baixar é lido inteiro", () => {
    const r = rowsFromCsv(readFileSync(join(process.cwd(), "public/modelos/contatos.csv"), "utf8"));
    expect(r.unknown).toEqual([]);
    const v = validateImportRows(r.rows, today);
    expect(v.errors).toEqual([]);
    expect(v.valid).toHaveLength(2);
    expect(v.valid[0]).toMatchObject({ phone: "5521999990000", tags: ["vip", "pizza"], age: { adult: true } });
    expect(v.valid[0].consent?.origin).toBe("cadastro no balcão");
  });

  it("datas da planilha", () => {
    expect(parseSheetDate("10/09/2026")?.toISOString()).toBe("2026-09-10T15:00:00.000Z");
    expect(parseSheetDate("2026-09-10")?.toISOString()).toBe("2026-09-10T15:00:00.000Z");
    expect(parseSheetDate("10/09/26")?.getUTCFullYear()).toBe(2026);
    expect(parseSheetDate("31/02/2026")).toBeNull();
    expect(parseSheetDate("ontem")).toBeNull();
  });

  it("18 anos completos no dia do aniversário", () => {
    expect(isAdultOn(parseSheetDate("07/10/2008")!, today)).toBe(true);
    expect(isAdultOn(parseSheetDate("08/10/2008")!, today)).toBe(false);
  });
});

describe("planilha de contatos: conferência", () => {
  it("telefone obrigatório, válido e sem repetir", () => {
    const v = validateImportRows([row({ line: 2, phone: "21999990000" }), row({ line: 3, phone: "abc" }), row({ line: 4, phone: "" }), row({ line: 5, phone: "(21) 9 9999-0000" })], today);
    expect(v.valid.map((r) => r.phone)).toEqual(["5521999990000"]);
    expect(v.errors.map((e) => e.line)).toEqual([3, 4, 5]);
    expect(v.errors[2].reason).toContain("repetido");
  });

  it("aceite exige origem e data, e a data não pode ser no futuro", () => {
    const v = validateImportRows([
      row({ line: 2, phone: "21999990001", consentDate: "10/09/2026" }),
      row({ line: 3, phone: "21999990002", consentOrigin: "site", consentDate: "" }),
      row({ line: 4, phone: "21999990003", consentOrigin: "site", consentDate: "10/12/2026" }),
      row({ line: 5, phone: "21999990004", consentOrigin: "site", consentDate: "10/09/2026", consentText: "Aceito promoções" }),
    ], today);
    expect(v.errors.map((e) => e.line)).toEqual([2, 3, 4]);
    expect(v.valid[0].consent).toMatchObject({ origin: "site", text: "Aceito promoções" });
  });

  it("idade: sim/não ou nascimento, sempre com a origem; o nascimento não fica", () => {
    const v = validateImportRows([
      row({ line: 2, phone: "21999990001", age: "Sim", ageOrigin: "documento" }),
      row({ line: 3, phone: "21999990002", birth: "01/01/2012", ageOrigin: "documento" }),
      row({ line: 4, phone: "21999990003", age: "talvez", ageOrigin: "documento" }),
      row({ line: 5, phone: "21999990004", age: "sim" }),
    ], today);
    expect(v.valid.map((r) => r.age)).toEqual([{ adult: true, origin: "documento" }, { adult: false, origin: "documento" }]);
    expect(v.errors.map((e) => e.line)).toEqual([4, 5]);
    expect(JSON.stringify(v.valid)).not.toContain("2012");
  });
});
