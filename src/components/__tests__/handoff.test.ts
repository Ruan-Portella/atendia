import { describe, expect, it } from "vitest";
import { handoffReducer } from "../chat-window";

const start = { mode: "bot" as const, timeline: [], count: 0, lastAgentId: 0 };

describe("estado do atendimento humano no widget", () => {
  it("pedido → pessoa entra → mensagem → encerra: avisa na conversa", () => {
    let s = handoffReducer(start, { type: "count", n: 2 });
    s = handoffReducer(s, { type: "asked" });
    expect(s.mode).toBe("requested");
    s = handoffReducer(s, { type: "server", mode: "agent" });
    s = handoffReducer(s, { type: "agent", messages: [{ id: 7, content: "Oi, sou a Ana" }] });
    s = handoffReducer(s, { type: "server", mode: "bot" });
    expect(s.mode).toBe("bot");
    expect(s.timeline.map((x) => x.kind)).toEqual(["joined", "agent", "ended"]);
    expect(s.timeline.every((x) => x.after === 2)).toBe(true);
    expect(s.lastAgentId).toBe(7);
  });

  it("o histórico com a ferramenta não prende o aviso de 'avisamos a equipe' (o bug)", () => {
    let s = handoffReducer(start, { type: "asked" });
    s = handoffReducer(s, { type: "server", mode: "agent" });
    s = handoffReducer(s, { type: "server", mode: "bot" });
    // nova resposta do servidor sem atendimento: continua bot
    s = handoffReducer(s, { type: "server", mode: "bot" });
    expect(s.mode).toBe("bot");
  });

  it("não duplica mensagem da equipe vinda em duas consultas", () => {
    let s = handoffReducer(start, { type: "agent", messages: [{ id: 1, content: "a" }] });
    s = handoffReducer(s, { type: "agent", messages: [{ id: 1, content: "a" }, { id: 2, content: "b" }] });
    expect(s.timeline.map((x) => x.key)).toEqual(["a1", "a2"]);
  });

  it("sair de 'pedido' sem ninguém ter entrado não mostra 'encerrado'", () => {
    let s = handoffReducer(start, { type: "asked" });
    s = handoffReducer(s, { type: "server", mode: "bot" });
    expect(s.timeline).toEqual([]);
  });
});
