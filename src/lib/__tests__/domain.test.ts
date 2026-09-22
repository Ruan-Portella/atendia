import { describe, expect, it } from "vitest";
import { dnsRecordName, isApexDomain, isCustomHost, parseDomain } from "../domain";

describe("parseDomain", () => {
  it("limpa https, caminho e maiúsculas", () => {
    expect(parseDomain(" https://Chat.Agencia.com.br/qualquer ")).toEqual({ domain: "chat.agencia.com.br" });
  });
  it("vazio remove o domínio", () => {
    expect(parseDomain("")).toEqual({ domain: null });
  });
  it.each(["agencia", "chat..agencia.com", "-x.com", "http://", "a b.com"])("recusa %s", (d) => {
    expect(parseDomain(d)).toHaveProperty("error");
  });
  it("recusa .vercel.app", () => {
    expect(parseDomain("x.vercel.app")).toHaveProperty("error");
  });
});

describe("DNS", () => {
  it("raiz x subdomínio, inclusive .com.br", () => {
    expect(isApexDomain("agencia.com.br")).toBe(true);
    expect(isApexDomain("agencia.com")).toBe(true);
    expect(isApexDomain("chat.agencia.com.br")).toBe(false);
    expect(isApexDomain("chat.agencia.com")).toBe(false);
  });
  it("nome do registro", () => {
    expect(dnsRecordName("chat.agencia.com.br")).toBe("chat");
    expect(dnsRecordName("a.b.agencia.com")).toBe("a.b");
    expect(dnsRecordName("agencia.com.br")).toBe("@");
  });
});

describe("isCustomHost", () => {
  it("app, localhost e previews não são domínio de agência", () => {
    expect(isCustomHost("localhost:3000")).toBe(false);
    expect(isCustomHost("meu-app-git-x.vercel.app")).toBe(false);
    expect(isCustomHost(null)).toBe(false);
  });
  it("domínio de terceiro é", () => {
    expect(isCustomHost("chat.agencia.com.br")).toBe(true);
  });
});
