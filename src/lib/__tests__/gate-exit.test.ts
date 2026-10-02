import { describe, expect, it } from "vitest";
import { checkExit, exitDecision, type ExitInput } from "../gate/exit";
import { gateButtons } from "../gate/flow";
import { AGE_NO, AGE_SHOW, AGE_YES } from "../gate/age";

const SITE = { canal: "site", destino: "https://bardoze.com.br/cardapio" };
const exit = (text: string, o: Partial<ExitInput> = {}) => checkExit({ text, channel: "whatsapp", contactPhone: "5521999990000", age: null, regulatedConversation: false, destination: SITE, ...o });

describe("portão na saída: o que NÃO pode mudar", () => {
  it("resposta comum sai igual", () => {
    const t = "A pizza de calabresa custa R$ 45. Atendemos de terça a domingo, das 18h às 23h.";
    expect(exit(t)).toEqual({ text: t, prohibited: [], regulated: [], payment: false, offerAdult: false, emptied: false });
  });

  it("negação e conselho de saúde ficam (não oferecem o item)", () => {
    for (const t of ["Não posso indicar remédio; procure um médico ou farmacêutico.", "Não vendemos cigarro, mas posso ajudar com o cardápio.", "Evite misturar bebida alcoólica com remédio e fale com um profissional."]) {
      expect(exit(t).text, t).toBe(t);
    }
  });

  it("com o Sim do 18+, bebida oferecida fica", () => {
    const t = "Temos Heineken long neck por R$ 12.";
    expect(exit(t, { age: "sim" }).text).toBe(t);
  });

  it("link do site para pedir e pagar não é dado de pagamento", () => {
    const t = "Para pedir e pagar, acesse https://bardoze.com.br/cardapio.";
    expect(exit(t, { age: "sim", regulatedConversation: true }).text).toBe(t);
  });

  it("dado de pagamento fora de conversa com bebida ou remédio fica", () => {
    const t = "Pode pagar no Pix: pix@pizzaria.com.br.";
    expect(exit(t).text).toBe(t);
  });
});

describe("portão na saída: o que sai", () => {
  it("bebida oferecida sem 18+: a frase sai, o resto fica, e vai o botão Ver opções 18+", () => {
    const r = exit("A pizza de calabresa custa R$ 45. Temos Heineken long neck por R$ 12.");
    expect(r.text).toBe("A pizza de calabresa custa R$ 45.");
    expect(r.regulated).toEqual(["bebida"]);
    expect(r.offerAdult).toBe(true);
    expect(exitDecision(r)).toBe("pede_18");
  });

  it("quem disse que não tem 18: a frase sai, sem botão", () => {
    const r = exit("A pizza custa R$ 45. A caipirinha custa R$ 18.", { age: "nao" });
    expect(r.text).toBe("A pizza custa R$ 45.");
    expect(r.offerAdult).toBe(false);
    expect(exitDecision(r)).toBe("nao_18");
  });

  it("só sobrou o item 18+: resposta vazia (o canal manda a pergunta de idade)", () => {
    const r = exit("Sim, temos cerveja! A Brahma lata sai por R$ 7.");
    expect(r.emptied).toBe(true);
    expect(r.regulated).toEqual(["bebida"]);
  });

  it("item proibido oferecido: a frase sai", () => {
    const r = exit("Temos narguilé e essência. A pizza custa R$ 45.");
    expect(r.text).toBe("A pizza custa R$ 45.");
    expect(r.prohibited).toEqual(["tabaco"]);
    expect(exitDecision(r)).toBe("proibido");
  });

  it("WhatsApp de fora do Brasil: bebida sai mesmo com o Sim", () => {
    const r = exit("Temos Heineken por R$ 12.", { age: "sim", contactPhone: "14155550123" });
    expect(r.emptied).toBe(true);
    expect(r.prohibited).toEqual(["bebida"]);
  });

  it("conversa com bebida: chave Pix e copia e cola saem; vai o caminho para finalizar", () => {
    const r = exit("A Heineken sai por R$ 12. Pode pagar no Pix: pix@bardoze.com.br.", { age: "sim", regulatedConversation: true });
    expect(r.payment).toBe(true);
    expect(r.text).toBe("A Heineken sai por R$ 12. O pagamento deste pedido não é feito por aqui. Para finalizar o pedido: https://bardoze.com.br/cardapio.");
    expect(exitDecision(r)).toBe("pagamento");
    expect(exit("Segue o Pix copia e cola: 00020126580014br.gov.bcb.pix0136abc", { age: "sim", regulatedConversation: true }).payment).toBe(true);
    expect(exit("Paga por esse link: https://mpago.la/2abc", { age: "sim", regulatedConversation: true }).payment).toBe(true);
    expect(exit("Faz o Pix pro CPF 123.456.789-00.", { age: "sim", regulatedConversation: true }).payment).toBe(true);
  });

  it("sem canal de venda cadastrado: só o aviso de que o pagamento não é por aqui", () => {
    const r = exit("Pode pagar no Pix: 21999990000.", { age: "sim", regulatedConversation: true, destination: null });
    expect(r.text).toBe("O pagamento deste pedido não é feito por aqui.");
  });
});

describe("botões do portão", () => {
  it("idade: Sim e Não; adulto: Ver opções 18+ (até 20 caracteres, limite da Meta)", () => {
    expect(gateButtons("idade").map((b) => b.id)).toEqual([AGE_YES, AGE_NO]);
    expect(gateButtons("adulto")).toEqual([{ id: AGE_SHOW, title: "Ver opções 18+" }]);
    for (const b of [...gateButtons("idade"), ...gateButtons("adulto")]) expect(b.title.length).toBeLessThanOrEqual(20);
  });
});
