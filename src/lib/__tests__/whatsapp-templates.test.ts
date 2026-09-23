import { describe, expect, it } from "vitest";
import { formParams, lines, renderTemplate, templateBody, templateName, templateVariables, unsupportedReason, validateTemplate } from "../template-text";

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

describe("renderTemplate e formParams", () => {
  it("monta a mensagem como o contato recebe; campo vazio continua aparecendo", () => {
    expect(renderTemplate("Olá, {{1}}! Sobre {{2}}.", ["Maria", "clareamento"])).toBe("Olá, Maria! Sobre clareamento.");
    expect(renderTemplate("Olá, {{1}}! Sobre {{2}}.", ["Maria"])).toBe("Olá, Maria! Sobre {{2}}.");
    expect(renderTemplate("Olá, {{1}}!", ["  "])).toBe("Olá, {{1}}!");
  });

  it("lê param_1, param_2… na ordem", () => {
    const fd = new FormData();
    fd.set("param_2", " b ");
    fd.set("param_1", "a");
    expect(formParams(fd, 3)).toEqual(["a", "b", ""]);
  });
});

describe("templateName", () => {
  it("converte para o formato da Meta", () => {
    expect(templateName("Retorno Atendimento")).toBe("retorno_atendimento");
    expect(templateName("  Confirmação de horário! ")).toBe("confirmacao_de_horario");
    expect(templateName("aviso_lead")).toBe("aviso_lead");
  });
});

describe("unsupportedReason", () => {
  it("texto, rodapé e botões fixos: dá para enviar", () => {
    expect(unsupportedReason({ components: [{ type: "HEADER", format: "TEXT", text: "Oi" }, { type: "BODY", text: "Olá {{1}}!" }, { type: "FOOTER", text: "x" }, { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY" }, { type: "URL", url: "https://a.com" }] }] })).toBeNull();
  });
  it("mídia, carrossel, botão variável e variável com nome: não dá", () => {
    expect(unsupportedReason({ components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: "x" }] })).toMatch(/cabeçalho/);
    expect(unsupportedReason({ components: [{ type: "BODY", text: "x" }, { type: "CAROUSEL" }] })).toMatch(/carrossel/);
    expect(unsupportedReason({ components: [{ type: "BODY", text: "x" }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://a.com/{{1}}" }] }] })).toMatch(/botão/);
    expect(unsupportedReason({ components: [{ type: "BODY", text: "Olá {{nome}}" }] })).toMatch(/nome/);
  });
});
