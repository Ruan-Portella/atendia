import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.CONTACT_HASH_KEY ??= "chave-de-teste-com-mais-de-16-caracteres";

// o envio de verdade fica de fora: a lista de modelos da Meta, o envio do modelo e a camada de envio
const sent: Array<{ to: string; variables: string[]; payloads: string[] }> = [];
let approved = true;
vi.mock("../whatsapp-templates", async (orig) => ({
  ...(await orig<typeof import("../whatsapp-templates")>()),
  listTemplates: vi.fn(async () => (approved ? [{ id: "t1", name: "boavoz_confirmar_avisos", language: "pt_BR", status: "APPROVED", category: "UTILITY", components: [] }] : [])),
  sendTemplate: vi.fn(async (_ch: unknown, to: string, _t: unknown, variables: string[], o: { buttonPayloads?: string[] }) => {
    sent.push({ to, variables, payloads: o.buttonPayloads ?? [] });
    return { messages: [{ id: "wamid.teste" }] };
  }),
}));
vi.mock("../send", () => ({ deliver: vi.fn(async (_db: unknown, o: { transport: () => Promise<string | null> }) => ({ status: "sent", messageId: 1, channelMessageId: await o.transport() })) }));
vi.mock("../platform-events", () => ({ consentSource: () => "chat", queueConsentEvent: vi.fn(async () => {}) }));
vi.mock("../atendimentos", () => ({ botQuotaStatus: vi.fn(async () => []) }));

import { memoryDb, type MemRow } from "../memory-db";
import { assistantContext, assistantGuides, assistantNote, firstNameOf, forgetAssistantCache, handleTeamNotices, maskPhone, noticeButtons, noticeTemplateStatus, parseNoticeButton, requestTeamWhatsApp, templateValue, typedNoticeAnswer, NOTICE_TEXTS } from "../team-whatsapp";
import { phoneHash } from "../contacts";

const ASSISTANT = "11111111-1111-4111-8111-111111111111";
const BOAVOZ_AGENCY = "22222222-2222-4222-8222-222222222222";
const AGENCY = { id: "33333333-3333-4333-8333-333333333333", name: "Norte Marketing" };
const MEMBER = { id: "44444444-4444-4444-8444-444444444444", display_name: "ana maria", email: "ana@norte.com" };
const PHONE = "5541999990000";

function tables(): Record<string, MemRow[]> {
  return {
    platform_flags: [{ id: 1, assistant_bot_id: ASSISTANT }],
    bots: [{ id: ASSISTANT, agency_id: BOAVOZ_AGENCY }],
    whatsapp_channels: [{ bot_id: ASSISTANT, phone_number_id: "pn-1", waba_id: "waba-1", access_token_enc: "tok", disconnected_at: null }],
    agency_members: [{ id: MEMBER.id, agency_id: AGENCY.id, display_name: MEMBER.display_name, email: MEMBER.email }],
    agencies: [{ id: AGENCY.id, name: AGENCY.name }],
    team_whatsapp: [],
    suppressions: [],
    contacts: [],
    conversations: [],
  };
}

beforeEach(() => {
  forgetAssistantCache();
  sent.length = 0;
  approved = true;
});

describe("avisos no WhatsApp: puras", () => {
  it("o botão do modelo e a resposta digitada", () => {
    expect(parseNoticeButton("avs:sim:0123456789ab")).toEqual({ kind: "sim", nonce: "0123456789ab" });
    expect(parseNoticeButton("avs:nao:0123456789ab")).toEqual({ kind: "nao", nonce: "0123456789ab" });
    expect(parseNoticeButton("avs:sim:xyz")).toBeNull();
    expect(parseNoticeButton("rt:abc")).toBeNull();
    expect(typedNoticeAnswer("Confirmar")).toBe("sim");
    expect(typedNoticeAnswer("não fui eu")).toBe("nao");
    expect(typedNoticeAnswer("como conecto o whatsapp?")).toBeNull();
  });

  it("o número mascarado, o nome e as variáveis do modelo", () => {
    expect(maskPhone(PHONE)).toBe("+55 41 9•••• 0000");
    expect(templateValue("  Ana \n\n Maria  ", "x")).toBe("Ana Maria");
    expect(templateValue("   ", "sua agência")).toBe("sua agência");
    expect(firstNameOf({ display_name: "ana maria" })).toBe("Ana");
    expect(firstNameOf({ display_name: null, email: "joao.silva@x.com" })).toBe("Joao");
    expect(firstNameOf({})).toBe("tudo bem");
  });

  it("os botões gravados na conversa e o estado do modelo na Meta", () => {
    expect(noticeButtons("0123456789ab")).toEqual({ type: "options", options: [{ id: "avs:sim:0123456789ab", title: "Confirmar" }, { id: "avs:nao:0123456789ab", title: "Não fui eu" }] });
    const t = (o: Record<string, string>) => ({ id: "1", name: "boavoz_confirmar_avisos", language: "pt_BR", status: "APPROVED", category: "UTILITY", components: [], ...o });
    expect(noticeTemplateStatus([])).toBe("ausente");
    expect(noticeTemplateStatus([t({})])).toBe("aprovado");
    expect(noticeTemplateStatus([t({ status: "PENDING" })])).toBe("em_analise");
    expect(noticeTemplateStatus([t({ category: "MARKETING" })])).toBe("reclassificado");
  });
});

describe("avisos no WhatsApp: o pedido no painel", () => {
  const request = (db: ReturnType<typeof memoryDb>, rawPhone = "(41) 99999-0000") => requestTeamWhatsApp(db, { member: MEMBER, agency: AGENCY, rawPhone });

  it("grava o pedido em aberto e manda o modelo com o nome, a agência e os dois botões", async () => {
    const t = tables();
    const r = await request(memoryDb(t));
    expect(r).toEqual({ ok: true, masked: "+55 41 9•••• 0000" });
    const row = t.team_whatsapp[0];
    expect(row).toMatchObject({ member_id: MEMBER.id, agency_id: AGENCY.id, status: "pending", phone_hash: phoneHash(PHONE), consent_version: "2026-10-19" });
    expect(String(row.nonce)).toMatch(/^[0-9a-f]{12}$/);
    expect(sent).toEqual([{ to: PHONE, variables: ["Ana", "Norte Marketing"], payloads: [`avs:sim:${row.nonce}`, `avs:nao:${row.nonce}`] }]);
    // a conversa com o assistente nasce aqui (o modelo e as respostas ficam nela)
    expect(t.conversations[0]).toMatchObject({ bot_id: ASSISTANT, channel: "whatsapp", wa_id: PHONE });
  });

  it("recusa número inválido, número que pediu para sair, número de outra pessoa e modelo sem aprovação", async () => {
    expect(await request(memoryDb(tables()), "123")).toMatchObject({ ok: false, message: expect.stringContaining("Confira o número") });

    const sup = tables();
    await (await import("../suppression")).suppress(memoryDb(sup), { channel: "whatsapp", scope: "waba:waba-1", contact: PHONE, kind: "all", reason: "opt_out", source: "chat:nao_fui_eu" });
    expect(await request(memoryDb(sup))).toMatchObject({ ok: false, message: expect.stringContaining("pediu para não receber") });

    const taken = tables();
    taken.team_whatsapp.push({ member_id: "55555555-5555-4555-8555-555555555555", agency_id: AGENCY.id, phone_hash: phoneHash(PHONE), status: "confirmed" });
    expect(await request(memoryDb(taken))).toMatchObject({ ok: false, message: "Este número já recebe os avisos de outra pessoa." });

    approved = false;
    expect(await request(memoryDb(tables()))).toMatchObject({ ok: false, message: expect.stringContaining("em análise na Meta") });
    expect(sent).toEqual([]);
  });

  it("sem o assistente configurado, nada", async () => {
    const t = tables();
    t.platform_flags[0].assistant_bot_id = null;
    expect(await request(memoryDb(t))).toMatchObject({ ok: false, message: "Os avisos pelo WhatsApp ainda não estão disponíveis." });
  });
});

describe("avisos no WhatsApp: o toque no modelo", () => {
  const io = (db: ReturnType<typeof memoryDb>, replies: string[], botId = ASSISTANT) => ({
    db,
    bot: { id: botId },
    channel: { waba_id: "waba-1" },
    waId: PHONE,
    conversation: async () => "conv-1",
    store: async () => {},
    reply: async (_c: string | null, text: string) => void replies.push(text),
  });
  const pending = (t: Record<string, MemRow[]>, nonce = "0123456789ab") => t.team_whatsapp.push({ member_id: MEMBER.id, agency_id: AGENCY.id, phone_hash: phoneHash(PHONE), status: "pending", nonce });

  it("Confirmar liga os avisos e responde com o nome e a agência", async () => {
    const t = tables();
    pending(t);
    const replies: string[] = [];
    const handled = await handleTeamNotices(io(memoryDb(t), replies), [{ text: "Confirmar", buttonId: "avs:sim:0123456789ab" }]);
    expect([...handled]).toEqual([0]);
    expect(t.team_whatsapp[0]).toMatchObject({ status: "confirmed" });
    expect(t.team_whatsapp[0].confirmed_at).toBeTruthy();
    expect(replies).toEqual([NOTICE_TEXTS.confirmed("Ana", "Norte Marketing")]);
  });

  it("o botão de um pedido antigo não vale; o de outro chatbot nem é visto", async () => {
    const t = tables();
    pending(t);
    const replies: string[] = [];
    await handleTeamNotices(io(memoryDb(t), replies), [{ text: "Confirmar", buttonId: "avs:sim:ffffffffffff" }]);
    expect(t.team_whatsapp[0]).toMatchObject({ status: "pending" });
    expect(replies).toEqual([NOTICE_TEXTS.stale]);
    expect([...(await handleTeamNotices(io(memoryDb(t), replies, "66666666-6666-4666-8666-666666666666"), [{ text: "Confirmar", buttonId: "avs:sim:0123456789ab" }]))]).toEqual([]);
  });

  it("Não fui eu bloqueia o número para sempre (supressão de tudo)", async () => {
    const t = tables();
    pending(t);
    const replies: string[] = [];
    await handleTeamNotices(io(memoryDb(t), replies), [{ text: "Não fui eu", buttonId: "avs:nao:0123456789ab" }]);
    expect(t.team_whatsapp[0]).toMatchObject({ status: "refused" });
    expect(t.suppressions).toHaveLength(1);
    expect(t.suppressions[0]).toMatchObject({ kind: "all", reason: "opt_out", source: "chat:nao_fui_eu", scope: "waba:waba-1" });
    expect(replies).toEqual([NOTICE_TEXTS.refused]);
  });

  it("digitado só vale com o pedido em aberto; sem ele, é conversa com o assistente", async () => {
    const t = tables();
    const replies: string[] = [];
    expect([...(await handleTeamNotices(io(memoryDb(t), replies), [{ text: "sim", buttonId: null }]))]).toEqual([]);
    pending(t);
    expect([...(await handleTeamNotices(io(memoryDb(t), replies), [{ text: "confirmar", buttonId: null }]))]).toEqual([0]);
    expect(t.team_whatsapp[0]).toMatchObject({ status: "confirmed" });
    // já confirmado: o toque de novo só lembra que está ligado
    await handleTeamNotices(io(memoryDb(t), replies), [{ text: "Confirmar", buttonId: "avs:sim:0123456789ab" }]);
    expect(replies.at(-1)).toBe(NOTICE_TEXTS.already);
  });
});

/* ------------------------------------------------------------------ parte 2: o assistente reconhece a pessoa */

describe("assistente da BoaVoz: a nota sobre quem escreve", () => {
  const bots = [
    { name: "Clínica Vale", clientName: "Vale Verde", size: "M", quota: 340, used: 120 },
    { name: "Bar do Zé", clientName: "Zé", size: "P", quota: 160, used: 160 },
    { name: "Caixa", clientName: null, size: "atendimento", quota: 0, used: 0 },
    { name: "Rascunho", clientName: "Novo", size: null, quota: 0, used: 0 },
  ];

  it("o dono vê a conta e os chatbots, em ordem, com o tamanho e o uso do mês", () => {
    const n = assistantNote({ name: "Ana", agency: "Norte Marketing", role: "owner", billing: "past_due", bots });
    expect(n).toContain("Quem escreve é Ana, da equipe da agência Norte Marketing");
    expect(n).toContain("papel no painel: Dono");
    expect(n).toContain("pagamento atrasado (a IA está pausada em todos os chatbots");
    expect(n).toContain("Bar do Zé (cliente Zé): tamanho P, 160 de 160 atendimentos neste mês; Caixa: tamanho Atendimento (sem IA); Clínica Vale (cliente Vale Verde): tamanho M, 120 de 340");
    expect(n).toContain("Rascunho (cliente Novo): sem tamanho (não atende nos canais)");
    expect(n).toContain("Você não muda nada na conta");
  });

  it("quem não é dono não vê a cobrança; sem chatbot, a nota diz isso", () => {
    const n = assistantNote({ name: "Bia", agency: "Norte", role: "agent", billing: null, bots: [] });
    expect(n).not.toMatch(/Conta da agência/);
    expect(n).toContain("papel no painel: Atendente");
    expect(n).toContain("ainda não vê nenhum chatbot");
  });

  it("muitos chatbots: os 15 primeiros e quantos sobram", () => {
    const many = Array.from({ length: 18 }, (_, i) => ({ name: `Bot ${String(i).padStart(2, "0")}`, clientName: null, size: "P", quota: 160, used: i }));
    expect(assistantNote({ name: "Ana", agency: "Norte", role: "admin", billing: null, bots: many })).toContain("e mais 3.");
  });
});

describe("assistente da BoaVoz: quem escreve, pelo número confirmado", () => {
  const confirmed = (t: Record<string, MemRow[]>, over: MemRow = {}) =>
    t.team_whatsapp.push({ member_id: MEMBER.id, agency_id: AGENCY.id, phone_hash: phoneHash(PHONE), status: "confirmed", nonce: "0123456789ab", identity_key_hash: null, identity_changed_at: null, ...over });
  const withRole = (t: Record<string, MemRow[]>, over: MemRow) => Object.assign(t.agency_members[0], { role: "owner", scope: "all", removed_at: null, ...over });

  it("só no chatbot da BoaVoz e só com o número confirmado", async () => {
    const t = tables();
    withRole(t, {});
    expect(await assistantContext(memoryDb(t), { botId: ASSISTANT, waId: PHONE })).toBeNull();
    confirmed(t);
    expect(await assistantContext(memoryDb(t), { botId: "66666666-6666-4666-8666-666666666666", waId: PHONE })).toBeNull();
    expect(await assistantContext(memoryDb(t), { botId: ASSISTANT, waId: PHONE })).toContain("Quem escreve é Ana, da equipe da agência Norte Marketing");
  });

  it("a identidade do WhatsApp: a primeira fica guardada; outra depois para o assistente (aparelho novo ou número reciclado)", async () => {
    const t = tables();
    withRole(t, {});
    confirmed(t);
    expect(await assistantContext(memoryDb(t), { botId: ASSISTANT, waId: PHONE, identityKeyHash: "chave-1" })).toBeTruthy();
    expect(t.team_whatsapp[0].identity_key_hash).toBe("chave-1");
    expect(await assistantContext(memoryDb(t), { botId: ASSISTANT, waId: PHONE, identityKeyHash: "chave-1" })).toBeTruthy();
    expect(await assistantContext(memoryDb(t), { botId: ASSISTANT, waId: PHONE, identityKeyHash: "chave-2" })).toBeNull();
    expect(t.team_whatsapp[0].identity_changed_at).toBeTruthy();
    // daqui em diante, nem com a chave antiga (precisa confirmar de novo pelo painel)
    expect(await assistantContext(memoryDb(t), { botId: ASSISTANT, waId: PHONE, identityKeyHash: "chave-1" })).toBeNull();
  });

  it("quem saiu da equipe não é reconhecido", async () => {
    const t = tables();
    withRole(t, { removed_at: "2026-10-19T10:00:00.000Z" });
    confirmed(t);
    expect(await assistantContext(memoryDb(t), { botId: ASSISTANT, waId: PHONE })).toBeNull();
  });

  it("o Confirmar grava a identidade do aparelho e liga a checagem da Meta", async () => {
    const t = tables();
    t.team_whatsapp.push({ member_id: MEMBER.id, agency_id: AGENCY.id, phone_hash: phoneHash(PHONE), status: "pending", nonce: "0123456789ab" });
    let checked = 0;
    await handleTeamNotices(
      { db: memoryDb(t), bot: { id: ASSISTANT }, channel: { waba_id: "waba-1" }, waId: PHONE, conversation: async () => "conv-1", store: async () => {}, reply: async () => {}, identityKeyHash: "chave-1", onConfirmed: async () => void checked++ },
      [{ text: "Confirmar", buttonId: "avs:sim:0123456789ab" }],
    );
    expect(t.team_whatsapp[0]).toMatchObject({ status: "confirmed", identity_key_hash: "chave-1", identity_changed_at: null });
    expect(checked).toBe(1);
  });
});

describe("assistente da BoaVoz: o guia do painel (docs/assistente)", () => {
  it("cada arquivo tem título, cabe numa fonte de texto e fala dos assuntos principais", () => {
    const guides = assistantGuides();
    expect(guides.length).toBeGreaterThan(0);
    for (const g of guides) {
      expect(g.title).toMatch(/\(Boavoz\)$/i);
      expect(g.content.length).toBeGreaterThan(2000);
      expect(g.content.length).toBeLessThan(50_000);
    }
    const all = guides.map((g) => g.content).join("\n");
    for (const topic of ["Conta grátis", "Tamanhos e preços", "Conectar o WhatsApp", "Roteiros", "Avisos no WhatsApp", "Equipe e papéis"]) expect(all).toContain(topic);
    // os preços do guia batem com os do produto
    expect(all).toContain("P: R$ 49 por mês, 160 atendimentos");
    expect(all).toContain("M: R$ 99 por mês, 340 atendimentos");
    expect(all).toContain("G: R$ 199 por mês, 680 atendimentos");
  });
});

describe("assistente da BoaVoz: o escopo do papel", () => {
  it("o atendente com chatbots escolhidos só vê os dele (e nada de cobrança)", async () => {
    const { botQuotaStatus } = await import("../atendimentos");
    vi.mocked(botQuotaStatus).mockResolvedValueOnce([
      { botId: "b-1", name: "Bar do Zé", clientId: "c-1", clientName: "Zé", size: "P", volumePacks: null, quota: 160, used: 10 },
      { botId: "b-2", name: "Clínica Vale", clientId: "c-2", clientName: "Vale", size: "M", volumePacks: null, quota: 340, used: 20 },
      { botId: "b-3", name: "Pet Shop", clientId: "c-3", clientName: "Patas", size: "G", volumePacks: null, quota: 680, used: 30 },
    ] as unknown as Awaited<ReturnType<typeof botQuotaStatus>>);
    const t = tables();
    Object.assign(t.agency_members[0], { role: "agent", scope: "selected", removed_at: null });
    t.agencies[0].billing_status = "past_due";
    t.agency_member_scopes = [{ member_id: MEMBER.id, bot_id: "b-1", client_id: null }, { member_id: MEMBER.id, bot_id: null, client_id: "c-3" }];
    t.team_whatsapp.push({ member_id: MEMBER.id, agency_id: AGENCY.id, phone_hash: phoneHash(PHONE), status: "confirmed", nonce: "0123456789ab" });
    const n = await assistantContext(memoryDb(t), { botId: ASSISTANT, waId: PHONE });
    expect(n).toContain("Bar do Zé (cliente Zé)");
    expect(n).toContain("Pet Shop (cliente Patas)");
    expect(n).not.toContain("Clínica Vale");
    expect(n).not.toContain("pagamento atrasado");
  });
});
