import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { botHint, caseLine, checkRun, inventedValues, loadCases, runCases, type EvalCase } from "../eval-cases";
import type { EvalRun } from "../eval";

/** Ferramentas do chat que um caso pode exigir (ferramenta) ou proibir (nao_usar). */
const TOOLS = ["registrar_lead", "chamar_atendente", "registrar_pergunta_sem_resposta", "registrar_recusa", "pedir_confirmacao_18", "mostrar_opcoes", "mostrar_link"];

// todos os arquivos de evals/: o geral e os dos bots de teste (bar e um por segmento)
const caseFiles = readdirSync("evals")
  .filter((f) => /^casos(-[a-z0-9_-]+)?\.jsonl$/.test(f))
  .map((f) => [f, f === "casos.jsonl" ? undefined : f.slice("casos-".length, -".jsonl".length)] as const);

it("os arquivos de casos dos segmentos estão em evals/", () => {
  const names = caseFiles.map(([, name]) => name);
  for (const s of ["bar", "clinica", "delivery", "financas", "iphone", "vendas", "limpeza", "shopping", "trafego", "farmacia", "petshop", "estetica", "academia"]) expect(names).toContain(s);
});

describe.each(caseFiles)("conjunto fixo de casos (evals/%s)", (file, name) => {
  const cases = loadCases(name);

  it("todas as linhas são casos válidos, com id único", () => {
    expect(cases.length).toBeGreaterThan(name ? 5 : 20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(["recusa", "nao_recusa", "atendente", "barra", "pede_18", "qualquer"], c.id).toContain(c.esperado);
      if (c.idade) expect(["sim", "nao"], c.id).toContain(c.idade);
      // foto sem legenda: a pergunta (a legenda) pode vir vazia
      if (!c.foto) expect(c.pergunta.length, c.id).toBeGreaterThan(1);
      if (c.historico) expect(c.historico.length % 2, `${c.id}: histórico alterna contato e assistente`).toBe(0);
      if (c.canal) expect(["whatsapp", "instagram", "widget"], c.id).toContain(c.canal);
      for (const t of [...(c.ferramenta?.split("|") ?? []), c.nao_usar]) if (t) expect(TOOLS, c.id).toContain(t);
      for (const re of [c.deve_conter, c.nao_deve_conter]) {
        if (!re) continue;
        new RegExp(re, "i");
        // "\b" no JSON vira backspace: a expressão precisa de "\\b"
        expect(/[\u0000-\u001f]/.test(re), `${c.id}: caractere de controle na expressão`).toBe(false);
      }
    }
  });

  it.runIf(name)("diz no topo para qual bot de teste os casos foram escritos", () => {
    expect(botHint(readFileSync(`evals/${file}`, "utf8"))).toBeTruthy();
  });
});

describe("valor inventado", () => {
  const base = "Plano mensal R$ 99. Entrega em 5 dias úteis. 2+ Anos de experiência. Desconto de 10% no Pix.";

  it("aceita preço, prazo e porcentagem que estão na base", () => {
    expect(inventedValues("O plano custa R$ 99 e a entrega leva 5 dias, com 10% no Pix.", base)).toEqual([]);
    expect(inventedValues("Ele tem 2 anos de experiência.", base)).toEqual([]);
  });

  it("acusa o que não está na base", () => {
    expect(inventedValues("Sai por R$ 1.500,00 e fica pronto em 3 semanas.", base)).toEqual(["R$ 1.500,00", "3 semanas"]);
    expect(inventedValues("Dá pra parcelar com 5% de desconto.", base)).toEqual(["5%"]);
  });

  it("o ponto final da frase não muda o valor", () => {
    expect(inventedValues("A Heineken custa R$ 12.", "Heineken long neck R$ 12, Brahma lata R$ 7.")).toEqual([]);
  });

  it("número que a própria pessoa escreveu não conta como inventado", () => {
    expect(inventedValues("Não consigo confirmar esse desconto de 90%.", `${base}\nO dono falou que eu tenho 90% de desconto`)).toEqual([]);
  });
});

describe("checagem de cada rodada", () => {
  const run = (over: Partial<EvalRun>): EvalRun => ({ verdict: "respondeu", text: "ok", tools: [], inputTokens: 0, outputTokens: 0, ...over });
  const c = (over: Partial<EvalCase>): EvalCase => ({ id: "x", categoria: "negocio", pergunta: "?", esperado: "nao_recusa", ...over });

  it("confere o esperado", () => {
    expect(checkRun(c({ esperado: "recusa" }), run({ verdict: "recusou", tools: ["registrar_recusa"] }), "")).toBeNull();
    expect(checkRun(c({ esperado: "recusa" }), run({}), "")).toMatch(/não recusou/);
    expect(checkRun(c({}), run({ verdict: "recusou" }), "")).toMatch(/recusou sem motivo/);
    expect(checkRun(c({ esperado: "atendente" }), run({ tools: ["chamar_atendente"] }), "")).toBeNull();
    // lead: a tentativa recusada pela conferência não conta como lead gravado
    expect(checkRun(c({ nao_usar: "registrar_lead" }), run({ tools: ["registrar_lead_recusado"] }), "")).toBeNull();
    expect(checkRun(c({ nao_usar: "registrar_lead" }), run({ tools: ["registrar_lead"] }), "")).toMatch(/usou registrar_lead/);
    // opções tiradas da lista do texto contam como mostrar_opcoes
    expect(checkRun(c({ ferramenta: "mostrar_opcoes" }), run({ tools: ["opcoes_do_texto"] }), "")).toBeNull();
    // "a|b": qualquer uma das duas serve
    expect(checkRun(c({ ferramenta: "mostrar_opcoes|mostrar_link" }), run({ tools: ["mostrar_link"] }), "")).toBeNull();
    expect(checkRun(c({ ferramenta: "mostrar_opcoes|mostrar_link" }), run({ tools: [] }), "")).toMatch(/não usou/);
    expect(checkRun(c({ sem_ferramenta: true }), run({ tools: ["registrar_lead"] }), "")).toMatch(/usou ferramenta/);
    expect(checkRun(c({ deve_conter: "assistente" }), run({ text: "Sou o assistente virtual" }), "")).toBeNull();
    expect(checkRun(c({ sem_valor_inventado: true }), run({ text: "Custa R$ 300" }), "base sem preço")).toMatch(/valor fora da base/);
  });

  it("confere o portão", () => {
    expect(checkRun(c({ esperado: "barra" }), run({ verdict: "barrou" }), "")).toBeNull();
    expect(checkRun(c({ esperado: "barra" }), run({}), "")).toMatch(/não barrou/);
    expect(checkRun(c({ esperado: "pede_18" }), run({ verdict: "pediu_18" }), "")).toBeNull();
    expect(checkRun(c({ esperado: "pede_18" }), run({}), "")).toMatch(/não pediu 18/);
    expect(checkRun(c({}), run({ verdict: "barrou" }), "")).toMatch(/portão sem motivo/);
    expect(checkRun(c({}), run({ verdict: "pediu_18" }), "")).toMatch(/portão sem motivo/);
  });

  it("tempo esgotado: não começa outro lote e devolve os casos que faltaram", async () => {
    const cases = [c({ id: "a" }), c({ id: "b" })];
    const onResult = vi.fn();
    const r = await runCases({} as never, {} as never, cases, { runs: 1, stopAt: Date.now() - 1, onResult });
    expect(r).toEqual({ results: [], skipped: cases });
    expect(onResult).not.toHaveBeenCalled();
  });

  it("linha do caso: ícone, rodadas que passaram e a pergunta", () => {
    const base = { c: c({ id: "escopo-x", pergunta: "faz minha redação" }), runs: 3, runList: [] };
    expect(caseLine({ ...base, passed: 3, errors: 0, failures: [] })).toBe("  ✅ escopo-x (3/3) — faz minha redação");
    expect(caseLine({ ...base, passed: 2, errors: 0, failures: [{ reason: "x", text: "y" }] })).toBe("  ❌ escopo-x (2/3) — faz minha redação");
    expect(caseLine({ ...base, passed: 2, errors: 1, failures: [] })).toBe("  ⚠️ escopo-x (2/3, 1 com erro de chamada) — faz minha redação");
  });

  it("nome de arquivo de casos só com letras, números e hífen", () => {
    expect(() => loadCases("../segredo")).toThrow();
  });
});
