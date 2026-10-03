/*
 * Regras do portão de proibidos e regulamentados (Peça 10, Camada 1). Arquivo ÚNICO, mantido pela
 * BoaVoz e usado em todos os lugares (entrada, base, saída, ativação, campanhas, Política de Uso
 * Aceitável). Não há tabela no banco: a auditoria é o histórico do git. Toda mudança é um PR que
 * passa pelos testes (src/lib/__tests__/gate-rules.test.ts) e pelo conjunto fixo de casos
 * (evals/casos.jsonl), e sobe RULES_VERSION (os trechos da base são reclassificados).
 *
 * Revisão trimestral junto com as políticas da Meta e a lista de MIP da Anvisa (lmip.ts).
 * Itens marcados "a confirmar" seguem a leitura conservadora até a resposta do advogado / da Meta.
 */

/** Sobe a cada mudança no dicionário, nas exceções, nos níveis ou no quadro canal × categoria. */
export const RULES_VERSION = "2026-10-01.1";

/** Versão da classificação dos trechos da base (parte 6): muda com as regras (e a lista da Anvisa, que sobe RULES_VERSION) ou o prompt. */
export const BASE_GATE_VERSION = `${RULES_VERSION}/base-1`;

export type GateLevel = "permitido" | "regulamentado" | "proibido";
export type GateChannel = "whatsapp" | "instagram" | "widget";

export type GateCategory =
  // regulamentados (Brasil): fala e mostra só para 18+, nunca fecha a venda no chat
  | "bebida"
  | "medicamento" // MIP é regulamentado; o que não está na LMIP (lmip.ts) conta como proibido
  // proibidos (WhatsApp e Instagram)
  | "remedio_receita"
  | "tabaco"
  | "produto_saude"
  | "suplemento"
  | "estetica_injetavel"
  | "drogas"
  | "armas"
  | "apostas"
  | "adulto"
  | "namoro"
  | "animais"
  | "partes_corpo"
  | "perigosos"
  | "cripto"
  | "cambio"
  | "credito_curto"
  | "multinivel"
  | "fraude"
  | "votacao"; // só no WhatsApp

export const CATEGORIES: Record<GateCategory, { level: Exclude<GateLevel, "permitido">; label: string; onlyWhatsapp?: boolean; note?: string }> = {
  bebida: { level: "regulamentado", label: "bebida alcoólica" },
  medicamento: { level: "regulamentado", label: "remédio", note: "MIP pela LMIP (lmip.ts); fármaco, forma ou concentração fora da lista = proibido" },
  remedio_receita: { level: "proibido", label: "remédio com receita" },
  tabaco: { level: "proibido", label: "tabaco e cigarro eletrônico", note: "vape proibido pela Anvisa (RDC 855/2024); cigarro comum é legal, a proibição é prudência da BoaVoz" },
  produto_saude: { level: "proibido", label: "produto médico ou de saúde" },
  suplemento: { level: "proibido", label: "suplemento", note: "vitaminas e whey no chat: a confirmar com a Meta" },
  estetica_injetavel: { level: "proibido", label: "procedimento estético injetável", note: "oferecer, dar preço ou cobrar; agendar avaliação é permitido" },
  drogas: { level: "proibido", label: "drogas" },
  armas: { level: "proibido", label: "armas, munição e explosivos" },
  apostas: { level: "proibido", label: "apostas", note: "pagar para concorrer a prêmio; promoção vinculada à compra e loteria estatal não entram" },
  adulto: { level: "proibido", label: "conteúdo e produtos adultos", note: "inclui preservativo e lubrificante; testes de gravidez e ovulação não são proibidos" },
  namoro: { level: "proibido", label: "namoro e encontros" },
  animais: { level: "proibido", label: "venda de animais vivos", note: "exceto gado" },
  partes_corpo: { level: "proibido", label: "partes e fluidos do corpo" },
  perigosos: { level: "proibido", label: "materiais perigosos" },
  cripto: { level: "proibido", label: "cripto, ofertas de moeda e opções binárias" },
  cambio: { level: "proibido", label: "câmbio (troca de moeda)", note: "nunca usar \"real\" ou \"reais\" como termo" },
  credito_curto: { level: "proibido", label: "empréstimo de curto prazo e cobrança de dívidas de terceiros", note: "consignado, banco, financiamento, fiador, seguro-fiança e imobiliária não são proibidos (a confirmar com o advogado)" },
  multinivel: { level: "proibido", label: "marketing multinível (recrutamento)" },
  fraude: { level: "proibido", label: "modelos fraudulentos" },
  votacao: { level: "proibido", label: "sistemas de votação", onlyWhatsapp: true },
};

/**
 * Dicionário (etapa 1, em toda mensagem): termos e marcas comuns em português, espanhol e inglês,
 * já sem acento e em minúsculas. O plural simples (s, es) casa sozinho. É só um filtro: quem decide
 * se o NEGÓCIO está oferecendo o item é a etapa 2 (IA), porque a palavra aparecer não basta
 * ("bebi cerveja ontem" não dispara nada). Nunca use "real" ou "reais" como termo.
 */
export const DICTIONARY: Record<GateCategory, string[]> = {
  bebida: [
    "bebida alcoolica", "cerveja", "chopp", "chope", "breja", "vinho", "espumante", "champanhe", "champagne", "prosecco", "vodka", "vodca",
    "whisky", "whiskey", "uisque", "gin", "rum", "cachaca", "pinga", "tequila", "licor", "conhaque", "sake", "aperol", "campari", "martini",
    "caipirinha", "caipiroska", "drink alcoolico", "beer", "wine", "liquor", "cerveza", "vino",
    "heineken", "budweiser", "brahma", "skol", "antarctica", "stella artois", "amstel", "itaipava", "eisenbahn", "devassa", "spaten",
    "corona extra", "absolut", "smirnoff", "johnnie walker", "jack daniels", "chivas", "red label", "black label", "jagermeister",
    "baileys", "bacardi", "ballantines", "velho barreiro", "ypioca", "skol beats",
  ],
  medicamento: ["remedio", "medicamento", "dipirona", "paracetamol", "ibuprofeno", "acido acetilsalicilico", "aas", "loratadina", "omeprazol", "simeticona", "nimesulida"],
  remedio_receita: [
    "remedio controlado", "receita controlada", "tarja preta", "tarja vermelha", "antibiotico", "amoxicilina", "azitromicina", "cefalexina",
    "rivotril", "clonazepam", "diazepam", "alprazolam", "zolpidem", "sibutramina", "ozempic", "semaglutida", "mounjaro", "tirzepatida",
    "sildenafil", "viagra", "tadalafila", "cialis", "anticoncepcional", "isotretinoina", "roacutan", "tramadol", "codeina", "morfina",
    "ritalina", "metilfenidato", "venvanse", "fluoxetina", "sertralina", "escitalopram", "prescription drug",
  ],
  tabaco: [
    "cigarro", "maco de cigarro", "tabaco", "charuto", "narguile", "essencia de narguile", "palheiro", "vape", "pod descartavel", "pod", "cigarro eletronico",
    "ignite", "elfbar", "juul", "e cig", "marlboro", "lucky strike", "dunhill", "cigarette", "cigarrillo",
  ],
  produto_saude: [
    "lente de contato", "oculos de grau", "oculos de leitura", "termometro", "aparelho de pressao", "medidor de pressao", "glicosimetro",
    "oximetro", "nebulizador", "inalador", "bomba de leite", "bomba tira leite", "formula infantil", "leite em po infantil", "nan supreme",
    "aptamil", "nestogeno", "teste de covid", "teste rapido de covid", "kit de primeiros socorros", "esparadrapo",
  ],
  suplemento: ["suplemento", "whey", "whey protein", "creatina", "multivitaminico", "vitamina", "colageno", "pre treino", "bcaa", "termogenico", "omega 3"],
  estetica_injetavel: ["botox", "toxina botulinica", "preenchimento labial", "preenchimento facial", "acido hialuronico", "bioestimulador", "harmonizacao facial"],
  drogas: ["maconha", "cocaina", "crack", "lsd", "ecstasy", "skunk", "haxixe", "lanca perfume", "lolo", "oleo de cannabis", "weed"],
  armas: ["arma de fogo", "pistola", "revolver", "espingarda", "rifle", "municao", "polvora", "explosivo", "taser", "spray de pimenta", "gun"],
  apostas: ["aposta", "bet", "cassino", "tigrinho", "jogo do tigre", "jogo do bicho", "roleta", "caca niquel", "rifa", "palpite premiado", "casino", "betting"],
  adulto: ["sex shop", "vibrador", "consolo", "lubrificante", "preservativo", "camisinha", "conteudo adulto", "pornografia", "porno", "acompanhante", "garota de programa", "nudes", "onlyfans"],
  namoro: ["app de namoro", "site de namoro", "site de relacionamento", "encontros casuais", "namoro online"],
  animais: ["filhote a venda", "venda de filhote", "venda de filhotes", "papagaio", "arara", "sagui", "mico leao", "jabuti", "animal silvestre"],
  partes_corpo: ["venda de orgao", "venda de rim", "leite materno", "venda de sangue", "doador de rim"],
  perigosos: ["fogos de artificio", "rojao", "material radioativo", "produto toxico"],
  cripto: ["bitcoin", "criptomoeda", "cripto", "ethereum", "usdt", "nft", "opcoes binarias", "trade binario", "forex", "airdrop"],
  cambio: ["cambio", "casa de cambio", "troca de moeda", "comprar dolar", "vender dolar", "dolar turismo", "comprar euro", "cotacao do dolar"],
  credito_curto: ["agiota", "emprestimo rapido", "emprestimo na hora", "credito rapido", "adiantamento de salario", "cobranca de dividas", "recuperacao de credito", "payday loan"],
  multinivel: ["marketing multinivel", "piramide financeira", "renda extra garantida", "ganhe por indicacao de revendedores"],
  fraude: ["documento falso", "diploma falso", "cnh falsa", "clonar cartao", "conta laranja", "seguidores falsos"],
  votacao: ["votacao", "sistema de votacao", "urna eletronica", "enquete eleitoral"],
};

/**
 * Exceções globais (frases que contêm um termo mas não são o item). Só de fontes gerais escritas
 * pelo revisor (receitas comuns, expressões), nunca de trechos de conversa: pelos termos de Tech
 * Provider, os dados de um cliente só servem a ele. Cada exceção tem 2+ palavras e contém um termo
 * da categoria, sem ser igual a um termo (testado). Exceção de um bot só = bot_gate_exceptions.
 */
export const EXCEPTIONS: Partial<Record<GateCategory, string[]>> = {
  bebida: [
    "frango na cerveja", "costela na cerveja", "bolo de rum", "pudim de rum", "vinagre de vinho", "risoto ao vinho", "molho de vinho",
    "molho ao vinho", "cerveja sem alcool", "vinho sem alcool", "cor vinho", "vermelho vinho",
  ],
  suplemento: ["vitamina de banana", "vitamina de abacate", "vitamina de morango", "vitamina de frutas", "vitamina de mamao"],
  tabaco: ["cigarro de chocolate", "pod cast"],
  armas: ["pistola de cola", "pistola de pintura", "pistola de ar quente"],
  animais: ["arara de roupa", "arara de roupas"],
  cambio: ["cambio automatico", "cambio manual", "caixa de cambio", "carro com cambio"],
  partes_corpo: ["exame de leite materno", "banco de leite materno"],
  apostas: ["aposta no seu sonho"],
};

/**
 * Quadro canal × categoria (regulamentados). Tipado: o compilador exige todas as células.
 * - "18_sem_venda": fala, mostra e promove só para 18+ (no WhatsApp, só +55); nunca fecha a venda
 *   no chat (nem o bot, nem a ação, nem o atendente); o pedido vai pelo link ou outro canal.
 * - "livre": sem trava da BoaVoz (widget do site, decisão de 25/09/2026); a verificação legal de
 *   idade e as licenças ficam com o negócio (termos e Política de Uso Aceitável).
 */
export type ChannelRule = "18_sem_venda" | "livre";
export const CHANNEL_MATRIX: Record<"bebida" | "medicamento", Record<GateChannel, ChannelRule>> = {
  // Instagram: trava temporária, escolha da BoaVoz (avaliar na C pública, com aval da Meta e do advogado)
  bebida: { whatsapp: "18_sem_venda", instagram: "18_sem_venda", widget: "livre" },
  // Instagram: pela internet, MIP só pelo site da própria farmácia (Anvisa, RDC 44/2009)
  medicamento: { whatsapp: "18_sem_venda", instagram: "18_sem_venda", widget: "livre" },
};

/**
 * Nível efetivo de uma categoria no canal. No widget não há portão. No WhatsApp, regulamentado só
 * vale para números do Brasil (+55): para outros países o item vira proibido (a Meta só libera
 * esses setores em países listados; América do Sul em avaliação).
 */
export function effectiveLevel(category: GateCategory, channel: GateChannel, contactPhone?: string | null): GateLevel {
  if (channel === "widget") return "permitido";
  const c = CATEGORIES[category];
  if (c.onlyWhatsapp && channel !== "whatsapp") return "permitido";
  if (c.level === "regulamentado" && channel === "whatsapp" && contactPhone && /^\d+$/.test(contactPhone) && !contactPhone.startsWith("55")) return "proibido";
  return c.level;
}

/** Infrações da Meta (account_update ACCOUNT_VIOLATION) que limitam os fluxos de regulamentados na WABA. */
export const RESTRICTING_META_VIOLATIONS = ["ALCOHOL", "DRUGS", "HEALTHCARE"] as const;

/* ------------------------------------------------------------------ textos fixos (Textos legais, seção 6) */

export const GATE_TEXTS = {
  /** Pedido só de item proibido: sem a IA principal. */
  prohibited: "Desculpe, não conseguimos atender esse pedido por aqui. Posso ajudar com outra coisa?",
  /** Pedido de item proibido junto com outro assunto: vai antes da resposta da IA, sem citar o item. */
  prohibitedMixed: "Um dos itens que você pediu não conseguimos atender por aqui.",
  /** Item proibido que veio do pedido da própria pessoa (dados de uma ação): onde ver o pedido completo. */
  prohibitedSeeElsewhere: (where: string) => `Não conseguimos falar desse item por aqui. Os detalhes completos ficam fora do chat: ${where}. Posso ajudar com outra coisa?`,
  /** Barreira de idade da Meta para mensagens (não é verificação legal de idade). */
  ageQuestion: "Antes de continuar: você tem 18 anos ou mais?",
  ageYes: "Sim",
  ageNo: "Não",
  /** Depois do "Não". */
  ageDenied: "Tudo bem! Por aqui não posso falar sobre esse tipo de produto, mas sigo à disposição para o resto.",
  /** Pedido só de item 18+ por quem já disse que não tem 18: sem a IA principal. */
  under18: "Por aqui não posso falar sobre esse tipo de produto, mas sigo à disposição para o resto.",
  /** Botão nas respostas refeitas sem os itens 18+ (até 20 caracteres, limite da Meta). */
  showAdultOptions: "Ver opções 18+",
  /** Texto do botão quando a resposta é longa demais para ir junto (WhatsApp: 1.024 caracteres). */
  showAdultPrompt: "Quer ver também as opções para maiores de 18 anos?",
  /** Item regulamentado, 18+ confirmado, na hora de pedir. */
  orderElsewhere: (categoria: string, canal: string, destino: string) => `${categoria} você pede direto pelo ${canal}: ${destino}. Posso ajudar com mais alguma coisa?`,
  /** Sem nenhum canal declarado para itens regulamentados. */
  cannotSellHere: "Esse item não conseguimos vender por aqui.",
  /** Saída: dado de pagamento tirado da resposta numa conversa com bebida ou remédio. */
  paymentNotHere: "O pagamento deste pedido não é feito por aqui.",
  /** Saída: para onde ir finalizar (site, app, telefone ou retirada). */
  finishOrder: (destino: string) => `Para finalizar o pedido: ${destino}.`,
} as const;
