import { describe, expect, it } from "vitest";
import { contactPhotoUrl, photoStale } from "../contacts";

describe("foto do contato (Instagram)", () => {
  const now = Date.parse("2026-10-22T12:00:00Z");

  it("busca na primeira vez e depois de uma semana", () => {
    expect(photoStale({ avatar_at: null }, now)).toBe(true);
    expect(photoStale({}, now)).toBe(true);
    expect(photoStale({ avatar_at: "2026-10-20T12:00:00Z" }, now)).toBe(false);
    expect(photoStale({ avatar_at: "2026-10-15T11:00:00Z" }, now)).toBe(true);
  });

  it("o endereço leva a versão; sem foto, nada", () => {
    expect(contactPhotoUrl("c1", "2026-10-20T12:00:00.000Z")).toBe(`/api/painel/contatos/c1/foto?v=${Date.parse("2026-10-20T12:00:00.000Z")}`);
    expect(contactPhotoUrl("c1", null)).toBeNull();
    expect(contactPhotoUrl("c1", undefined)).toBeNull();
  });
});
