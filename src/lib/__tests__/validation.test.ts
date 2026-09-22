import { describe, expect, it } from "vitest";
import { assistantName, clientFields, isEmail, parsePrice } from "../validation";

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

describe("parsePrice", () => {
  it.each([
    ["", null],
    ["55", 5500],
    ["55,90", 5590],
    ["55.90", 5590],
    ["R$ 400", 40000],
    ["1.250", 125000],
    ["1.250,50", 125050],
    ["0", 0],
  ])("%s → %s centavos", (input, cents) => {
    expect(parsePrice(input)).toEqual({ cents });
  });

  it.each(["abc", "-10", "10,5,3", "1e5", "55 reais"])("recusa %s", (input) => {
    expect(parsePrice(input)).toHaveProperty("error");
  });

  it("recusa valores absurdos", () => {
    expect(parsePrice("2000000")).toHaveProperty("error");
  });
});

describe("assistantName", () => {
  it("recusa 1 caractere (o bug do nome 'X')", () => {
    expect(assistantName("X")).toEqual({ error: expect.stringContaining("pelo menos 2") });
  });
  it("recusa só espaços", () => {
    expect(assistantName("   ")).toHaveProperty("error");
  });
  it("recusa mais de 40 caracteres", () => {
    expect(assistantName("a".repeat(41))).toHaveProperty("error");
  });
  it("aceita e apara", () => {
    expect(assistantName("  Sofia ")).toEqual({ name: "Sofia" });
  });
});

describe("clientFields", () => {
  it("valida nome, site e preço", () => {
    expect(clientFields(form({ name: "Clínica Sorriso", site: "clinica.com.br", price: "189,90" }))).toEqual({ name: "Clínica Sorriso", site: "clinica.com.br", price_cents: 18990 });
  });
  it("site vazio vira null", () => {
    expect(clientFields(form({ name: "Pousada" }))).toEqual({ name: "Pousada", site: null, price_cents: null });
  });
  it("usa o prefixo dos campos de cliente novo", () => {
    expect(clientFields(form({ new_client_name: "Loja", new_client_price: "55" }), "new_client_")).toMatchObject({ name: "Loja", price_cents: 5500 });
  });
  it("devolve o erro do preço", () => {
    expect(clientFields(form({ name: "Loja", price: "caro" }))).toHaveProperty("error");
  });
  it("recusa nome curto", () => {
    expect(clientFields(form({ name: "L" }))).toHaveProperty("error");
  });
});

describe("isEmail", () => {
  it("aceita e recusa", () => {
    expect(isEmail("a@b.com")).toBe(true);
    expect(isEmail("a@b")).toBe(false);
    expect(isEmail("sem arroba")).toBe(false);
  });
});
