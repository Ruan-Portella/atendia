import { describe, expect, it } from "vitest";
import {
  CONFIRM_TEXTS,
  blockedOrderOutput,
  confirmComponent,
  confirmationLines,
  confirmationText,
  confirmedNote,
  isConfirmComponent,
  parseConfirmButton,
  shortcutTarget,
  stillCallable,
  typedChoice,
  uncertainComponent,
  unusableText,
} from "../action-confirm";
import { callBody, needsConfirmation, paramsSchemaProblem, readConfirmation, readResponse, type ParamsSchema } from "../actions";
import { idLabels, idMapCategories, mergeIdMap, paramsGateDecision, paramsGateFacts, type IdMap } from "../action-gate";
import { confirmToolSchema } from "../action-tools";
import { refCallId } from "../button-refs";
import { actionsNote, withoutSummary } from "../chat";
import { actionInputFromForm, actionSavedMessage } from "../integrations-input";

const REF = "0b6d5c1e-2f4a-4c3b-9d8e-7f6a5b4c3d2e";

describe("botões do Confirmar (C pública, parte 5a)", () => {
  it("Confirmar e Cancelar apontam para a mesma referência; o id é opaco", () => {
    const c = confirmComponent(REF);
    expect(c).toEqual({ type: "options", options: [{ id: `bvc:${REF}:sim`, title: "Confirmar" }, { id: `bvc:${REF}:nao`, title: "Cancelar" }] });
    expect(parseConfirmButton(`bvc:${REF}:sim`)).toEqual({ refId: REF, verb: "sim" });
    expect(parseConfirmButton(`bvc:${REF}:repetir`)).toEqual({ refId: REF, verb: "repetir" });
    expect(parseConfirmButton("op_1")).toBeNull();
    expect(parseConfirmButton(`bvc:${REF}:apagar`)).toBeNull();
    expect(isConfirmComponent(c)).toBe(true);
    expect(isConfirmComponent({ type: "options", options: [{ id: "op_1", title: "Pizza" }] })).toBe(false);
    // títulos cabem nos botões do WhatsApp e nas respostas rápidas do Instagram (20)
    const titles = [c, uncertainComponent(REF)].flatMap((x) => (x.type === "options" ? x.options.map((o) => o.title) : []));
    expect(titles).toHaveLength(4);
    for (const t of titles) expect(t.length).toBeLessThanOrEqual(20);
  });

  it("o call_id é o id da referência (o mesmo em todo Tentar de novo)", () => {
    expect(refCallId(REF)).toBe("call_0b6d5c1e2f4a4c3b9d8e7f6a5b4c3d2e");
  });

  it("atalho: sim, confirmo e 1 confirmam; não e 2 cancelam; frase não é atalho", () => {
    expect(typedChoice("Sim")).toEqual({ pos: 1, number: false });
    expect(typedChoice("confirmo!")).toEqual({ pos: 1, number: false });
    expect(typedChoice("1")).toEqual({ pos: 1, number: true });
    expect(typedChoice("Não")).toEqual({ pos: 2, number: false });
    expect(typedChoice("2")).toEqual({ pos: 2, number: true });
    expect(typedChoice("sim, mas muda pra sexta")).toBeNull();
    expect(typedChoice("3")).toBeNull();
  });

  it("atalho só vale com os botões na última mensagem; depois de incerto, sim é Tentar de novo", () => {
    const confirm = confirmComponent(REF);
    expect(shortcutTarget({ pos: 1, number: false }, confirm)).toEqual({ refId: REF, verb: "sim" });
    expect(shortcutTarget({ pos: 2, number: true }, confirm)).toEqual({ refId: REF, verb: "nao" });
    expect(shortcutTarget({ pos: 1, number: false }, { type: "options", options: [{ id: "op_1", title: "Sim" }, { id: "op_2", title: "Não" }] })).toBeNull();
    expect(shortcutTarget({ pos: 1, number: false }, null)).toBeNull();
    const uncertain = uncertainComponent(REF);
    expect(shortcutTarget({ pos: 1, number: false }, uncertain)).toEqual({ refId: REF, verb: "repetir" });
    // "não" depois do incerto não chama a equipe sozinho; o número 2, sim
    expect(shortcutTarget({ pos: 2, number: false }, uncertain)).toBeNull();
    expect(shortcutTarget({ pos: 2, number: true }, uncertain)).toEqual({ refId: REF, verb: "humano" });
  });

  it("referência que não pode ser usada: texto fixo pelo estado", () => {
    expect(unusableText("done")).toBe(CONFIRM_TEXTS.alreadyDone);
    expect(unusableText("superseded")).toBe(CONFIRM_TEXTS.expired);
    expect(unusableText("canceled")).toBe(CONFIRM_TEXTS.alreadyCanceled);
    expect(unusableText("running")).toBe(CONFIRM_TEXTS.running);
  });
});

describe("resumo do Confirmar", () => {
  const schema: ParamsSchema = { type: "object", properties: { itens: { type: "array", items: { type: "string" } }, entrega: { type: "string" }, troco: { type: "boolean" } }, required: ["itens"] };
  const map: IdMap = { "101": { categoria: null, rotulo: "Pizza Calabresa" }, "201": { categoria: null, rotulo: "Coca-Cola 2L" } };

  it("códigos viram os nomes do mapa, com a quantidade; os outros parâmetros como vieram", () => {
    expect(confirmationLines(schema, { itens: ["101", "101", "201"], entrega: "Rua das Flores, 10", troco: false }, map, null)).toEqual({
      lines: ["• 2x Pizza Calabresa", "• Coca-Cola 2L", "• Entrega: Rua das Flores, 10", "• Troco: não"],
      unresolved: [],
    });
  });

  it("código que o mapa não conhece: aparece cru e entra no aviso", () => {
    const r = confirmationLines(schema, { itens: ["101", "999"] }, map, null);
    expect(r.lines).toEqual(["• Itens: Pizza Calabresa, 999"]);
    expect(r.unresolved).toEqual(["999"]);
    expect(confirmationText(null, r.lines, [CONFIRM_TEXTS.unresolved(r.unresolved)])).toBe(`${CONFIRM_TEXTS.intro}\n\n• Itens: Pizza Calabresa, 999\n\n${CONFIRM_TEXTS.unresolved(["999"])}\n\n${CONFIRM_TEXTS.tail}`);
  });

  it("com prévia, o que o endpoint devolveu (resumo, itens e total)", () => {
    const preview = readConfirmation({ summary: "Entrega em 40 min", items: [{ nome: "Pizza Calabresa", quantidade: 2 }, "Coca-Cola 2L", { x: 1 }], total_cents: 11180 });
    expect(preview).toEqual({ summary: "Entrega em 40 min", items: ["2x Pizza Calabresa", "Coca-Cola 2L"], total_cents: 11180 });
    expect(confirmationLines(schema, { itens: ["999"] }, {}, preview).lines).toEqual(["Entrega em 40 min", "• 2x Pizza Calabresa", "• Coca-Cola 2L", "Total: R$ 111,80"]);
    expect(readConfirmation({ total_cents: -5 })).toBeNull();
  });

  it("a IA vê o schema do dev mais a frase do resumo, que não vai ao endpoint nem ao histórico", () => {
    const s = confirmToolSchema(schema);
    expect(s.required).toEqual(["itens", "boavoz_resumo"]);
    expect(Object.keys(s.properties)).toEqual(["itens", "entrega", "troco", "boavoz_resumo"]);
    expect(withoutSummary({ itens: ["101"], boavoz_resumo: "Confere:" })).toEqual({ itens: ["101"] });
    expect(paramsSchemaProblem({ type: "object", properties: { boavoz_x: { type: "string" } } })).toMatch(/reservado/);
  });
});

describe("mapa de ids e portão de parâmetros", () => {
  it("o mapa guarda o rótulo de todo objeto com id; barrado continua barrado", () => {
    expect(idLabels({ itens: [{ id: 101, nome: "Pizza Calabresa" }, { sku: "X1", title: "Coca" }, { id: 3 }] })).toEqual({ "101": { categoria: null, rotulo: "Pizza Calabresa" }, X1: { categoria: null, rotulo: "Coca" } });
    const merged = mergeIdMap({ "202": { categoria: "bebida", rotulo: "Cerveja" } }, { "202": { categoria: null, rotulo: "Cerveja" }, "101": { categoria: null, rotulo: "Pizza" } });
    expect(merged["202"].categoria).toBe("bebida");
    expect(idMapCategories(Object.values(merged))).toEqual(["bebida"]);
  });

  it("pedido com item barrado do mapa ou do dicionário: barra direto (o rótulo só aperta)", () => {
    const map: IdMap = { "202": { categoria: "bebida", rotulo: "Cerveja Heineken 600ml" }, "101": { categoria: null, rotulo: "Pizza Calabresa" } };
    const byMap = paramsGateFacts({ itens: ["101", "202"] }, map, { channel: "whatsapp" });
    expect(byMap.mapHits.map((h) => h.rotulo)).toEqual(["Cerveja Heineken 600ml"]);
    expect(paramsGateDecision(byMap, true)).toBe("barrar");
    const byLabel = paramsGateFacts({ itens: ["202"] }, { "202": { categoria: null, rotulo: "Cerveja Heineken 600ml" } }, { channel: "whatsapp" });
    expect(byLabel.dictionary).toContain("bebida");
    expect(paramsGateDecision(byLabel, true)).toBe("barrar");
    // outra "executa" (cancelar o pedido que tinha cerveja): não barra pelo mapa; o dicionário pergunta à IA
    expect(paramsGateDecision(byMap, false)).toBe("perguntar_ia");
  });

  it("pedido só com itens conhecidos passa; texto que o mapa não resolveu vai para a IA", () => {
    const map: IdMap = { "101": { categoria: null, rotulo: "Pizza Calabresa" } };
    expect(paramsGateDecision(paramsGateFacts({ itens: ["101"], quantidade: 2 }, map, { channel: "whatsapp" }), true)).toBe("liberar");
    expect(paramsGateDecision(paramsGateFacts({ itens: ["101"], observacao: "sem cebola" }, map, { channel: "whatsapp" }), true)).toBe("perguntar_ia");
    expect(paramsGateDecision(paramsGateFacts({ endereco: "Rua A" }, map, { channel: "whatsapp" }), false)).toBe("liberar");
  });

  it("o que a IA recebe quando o pedido é barrado", () => {
    expect(blockedOrderOutput(["Cerveja Heineken 600ml"], { destino: "pelo site loja.com" })).toMatchObject({ ok: false, motivo: "item_fora_do_chat", instrucao: expect.stringContaining("pelo site loja.com") });
  });
});

describe("chamada confirmada", () => {
  it("o corpo leva confirmed: true; a prévia, mode: preview", () => {
    expect(callBody({ name: "criar_pedido", bot_id: "b1" }, "call_x", { params: {}, confirmed: true })).toMatchObject({ confirmed: true });
    expect(callBody({ name: "criar_pedido", bot_id: "b1" }, "call_x", { params: {}, mode: "preview" })).toMatchObject({ confirmed: false, mode: "preview" });
  });

  it("numa executa, 2xx sem corpo ou sem JSON é sucesso e 409 é incerto; numa consulta, não", () => {
    expect(readResponse(200, "", { execute: true })).toMatchObject({ status: "ok", data: null, reply: null });
    expect(readResponse(201, "OK", { execute: true })).toMatchObject({ status: "ok" });
    expect(readResponse(409, '{"error":"in_progress"}', { execute: true })).toMatchObject({ status: "uncertain" });
    expect(readResponse(409, '{"error":"in_progress"}')).toMatchObject({ status: "error" });
    expect(readResponse(200, "")).toMatchObject({ status: "error" });
  });

  it("pede Confirmar: executa, ou consulta que o BoaVoz classificou como pedido", () => {
    expect(needsConfirmation({ type: "execute", creates_order: false })).toBe(true);
    expect(needsConfirmation({ type: "query", creates_order: true })).toBe(true);
    expect(needsConfirmation({ type: "query", creates_order: null })).toBe(false);
  });

  it("no clique, confere de novo: ativa, sem pausa do plano, nível e contexto", () => {
    const a = { active: true, paused_by_plan_at: null, min_level: "canal" as const, context_required: "none" as const, type: "execute" as const, creates_order: false };
    expect(stillCallable(a, { level: "canal", hasContext: false })).toBe(true);
    expect(stillCallable(a, { level: "anonimo", hasContext: false })).toBe(false);
    expect(stillCallable({ ...a, active: false }, { level: "canal", hasContext: false })).toBe(false);
    expect(stillCallable({ ...a, context_required: "signed" }, { level: "usuario", hasContext: false })).toBe(false);
    expect(stillCallable({ ...a, type: "query" }, { level: "canal", hasContext: false })).toBe(false);
  });

  it("depois do Confirmar, a IA escreve a partir do resultado e o histórico diz o que houve", () => {
    expect(confirmedNote("criar_pedido", { ok: true, data: { pedido: "T-1" }, confirmada: true })).toMatch(/acabou de ser executada[\s\S]*T-1[\s\S]*sem inventar/);
    expect(confirmedNote("criar_pedido", { ok: false, motivo: "falha" })).toMatch(/falhou/);
    expect(confirmedNote("criar_pedido", { ok: false, motivo: "nao_encontrado", detalhe: "item esgotado" })).toMatch(/não encontrou/);
    expect(actionsNote([{ name: "acao_criar_pedido", input: { itens: ["101"] }, output: { ok: true, confirmacao: "enviada" } }])).toMatch(/resumo com Confirmar e Cancelar enviado/);
    expect(actionsNote([{ name: "acao_criar_pedido", input: { itens: ["101"] }, output: { ok: true, data: { pedido: "T-1" }, confirmada: true } }])).toMatch(/executada depois do Confirmar/);
  });
});

describe("cadastro da ação", () => {
  it("tipo e prévia vêm do formulário; o aviso diz quando pede o Confirmar", () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({ name: "criar_pedido", description: "Cria o pedido do cliente", url: "https://api.loja.com/p", type: "execute", supports_preview: "on", active: "on" })) fd.append(k, v);
    expect(actionInputFromForm(fd)).toMatchObject({ type: "execute", supports_preview: true });
    expect(actionSavedMessage("criar_pedido", { active: true, type: "execute" }, false)).toMatch(/Confirmar/);
    expect(actionSavedMessage("reservar", { active: true, type: "query" }, true)).toMatch(/parece criar pedido/);
    expect(actionSavedMessage("buscar", { active: false, type: "query" }, false)).toBe("Ação buscar salva (desativada).");
  });
});
