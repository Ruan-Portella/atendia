import { describe, expect, it } from "vitest";
import { dnsRecordName, isApexDomain, isCustomHost, parseDomain, pickRecommended } from "../domain";

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

describe("pickRecommended (resposta da Vercel)", () => {
  it("pega o de rank 1 e tira o ponto final", () => {
    expect(pickRecommended([{ rank: 2, value: "cname.vercel-dns.com." }, { rank: 1, value: "564cab24d9ff00af.vercel-dns-017.com." }])).toBe("564cab24d9ff00af.vercel-dns-017.com");
  });
  it("IPv4 vem como lista de IPs", () => {
    expect(pickRecommended([{ rank: 1, value: ["216.198.79.1", "64.29.17.1"] }])).toBe("216.198.79.1");
  });
  it("sem recomendação: null (usa o padrão)", () => {
    expect(pickRecommended(undefined)).toBeNull();
    expect(pickRecommended([])).toBeNull();
  });
});
