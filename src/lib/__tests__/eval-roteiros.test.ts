import { describe, expect, it } from "vitest";
import { loadCases } from "../eval-cases";
import { checkTurn, loadRoutineBase, refusedCall, refusedTally, simulatedResponse, tapOption, toolLogLine, turnLine, type TurnOutcome } from "../eval-routines";
import { memoryDb } from "../memory-db";

/** Ferramentas que a espera de um caso de roteiro pode citar. */
const CHAT_TOOLS = ["registrar_lead", "chamar_atendente", "registrar_pergunta_sem_resposta", "registrar_recusa", "pedir_confirmacao_18", "mostrar_opcoes", "mostrar_link", "opcoes_do_texto"];
const ROUTINE_TOOLS = ["iniciar_roteiro", "concluir_passo", "informar_dado", "cancelar_roteiro", "trocar_contexto"];

describe("casos de roteiro (evals/casos-roteiros.jsonl e evals/roteiros.json)", () => {
  const base = loadRoutineBase();
  const cases = loadCases("roteiros");
  const tools = new Set([...CHAT_TOOLS, ...ROUTINE_TOOLS, ...base.acoes.map((a) => `acao_${a.name}`)]);

  it("a base passa pela conferência do painel e cada caso só cita roteiro, pessoa e ferramenta que existem", () => {
    expect(cases.length).toBeGreaterThan(5);
    for (const c of cases) {
      expect(c.turnos?.length, c.id).toBeGreaterThan(0);
      for (const name of c.roteiros ?? []) expect(base.roteiros.map((r) => r.name), c.id).toContain(name);
      if (c.lembrado) expect(Object.keys(base.pessoas), c.id).toContain(c.lembrado);
      for (const [k, t] of (c.turnos ?? []).entries()) {
        const where = `${c.id}, mensagem ${k + 1}`;
        // uma coisa por mensagem: texto, toque ou foto (o texto junto da foto é a legenda)
        expect([t.contato !== undefined && !t.foto, t.toque !== undefined, t.foto !== undefined].filter(Boolean).length, where).toBe(1);
        const e = t.espera ?? {};
        const named = [...(Array.isArray(e.ferramenta) ? e.ferramenta : e.ferramenta ? [e.ferramenta] : []), e.nao_usar ?? ""].flatMap((f) => f.split("|")).filter(Boolean);
        for (const f of named) expect([...tools], where).toContain(f);
        for (const re of [e.botoes, e.deve_conter, e.nao_deve_conter, e.conta]) {
          if (!re) continue;
          new RegExp(re, "i");
          expect(/[\u0000-\u001f]/.test(re), `${where}: caractere de controle na expressão`).toBe(false);
        }
        if (e.roteiro) expect(base.roteiros.map((r) => r.name), where).toContain(e.roteiro);
      }
    }
  });

  it("resposta simulada: pelos parâmetros, pela conta da conversa e a de sempre no fim", () => {
    const identify = base.acoes.find((a) => a.name === "identificar_cliente")!;
    expect(simulatedResponse(identify, { documento: "52998224725", cep: "01310100" }, null)?.pessoa).toBe("duas_contas");
    expect(simulatedResponse(identify, { documento: "52998224725", cep: "99999999" }, null)?.status).toBe(404);
    const invoice = base.acoes.find((a) => a.name === "buscar_fatura")!;
    expect(simulatedResponse(invoice, {}, { uc: "1002" })?.corpo).toMatchObject({ data: { valor: "R$ 87,15" } });
    expect(simulatedResponse(invoice, {}, null)?.status).toBe(404);
  });
});

describe("toque do contato num botão", () => {
  const c = { type: "options" as const, options: [{ id: "a", title: "Rua das Flores, 10" }, { id: "b", title: "Av. Brasil, 200" }] };

  it("pelo título (sem diferença de maiúsculas e acentos) ou pela posição", () => {
    expect(tapOption(c, "av. brasil, 200")?.id).toBe("b");
    expect(tapOption(c, "1")?.id).toBe("a");
    expect(tapOption(c, "3")).toBeNull();
    expect(tapOption(null, "1")).toBeNull();
  });
});

describe("conferência de cada mensagem", () => {
  const o = (over: Partial<TurnOutcome>): TurnOutcome => ({ messages: [{ text: "Me passa o CPF do titular?", component: null }], fixed: false, tools: [], calls: [], consent: false, handoff: false, run: null, ended: [], remembered: false, identified: false, account: null, ...over });

  it("roteiro, passo e fim", () => {
    expect(checkTurn({ roteiro: "Segunda via", passo: 1 }, o({ run: { name: "Segunda via", step: 1 } }))).toBeNull();
    expect(checkTurn({ passo: 2 }, o({ run: { name: "Segunda via", step: 1 } }))).toMatch(/passo 1 \(esperado 2\)/);
    expect(checkTurn({ roteiro: null }, o({ run: { name: "Segunda via", step: 1 } }))).toMatch(/esperado nenhum/);
    expect(checkTurn({ fim: "concluido" }, o({ ended: [{ status: "completed", reason: null }] }))).toBeNull();
    expect(checkTurn({ fim: "replaced" }, o({ ended: [{ status: "abandoned", reason: "cancelled" }] }))).toMatch(/replaced \(cancelled\)/);
  });

  it("ferramentas: qualquer uma (a|b), todas (lista) e as proibidas", () => {
    expect(checkTurn({ ferramenta: "iniciar_roteiro|concluir_passo" }, o({ tools: ["concluir_passo"] }))).toBeNull();
    expect(checkTurn({ ferramenta: ["acao_identificar_cliente", "acao_buscar_fatura"] }, o({ tools: ["acao_identificar_cliente"] }))).toMatch(/não usou acao_buscar_fatura/);
    expect(checkTurn({ nao_usar: "cancelar_roteiro|iniciar_roteiro" }, o({ tools: ["iniciar_roteiro"] }))).toBe("usou iniciar_roteiro");
  });

  it("parâmetros da ação: o texto contém, sem diferença de maiúsculas", () => {
    const calls = [{ action: "abrir_chamado", params: { foto_roteador: "Um Roteador com a luz LOS acesa" } }];
    expect(checkTurn({ parametros: { foto_roteador: "roteador" } }, o({ calls }))).toBeNull();
    expect(checkTurn({ parametros: { foto_roteador: "caneca" } }, o({ calls }))).toMatch(/nenhuma ação chamada/);
  });

  it("botões, texto, texto fixo, licença, equipe, número lembrado e conta", () => {
    const withButtons = o({ messages: [{ text: "Sobre qual conta?", component: { type: "options", options: [{ id: "x", title: "Rua das Flores, 10" }] } }] });
    expect(checkTurn({ botoes: "Rua das Flores" }, withButtons)).toBeNull();
    expect(checkTurn({ sem_botoes: true }, withButtons)).toMatch(/não devia ter botões/);
    expect(checkTurn({ deve_conter: "CPF", nao_deve_conter: "R\\$" }, o({}))).toBeNull();
    expect(checkTurn({ fixo: true }, o({}))).toMatch(/texto fixo/);
    expect(checkTurn({ licenca: true }, o({}))).toMatch(/licença/);
    expect(checkTurn({ equipe: true }, o({ handoff: true }))).toBeNull();
    expect(checkTurn({ numero_lembrado: false }, o({ remembered: true }))).toMatch(/continua lembrado/);
    expect(checkTurn({ conta: "Av\\. Brasil" }, o({ account: "Av. Brasil, 200" }))).toBeNull();
    expect(checkTurn({ conta: "Av\\. Brasil" }, o({}))).toMatch(/nenhuma/);
  });

  it("linha da mensagem no relatório: o que o contato fez e o que recebeu", () => {
    expect(turnLine({ toque: "Cancelar" }, { fixed: true, messages: [{ text: "Tudo bem,\nparei por aqui.", component: null }] })).toBe("toque: Cancelar → (fixo) Tudo bem, / parei por aqui.");
    expect(turnLine({ foto: "Uma caneca." }, null)).toBe("📷 Uma caneca.");
    expect(turnLine({ contato: "2" }, { fixed: false, messages: [{ text: "Certo!", component: null }], log: ["concluir_passo"] })).toBe("contato: 2 → Certo! {concluir_passo}");
    expect(toolLogLine("iniciar_roteiro", { nome: "Segunda via" }, { ok: false, instrucao: "Esse roteiro já está em andamento: siga o passo atual." })).toBe('iniciar_roteiro {"nome":"Segunda via"} → recusada (Esse roteiro já está em andamento: siga o passo atual.)');
    expect(toolLogLine("acao_buscar_fatura", {}, { ok: false, motivo: "precisa_identificar" })).toBe("acao_buscar_fatura → recusada (precisa_identificar)");
    // não encontrado é resposta do sistema da empresa (o roteiro anda por ela), não recusa
    expect(toolLogLine("acao_identificar_cliente", {}, { ok: false, motivo: "nao_encontrado" })).toBe("acao_identificar_cliente → ok: false (nao_encontrado)");
    expect(refusedCall("acao_identificar_cliente", { ok: false, motivo: "nao_encontrado" })).toBe(false);
    expect(refusedCall("mostrar_opcoes", { ok: false, instrucao: "..." })).toBe(true);
    expect(refusedCall("iniciar_roteiro", { ok: true })).toBe(false);
    expect(refusedTally([{ tools: ["iniciar_roteiro_recusada", "acao_buscar_fatura"] }, { tools: ["iniciar_roteiro_recusada", "mostrar_opcoes_recusada"] }])).toEqual({ total: 3, line: "iniciar_roteiro 2 · mostrar_opcoes 1" });
  });
});

describe("banco em memória", () => {
  it("ordena id numérico como número, conta sem trazer linhas, filtra com or e libera o limite de chamadas", async () => {
    const tables = { messages: Array.from({ length: 11 }, (_, i) => ({ id: i + 1, role: i % 2 ? "assistant" : "user", author: i === 3 ? "x" : null })) };
    const db = memoryDb(tables);
    const { data } = await db.from("messages").select("id").order("id", { ascending: false }).limit(2);
    expect((data ?? []).map((r) => r.id)).toEqual([11, 10]);
    const { count, data: none } = await db.from("messages").select("id", { count: "exact", head: true }).eq("role", "user");
    expect([count, none]).toEqual([6, null]);
    const { data: or } = await db.from("messages").select("id").or("author.is.null,author.neq.x");
    expect(or?.length).toBe(10);
    const { data: notX } = await db.from("messages").select("id").or("author.eq.y,author.not.is.null");
    expect((notX ?? []).map((r) => r.id)).toEqual([4]);
    expect(await db.rpc("hit_rate_limit", {})).toEqual({ data: true, error: null });
    expect((await db.rpc("match_documents", {})).error).toBeTruthy();
  });
});
