import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemRow } from "../memory-db";
import { canCreateAccount, inviteFromWaitlist, joinWaitlist, parseWaitlist, waitlistJoinedEmail } from "../waitlist";

/* Lista de espera (24/10/2026): até o lançamento, só o convidado cria a conta. */

afterEach(() => vi.unstubAllEnvs());

describe("lista de espera", () => {
  it("lê o formulário: e-mail em minúsculas, perfil e faixa só das opções", () => {
    expect(parseWaitlist({ email: " Ana@Exemplo.com ", profile: "business", sizeBand: "100 a 500 por mês", name: "  Ana   Souza " })).toMatchObject({ email: "ana@exemplo.com", profile: "business", sizeBand: "100 a 500 por mês", name: "Ana Souza" });
    expect(parseWaitlist({ email: "ana@exemplo.com", profile: "outro", sizeBand: "inventada" })).toMatchObject({ profile: "agency", sizeBand: null });
    expect(parseWaitlist({ email: "não é e-mail" })).toEqual({ error: "Confira o e-mail." });
  });

  it("entra na fila com a posição; quem volta mantém o lugar e completa os dados", async () => {
    const t: Record<string, MemRow[]> = { waitlist: [{ id: "w1", email: "bia@x.com", profile: "agency", created_at: "2026-01-01T00:00:00Z" }] };
    const db = memoryDb(t);
    const first = await joinWaitlist(db, { email: "ana@x.com", name: null, profile: "agency", company: null, sizeBand: null, source: null });
    expect(first).toEqual({ position: 2, already: false });
    const again = await joinWaitlist(db, { email: "ana@x.com", name: "Ana", profile: "business", company: "Pizzaria", sizeBand: null, source: null });
    expect(again).toEqual({ position: 2, already: true });
    expect(t.waitlist.find((r) => r.email === "ana@x.com")).toMatchObject({ name: "Ana", profile: "business", company: "Pizzaria" });
    expect(waitlistJoinedEmail(2, "agency", "BoaVoz").text).toContain("nº 2");
  });

  it("com a lista ligada, só o convidado (ou o admin) cria a conta; desligada, todos", async () => {
    const db = memoryDb({ waitlist: [{ id: "w1", email: "ana@x.com", invited_at: "2026-10-24T10:00:00Z" }, { id: "w2", email: "bia@x.com", invited_at: null }] });
    expect(await canCreateAccount(db, "bia@x.com")).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_WAITLIST", "1");
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "ruan@boavoz.com");
    expect(await canCreateAccount(db, "ana@x.com")).toBe(true);
    expect(await canCreateAccount(db, "bia@x.com")).toBe(false);
    expect(await canCreateAccount(db, "quem@x.com")).toBe(false);
    expect(await canCreateAccount(db, "ruan@boavoz.com")).toBe(true);
  });

  it("convidar marca o dia e manda o e-mail uma vez só", async () => {
    const t: Record<string, MemRow[]> = { waitlist: [{ id: "w1", email: "ana@x.com", name: "Ana Souza", invited_at: null }] };
    const db = memoryDb(t);
    const send = vi.fn(async () => true);
    expect(await inviteFromWaitlist(db, ["w1"], "ruan@boavoz.com", send)).toBe(1);
    expect(await inviteFromWaitlist(db, ["w1"], "ruan@boavoz.com", send)).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as unknown as [string, { text: string }])[1].text).toContain("Olá, Ana!");
    expect(t.waitlist[0]).toMatchObject({ invited_by: "ruan@boavoz.com" });
  });
});
