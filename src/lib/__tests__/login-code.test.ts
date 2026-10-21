import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { LOGIN_CODE_TEXTS, checkLoginCode, loginCodeEmail, parseLoginCode, passwordOnlySession, requestLoginCode } from "../login-code";

/** Banco falso: o limite de tentativas responde `allowed`, e o Auth admin gera o código. */
function fakeAdmin(o: { allowed?: boolean | ((key: string) => boolean); otp?: string | null } = {}) {
  const rpc = vi.fn(async (_fn: string, args: { p_key: string }) => ({ data: typeof o.allowed === "function" ? o.allowed(args.p_key) : (o.allowed ?? true), error: null }));
  const createUser = vi.fn(async () => ({ data: null, error: { message: "A user with this email address has already been registered" } }));
  const generateLink = vi.fn(async () => ({ data: { properties: { email_otp: o.otp === undefined ? "482913" : o.otp } }, error: null }));
  return { db: { rpc, auth: { admin: { createUser, generateLink } } } as unknown as SupabaseClient, rpc, createUser, generateLink };
}

describe("login por código", () => {
  const key = process.env.RESEND_API_KEY;
  beforeEach(() => {
    process.env.RESEND_API_KEY = "re_teste";
  });
  afterEach(() => {
    process.env.RESEND_API_KEY = key;
  });

  it("o código como a pessoa cola: só os números, de 6 a 10", () => {
    expect(parseLoginCode("482 913")).toBe("482913");
    expect(parseLoginCode("482-913")).toBe("482913");
    expect(parseLoginCode("48291")).toBeNull();
    expect(parseLoginCode("abcdef")).toBeNull();
    expect(parseLoginCode(null)).toBeNull();
  });

  it("o e-mail traz o código no assunto e no corpo, com o prazo", () => {
    const m = loginCodeEmail("482913", "Boavoz");
    expect(m.subject).toBe("482913 é o seu código de acesso ao Boavoz");
    expect(m.text).toContain("482913");
    expect(m.text).toContain("vale por 1 hora");
    expect(m.html).toContain(">482913<");
  });

  it("manda o código: cria a conta se faltar, gera pelo Supabase e envia para o e-mail em minúsculas", async () => {
    const f = fakeAdmin();
    const send = vi.fn(async () => ({ ok: true }));
    expect(await requestLoginCode(f.db, { email: "  Ana@Exemplo.com.br ", ip: "1.2.3.4" }, send)).toEqual({ ok: true });
    expect(f.createUser).toHaveBeenCalledWith({ email: "ana@exemplo.com.br", email_confirm: true });
    expect(f.generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "ana@exemplo.com.br" });
    expect(send).toHaveBeenCalledWith("ana@exemplo.com.br", expect.objectContaining({ subject: expect.stringContaining("482913") }));
    // os limites: por IP, por e-mail e o intervalo entre dois pedidos (sem guardar o e-mail puro)
    const keys = f.rpc.mock.calls.map((c) => (c[1] as { p_key: string }).p_key);
    expect(keys).toHaveLength(3);
    expect(keys.join(" ")).not.toContain("ana@");
  });

  it("sem a Resend no ambiente, e-mail inválido, limite estourado ou falha no envio: não manda", async () => {
    const send = vi.fn(async () => ({ ok: true }));
    expect(await requestLoginCode(fakeAdmin().db, { email: "ana@exemplo", ip: "x" }, send)).toEqual({ ok: false, message: LOGIN_CODE_TEXTS.invalidEmail });
    // e-mail descartável não abre conta (Trava da conta grátis), nem num subdomínio
    const temp = fakeAdmin();
    expect(await requestLoginCode(temp.db, { email: "ana@mailinator.com", ip: "x" }, send)).toEqual({ ok: false, message: LOGIN_CODE_TEXTS.disposable });
    expect(await requestLoginCode(temp.db, { email: "ana@x.yopmail.com", ip: "x" }, send)).toEqual({ ok: false, message: LOGIN_CODE_TEXTS.disposable });
    expect(temp.createUser).not.toHaveBeenCalled();
    expect(await requestLoginCode(fakeAdmin({ allowed: (k) => !k.startsWith("login-code:gap:") }).db, { email: "ana@exemplo.com", ip: "x" }, send)).toEqual({ ok: false, message: LOGIN_CODE_TEXTS.wait });
    expect(await requestLoginCode(fakeAdmin({ otp: null }).db, { email: "ana@exemplo.com", ip: "x" }, send)).toEqual({ ok: false, message: LOGIN_CODE_TEXTS.failed });
    expect(await requestLoginCode(fakeAdmin().db, { email: "ana@exemplo.com", ip: "x" }, async () => ({ ok: false, message: "domínio não verificado" }))).toEqual({ ok: false, message: LOGIN_CODE_TEXTS.failed });
    expect(send).not.toHaveBeenCalled();
    delete process.env.RESEND_API_KEY;
    expect(await requestLoginCode(fakeAdmin().db, { email: "ana@exemplo.com", ip: "x" }, send)).toEqual({ ok: false, message: LOGIN_CODE_TEXTS.noEmail });
  });

  it("confere o código no servidor, com limite de tentativas", async () => {
    const verifyOtp = vi.fn(async () => ({ data: { user: { id: "u1" }, session: {} }, error: null }));
    const auth = { verifyOtp } as unknown as Pick<SupabaseClient["auth"], "verifyOtp">;
    expect(await checkLoginCode(fakeAdmin().db, auth, { email: "Ana@Exemplo.com", code: "482 913", ip: "x" })).toEqual({ ok: true, userId: "u1" });
    expect(verifyOtp).toHaveBeenCalledWith({ email: "ana@exemplo.com", token: "482913", type: "email" });

    expect(await checkLoginCode(fakeAdmin().db, auth, { email: "ana@exemplo.com", code: "12", ip: "x" })).toEqual({ ok: false, message: LOGIN_CODE_TEXTS.invalidCode });
    expect(await checkLoginCode(fakeAdmin({ allowed: false }).db, auth, { email: "ana@exemplo.com", code: "482913", ip: "x" })).toEqual({ ok: false, message: LOGIN_CODE_TEXTS.tooMany });
    const wrong = { verifyOtp: vi.fn(async () => ({ data: { user: null, session: null }, error: { message: "Token has expired or is invalid" } })) } as unknown as Pick<SupabaseClient["auth"], "verifyOtp">;
    expect(await checkLoginCode(fakeAdmin().db, wrong, { email: "ana@exemplo.com", code: "000000", ip: "x" })).toEqual({ ok: false, message: LOGIN_CODE_TEXTS.wrongCode });
    expect(verifyOtp).toHaveBeenCalledTimes(1);
  });
  it("sessão aberta só com senha sai do painel; código, Google e o segundo fator ficam", () => {
    const at = (method: string) => ({ method, timestamp: 1_792_000_000 });
    expect(passwordOnlySession([at("password")])).toBe(true);
    expect(passwordOnlySession([at("password"), at("totp")])).toBe(true);
    expect(passwordOnlySession([at("otp")])).toBe(false);
    expect(passwordOnlySession([at("oauth")])).toBe(false);
    expect(passwordOnlySession([at("otp"), at("totp")])).toBe(false);
    expect(passwordOnlySession(undefined)).toBe(false);
    expect(passwordOnlySession([])).toBe(false);
  });
});
