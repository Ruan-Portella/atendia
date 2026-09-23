import { describe, expect, it } from "vitest";
import { lines, templateBody, templateVariables, validateTemplate } from "../whatsapp-templates";

describe("templateVariables", () => {
  it("acha as variáveis na ordem, sem repetir", () => {
    expect(templateVariables("Oi {{1}}, sobre {{2}}. Até mais, {{1}}!")).toEqual([1, 2]);
    expect(templateVariables("Sem variável")).toEqual([]);
    expect(templateVariables("Olá {{ 1 }}")).toEqual([1]);
  });
});

describe("validateTemplate", () => {
  const ok = { name: "retorno_atendimento", body: "Olá, {{1}}! Vimos sua mensagem sobre {{2}} e podemos continuar.", examples: ["Maria", "clareamento"] };

  it("aceita um modelo bem formado", () => {
    expect(validateTemplate(ok)).toBeNull();
    expect(validateTemplate({ name: "aviso", body: "Seu horário foi confirmado.", examples: [] })).toBeNull();
  });

  it("recusa o que a Meta reprovaria", () => {
    expect(validateTemplate({ ...ok, name: "Retorno Atendimento" })).toMatch(/minúsculas/);
    expect(validateTemplate({ ...ok, body: "Oi {{2}}, tudo bem?" })).toMatch(/em ordem/);
    expect(validateTemplate({ ...ok, body: "{{1}}, sua consulta foi marcada." })).toMatch(/começo ou no fim/);
    expect(validateTemplate({ ...ok, body: "Sua consulta é com {{1}}" })).toMatch(/começo ou no fim/);
    expect(validateTemplate({ ...ok, examples: ["Maria"] })).toMatch(/exemplo para cada variável \(2\)/);
    expect(validateTemplate({ ...ok, body: "oi" })).toMatch(/Escreva/);
  });
});

describe("helpers", () => {
  it("lê o corpo do modelo e as linhas do formulário", () => {
    expect(templateBody({ components: [{ type: "HEADER", text: "x" }, { type: "BODY", text: "corpo" }] })).toBe("corpo");
    expect(templateBody({})).toBe("");
    expect(lines(" Maria \n\n clareamento ")).toEqual(["Maria", "clareamento"]);
  });
});
