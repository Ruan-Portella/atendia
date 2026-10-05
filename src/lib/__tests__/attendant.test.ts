import { describe, expect, it } from "vitest";
import { attendantAuthor, authorLabel, authorTypeOf, firstName, personName } from "../authors";
import { DEFAULT_BACK_NOTICE, DEFAULT_ENTRY_NOTICE, backNoticeProblem, entryNoticeProblem, renderBackNotice, renderEntryNotice } from "../handoff-hours";
import { heldByOther, holdsConversation } from "../handoff";
import { isOurAvatarUrl, profileProblem } from "../attendants";
import { attendantOf } from "../team";
import { holderView } from "@/components/handoff-controls";

const SB = "https://abc.supabase.co";
const MEMBER = "11111111-1111-4111-8111-111111111111";

describe("quem escreveu", () => {
  it("tipo pelo texto antigo de autor", () => {
    expect(authorTypeOf("user", null)).toBeNull();
    expect(authorTypeOf("assistant", null)).toBe("ai");
    expect(authorTypeOf("assistant", "sistema")).toBe("system");
    expect(authorTypeOf("agent", "celular")).toBe("phone_app");
    expect(authorTypeOf("agent", "instagram")).toBe("phone_app");
    expect(authorTypeOf("agent", "agência")).toBe("agency_member");
    expect(authorTypeOf("agent", null)).toBe("agency_member");
    expect(authorTypeOf("agent", "joana@clinica.com")).toBe("client_member");
  });

  it("primeiro nome: do cadastro, senão do e-mail", () => {
    expect(firstName("Viviane Souza", "v@x.com")).toBe("Viviane");
    expect(firstName(null, "ruanmorales29@gmail.com")).toBe("Ruanmorales");
    expect(firstName(null, "joao.silva@x.com")).toBe("Joao");
    expect(firstName("  ", "")).toBe("Equipe");
    expect(personName({ full_name: "Ana Lima" })).toBe("Ana Lima");
    expect(personName({ agency_name: "Norte Marketing" })).toBeNull();
  });

  it("a pessoa da equipe vira atendente com o nome de exibição", () => {
    const a = attendantOf({ id: MEMBER, display_name: "Vivi", email: "viviane@agencia.com" });
    expect(a).toEqual({ type: "agency_member", id: MEMBER, name: "Vivi", legacy: "agência" });
    expect(attendantOf({ id: MEMBER, display_name: null, email: "viviane@agencia.com" }).name).toBe("Viviane");
    expect(attendantAuthor(a)).toEqual({ author: "agência", author_type: "agency_member", author_id: MEMBER, author_display_name: "Vivi" });
  });

  it("rótulo no painel e no portal", () => {
    const vivi = { author: "agência", author_type: "agency_member", author_id: MEMBER, author_display_name: "Viviane" };
    expect(authorLabel(vivi, { view: "agency", meId: MEMBER })).toBe("Viviane (você)");
    expect(authorLabel(vivi, { view: "agency", meId: "outro" })).toBe("Viviane");
    expect(authorLabel(vivi, { view: "client", agencyName: "Norte" })).toBe("Viviane · Norte");
    // mensagem antiga da agência: sem nome
    expect(authorLabel({ author: "agência" }, { view: "agency" })).toBe("Equipe da agência");
    expect(authorLabel({ author: "agência" }, { view: "client", agencyName: "Norte" })).toBe("Norte");
    // pessoa do cliente, antiga (e-mail) e nova
    expect(authorLabel({ author: "joana@clinica.com" }, { view: "agency" })).toBe("Cliente · joana@clinica.com");
    expect(authorLabel({ author: "joana@clinica.com" }, { view: "client", meLegacy: "joana@clinica.com" })).toBe("joana@clinica.com (você)");
    expect(authorLabel({ author: "celular", author_type: "phone_app" }, { view: "agency" })).toBe("Pelo celular (WhatsApp Business)");
    expect(authorLabel({ author: "instagram" }, { view: "client" })).toBe("Pelo app do Instagram");
  });
});

describe("anúncios do atendimento", () => {
  it("entrada precisa do nome de quem assumiu", () => {
    expect(entryNoticeProblem("")).toBeNull();
    expect(entryNoticeProblem(DEFAULT_ENTRY_NOTICE)).toBeNull();
    expect(entryNoticeProblem("Oi, aqui é da equipe.")).toMatch(/\{atendente\}/);
    expect(entryNoticeProblem("Oi {nome}")).toMatch(/só aceita/);
    expect(renderEntryNotice(null, { attendant: "Viviane", company: "Pizzaria do Zé" })).toBe("Oi! Aqui é Viviane, da equipe de Pizzaria do Zé. Vou continuar o seu atendimento.");
    expect(renderEntryNotice("{atendente} na área!", { attendant: "Vivi", company: "X" })).toBe("Vivi na área!");
  });

  it("volta para a IA precisa dizer assistente virtual", () => {
    expect(backNoticeProblem(DEFAULT_BACK_NOTICE)).toBeNull();
    expect(backNoticeProblem("Voltei! Sou a {nome}.")).toMatch(/assistente virtual/);
    expect(backNoticeProblem("{atendente} saiu, sou a assistente virtual")).toMatch(/só aceita/);
    expect(renderBackNotice(null, { name: "Bia", client_name: "Pizzaria" })).toBe("Voltei! Sou Bia, assistente virtual. Se precisar, é só pedir um atendente.");
  });
});

describe("um atendente por conversa", () => {
  const conv = (o: Partial<{ takeover_at: string | null; handled_at: string | null; assigned_to_id: string | null; assigned_to_name: string | null }>) => ({ takeover_at: "2026-10-05T10:00:00Z", handled_at: null, assigned_to_id: "a", assigned_to_name: "Viviane", ...o });
  it("quem está com a conversa", () => {
    expect(holdsConversation(conv({}), "a")).toBe(true);
    expect(heldByOther(conv({}), "b")).toBe(true);
    expect(heldByOther(conv({}), "a")).toBe(false);
    // encerrado ou sem dono (atendimento antigo): livre
    expect(heldByOther(conv({ handled_at: "2026-10-05T11:00:00Z" }), "b")).toBe(false);
    expect(heldByOther(conv({ assigned_to_id: null }), "b")).toBe(false);
    expect(holdsConversation(conv({ takeover_at: null }), "a")).toBe(false);
  });

  it("a tela mostra a caixa de resposta só para quem atende", () => {
    const c = { last_message_at: "", handoff_requested_at: null, takeover_at: "2026-10-05T10:00:00Z", handled_at: null, assigned_to_id: "a", assigned_to_name: "Viviane" };
    expect(holderView(c, "a")).toBe("mine");
    expect(holderView(c, "b")).toBe("other");
    expect(holderView({ ...c, assigned_to_id: null }, "b")).toBe("free");
    expect(holderView({ ...c, handled_at: "2026-10-05T11:00:00Z" }, "b")).toBe("free");
  });
});

describe("foto e nome de exibição", () => {
  it("foto só do Storage da plataforma, na pasta da pessoa", () => {
    const ok = `${SB}/storage/v1/object/public/logos/avatars/${MEMBER}/1.png`;
    expect(isOurAvatarUrl(ok, SB)).toBe(true);
    expect(isOurAvatarUrl("https://evil.com/a.png", SB)).toBe(false);
    expect(isOurAvatarUrl(`${SB}/storage/v1/object/public/logos/outra/1.png`, SB)).toBe(false);
    expect(profileProblem("Viviane", ok, MEMBER, SB)).toBeNull();
    expect(profileProblem("Viviane", `${SB}/storage/v1/object/public/logos/avatars/outra-pessoa/1.png`, MEMBER, SB)).toMatch(/foto/);
    expect(profileProblem("V", null, MEMBER, SB)).toMatch(/2 letras/);
    expect(profileProblem("Vivi {empresa}", null, MEMBER, SB)).toMatch(/letras/);
    expect(profileProblem("1234", null, MEMBER, SB)).toMatch(/letras/);
  });
});
