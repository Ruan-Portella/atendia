import { describe, expect, it } from "vitest";
import { fieldError, type FieldInfo } from "@/lib/field-errors";

const ok = { valueMissing: false, typeMismatch: false, patternMismatch: false, tooShort: false, tooLong: false, rangeUnderflow: false, rangeOverflow: false, stepMismatch: false, badInput: false, customError: false, valid: false };
const field = (over: Partial<FieldInfo> & { bad?: Partial<FieldInfo["validity"]> }): FieldInfo => ({ tagName: "INPUT", type: "text", ...over, validity: { ...ok, ...over.bad } });

describe("fieldError", () => {
  it("campo válido não tem erro", () => {
    expect(fieldError(field({ bad: { valid: true } }))).toBeNull();
  });

  it("obrigatório diz o que fazer conforme o tipo", () => {
    expect(fieldError(field({ bad: { valueMissing: true } }))).toBe("Preencha este campo.");
    expect(fieldError(field({ type: "checkbox", bad: { valueMissing: true } }))).toBe("Marque esta opção para continuar.");
    expect(fieldError(field({ tagName: "SELECT", type: "select-one", bad: { valueMissing: true } }))).toBe("Escolha uma opção.");
    expect(fieldError(field({ type: "file", bad: { valueMissing: true } }))).toBe("Escolha um arquivo.");
  });

  it("e-mail e endereço com exemplo", () => {
    expect(fieldError(field({ type: "email", bad: { typeMismatch: true } }))).toContain("ana@loja.com.br");
    expect(fieldError(field({ type: "url", bad: { typeMismatch: true } }))).toContain("https://");
  });

  it("o formato usa o title do campo", () => {
    expect(fieldError(field({ title: "Só letras minúsculas e hífen.", bad: { patternMismatch: true } }))).toBe("Só letras minúsculas e hífen.");
    expect(fieldError(field({ bad: { patternMismatch: true } }))).toBe("Confira o formato.");
  });

  it("tamanho e limites com os números do campo", () => {
    expect(fieldError(field({ minLength: 8, bad: { tooShort: true } }))).toBe("Use pelo menos 8 caracteres.");
    expect(fieldError(field({ maxLength: 40, bad: { tooLong: true } }))).toBe("Use no máximo 40 caracteres.");
    expect(fieldError(field({ type: "number", min: "1", bad: { rangeUnderflow: true } }))).toBe("O mínimo é 1.");
    expect(fieldError(field({ type: "number", max: "10000", bad: { rangeOverflow: true } }))).toBe("O máximo é 10.000.");
    expect(fieldError(field({ type: "number", bad: { stepMismatch: true } }))).toBe("Use um número inteiro.");
    expect(fieldError(field({ type: "number", bad: { badInput: true } }))).toBe("Digite só números.");
  });

  it("a mensagem própria do campo vem primeiro", () => {
    expect(fieldError(field({ validationMessage: "Esse nome já existe.", bad: { customError: true } }))).toBe("Esse nome já existe.");
  });
});
