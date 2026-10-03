import { describe, expect, it } from "vitest";
import { handoffOrder, handoffStatus } from "../handoff-status";
import { isPaymentData, mentionsPayment, regulatedConversation } from "../gate/payment";

const now = Date.parse("2026-10-02T15:00:00Z");
const ago = (min: number) => new Date(now - min * 60_000).toISOString();

describe("situação do atendimento humano", () => {
  it("pediu atendente: aguardando; encerrada: nada", () => {
    expect(handoffStatus({ handoff_requested_at: ago(5) }, now)).toEqual({ state: "aguardando", urgent: false, waiting: true });
    expect(handoffStatus({ handoff_requested_at: ago(5), handled_at: ago(1) }, now)).toBeNull();
    expect(handoffStatus({}, now)).toBeNull();
  });

  it("assumida: em atendimento; com a fala do contato sem resposta há mais de 1 hora, volta para aguardando", () => {
    const base = { handoff_requested_at: ago(200), takeover_at: ago(180) };
    expect(handoffStatus({ ...base, last_contact_at: ago(30), last_reply_at: ago(40) }, now)?.state).toBe("em_atendimento");
    expect(handoffStatus({ ...base, last_contact_at: ago(90), last_reply_at: ago(100) }, now)).toEqual({ state: "sem_resposta", urgent: false, waiting: true });
    // a equipe respondeu depois: segue em atendimento
    expect(handoffStatus({ ...base, last_contact_at: ago(120), last_reply_at: ago(100) }, now)?.state).toBe("em_atendimento");
    // assumida sem pedido do contato também conta
    expect(handoffStatus({ takeover_at: ago(180), last_contact_at: ago(70) }, now)?.state).toBe("sem_resposta");
  });

  it("urgência vale para o pedido atual, não para um pedido comum depois", () => {
    expect(handoffStatus({ handoff_requested_at: ago(10), handoff_urgent_at: ago(10) }, now)?.urgent).toBe(true);
    expect(handoffStatus({ handoff_requested_at: ago(10), handoff_urgent_at: ago(500) }, now)?.urgent).toBe(false);
  });

  it("ordem: urgente, depois quem espera (o mais antigo primeiro), depois em atendimento", () => {
    const urgent = { handoff_requested_at: ago(5), handoff_urgent_at: ago(5) };
    const oldWait = { handoff_requested_at: ago(60) };
    const newWait = { handoff_requested_at: ago(10) };
    const busy = { handoff_requested_at: ago(100), takeover_at: ago(90), last_contact_at: ago(5), last_reply_at: ago(4) };
    expect([busy, newWait, urgent, oldWait].sort((a, b) => handoffOrder(a, b, now))).toEqual([urgent, oldWait, newWait, busy]);
  });
});

describe("pagamento numa conversa com bebida ou remédio", () => {
  it("conversa marcada por 24 horas", () => {
    expect(regulatedConversation(ago(60), now)).toBe(true);
    expect(regulatedConversation(ago(25 * 60), now)).toBe(false);
    expect(regulatedConversation(null, now)).toBe(false);
  });

  it("a equipe falando de Pix, boleto ou link de pagamento: pergunta", () => {
    expect(mentionsPayment("Pode fazer o PIX que eu separo")).toBe(true);
    expect(mentionsPayment("segue o link de pagamento: mpago.la/abc")).toBe(true);
    expect(mentionsPayment("Transferência para a conta da loja")).toBe(true);
    expect(mentionsPayment("Pode retirar na loja amanhã")).toBe(false);
  });

  it("a saída da IA continua exigindo o dado (chave ou código), não só a palavra", () => {
    expect(isPaymentData("Pague no pix")).toBe(false);
    expect(isPaymentData("Chave pix: loja@exemplo.com")).toBe(true);
  });
});
