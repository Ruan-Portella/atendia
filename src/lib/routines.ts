/*
 * Roteiros (leva B2', Peça 6 da spec): passos que a IA segue quando a conversa entra num assunto
 * (segunda via, troca, orçamento). A IA conversa com naturalidade dentro do passo; o BoaVoz guarda a
 * ordem, valida os dados e escolhe o caminho (botão, resultado da ação), nunca a IA.
 *
 * Este arquivo é puro: tipos, limites, a leitura do formulário, a validação e os modelos prontos.
 * O motor na conversa fica na parte 2.
 */

/** Tetos técnicos (iguais para todos, não vendidos). */
export const ROUTINES_PER_BOT = 10;
export const STEPS_PER_ROUTINE = 12;
export const KEYWORDS_PER_ROUTINE = 5;
/** Lista do WhatsApp: até 10 linhas (até 3 viram botões). */
export const OPTIONS_PER_STEP = 10;
/** Botão do WhatsApp e resposta rápida do Instagram: 20 caracteres. */
export const OPTION_TITLE_MAX = 20;
export const NAME_MAX = 60;
export const WHEN_MIN = 10;
export const WHEN_MAX = 500;
export const STEP_TEXT_MAX = 500;
export const PATTERN_MAX = 200;
const KEYWORD_MAX = 30;
const ROUTINE_JSON_MAX = 30_000;

export const DATA_KINDS = ["cpf", "cnpj", "cpf_cnpj", "email", "telefone", "cep", "data", "numero", "regex"] as const;
export type DataKind = (typeof DATA_KINDS)[number];
export const DATA_KIND_LABEL: Record<DataKind, string> = {
  cpf: "CPF",
  cnpj: "CNPJ",
  cpf_cnpj: "CPF ou CNPJ",
  email: "e-mail",
  telefone: "telefone",
  cep: "CEP",
  data: "data",
  numero: "número",
  regex: "formato próprio (regex)",
};

export const STEP_TYPES = ["instrucao", "dado", "botoes", "acao"] as const;
export type StepType = (typeof STEP_TYPES)[number];
export const STEP_TYPE_LABEL: Record<StepType, string> = { instrucao: "Instrução", dado: "Pedir um dado", botoes: "Botões", acao: "Ação" };

/** Para onde o roteiro vai depois de um passo, de um botão ou de um resultado de ação. */
export type Destination = { to: "proximo" } | { to: "passo"; step: string } | { to: "encerrar" } | { to: "atendente" };

export type RoutineStep =
  | { id: string; type: "instrucao"; text: string; next: Destination }
  | { id: string; type: "dado"; text: string; kind: DataKind; variable: string; pattern: string | null; next: Destination }
  | { id: string; type: "botoes"; text: string; variable: string | null; options: Array<{ title: string; next: Destination }> }
  | { id: string; type: "acao"; text: string; action: string; results: Record<string, Destination> };

export interface RoutineInput {
  name: string;
  when_to_use: string;
  keywords: string[];
  steps: RoutineStep[];
  active: boolean;
  template: RoutineTemplateId | null;
}

export interface RoutineRow extends RoutineInput {
  id: string;
  bot_id: string;
  created_at: string;
  updated_at: string;
}

/** Linhas fixas da tabela "resultado → destino" do passo de ação (Peça 6). */
export const FIXED_RESULTS = ["ok", "nao_encontrado", "erro"] as const;
export const RESULT_LABEL: Record<string, string> = { ok: "deu certo (ok)", nao_encontrado: "não encontrou (nao_encontrado)", erro: "falhou (erro)" };

/** A mensagem que é só uma destas palavras nunca começa roteiro: descadastro, confirmações, opções e o pedido de atendente. */
const RESERVED_KEYWORDS = new Set(["sair", "parar", "stop", "cancelar", "sim", "nao", "ok", "confirmo", "confirmar", "atendente", "humano", "menu", "oi", "ola"]);

const STEP_ID_RE = /^[a-z0-9]{6,12}$/;
const VARIABLE_RE = /^[a-z][a-z0-9_]{1,29}$/;

/**
 * Pedido de número de cartão, de conta bancária ou de código de verificação: a política do WhatsApp
 * proíbe pedir os números completos, e o código que chega por SMS é o golpe clássico. "Número da
 * conta" sozinho fica de fora: conta de luz e conta contrato são pedidos legítimos.
 */
const FORBIDDEN_ASK_RE =
  /n[uú]mero\s+(?:d[oa]s?|de)\s+(?:seu\s+|sua\s+)?cart[aã]o|dados\s+do\s+cart[aã]o|\bcvv\b|\bcvc\b|c[oó]digo\s+de\s+seguran[cç]a\s+do\s+cart[aã]o|validade\s+do\s+cart[aã]o|conta\s+(?:banc[aá]ria|corrente|poupan[cç]a)|ag[eê]ncia\s+e\s+(?:o\s+n[uú]mero\s+da\s+)?conta|c[oó]digo\s+(?:de\s+verifica[cç][aã]o|que\s+(?:chegou|recebeu)|do\s+sms|por\s+sms)|token\s+do\s+banco/i;
/** No passo que pede o dado, também a senha (no texto de uma instrução, "a senha do wi-fi é…" é informação, não pedido). */
const PASSWORD_ASK_RE = /\bsenha\b/i;
/** Números de cartão de teste: uma regex própria que aceita um deles pediria cartão. */
const CARD_SAMPLES = ["4111111111111111", "4111 1111 1111 1111", "5500-0000-0000-0004", "378282246310005"];

/** Forma de comparar a palavra-chave com a mensagem: minúsculas, sem acentos nem pontuação, espaços simples ("2ª" vira "2a"). */
export function normalizeKeyword(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Palavras-chave do formulário ("2VIA, segunda via"): normalizadas, sem repetir. */
export function parseKeywords(raw: string): string[] {
  const out: string[] = [];
  for (const part of raw.split(/[,;\n]/)) {
    const k = normalizeKeyword(part);
    if (k && !out.includes(k)) out.push(k);
  }
  return out;
}

/** Destino legível ("passo 3", "chamar atendente"), para o painel e para os testes. Pura. */
export function destinationLabel(d: Destination, steps: RoutineStep[]): string {
  if (d.to === "proximo") return "próximo passo";
  if (d.to === "encerrar") return "encerrar";
  if (d.to === "atendente") return "chamar atendente";
  return `passo ${steps.findIndex((s) => s.id === d.step) + 1}`;
}

function readDestination(v: unknown): Destination | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.to === "proximo" || o.to === "encerrar" || o.to === "atendente") return { to: o.to };
  if (o.to === "passo" && typeof o.step === "string") return { to: "passo", step: o.step };
  return null;
}

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Lê o roteiro que o editor manda (JSON no campo "routine"). Não valida as regras (isso é o
 * routineProblem): só monta o formato, descartando campos que não existem. Pura.
 */
export function routineInputFromJson(raw: string): RoutineInput | { error: string } {
  if (raw.length > ROUTINE_JSON_MAX) return { error: "O roteiro ficou grande demais. Encurte os textos ou use menos passos." };
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { error: "Não foi possível ler o roteiro. Recarregue a página e tente de novo." };
  }
  if (!j || typeof j !== "object" || !Array.isArray(j.steps)) return { error: "Roteiro sem passos." };
  const steps: RoutineStep[] = [];
  for (const s of j.steps as unknown[]) {
    if (!s || typeof s !== "object") return { error: "Passo inválido." };
    const o = s as Record<string, unknown>;
    const id = str(o.id, 20);
    const text = str(o.text, STEP_TEXT_MAX + 1);
    const next = readDestination(o.next) ?? { to: "proximo" };
    if (o.type === "instrucao") steps.push({ id, type: "instrucao", text, next });
    else if (o.type === "dado") {
      const kind = (DATA_KINDS as readonly string[]).includes(String(o.kind)) ? (o.kind as DataKind) : null;
      if (!kind) return { error: "Escolha o tipo do dado em todos os passos que pedem um dado." };
      steps.push({ id, type: "dado", text, kind, variable: str(o.variable, 40), pattern: kind === "regex" ? str(o.pattern, PATTERN_MAX + 1) || null : null, next });
    } else if (o.type === "botoes") {
      const options = Array.isArray(o.options)
        ? (o.options as unknown[]).map((x) => {
            const opt = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
            return { title: str(opt.title, OPTION_TITLE_MAX + 1), next: readDestination(opt.next) ?? { to: "proximo" as const } };
          })
        : [];
      steps.push({ id, type: "botoes", text, variable: str(o.variable, 40) || null, options });
    } else if (o.type === "acao") {
      const results: Record<string, Destination> = {};
      if (o.results && typeof o.results === "object") {
        for (const [k, v] of Object.entries(o.results as Record<string, unknown>)) {
          const d = readDestination(v);
          if (d) results[k] = d;
        }
      }
      steps.push({ id, type: "acao", text, action: str(o.action, 48), results });
    } else return { error: "Tipo de passo desconhecido." };
  }
  const template = typeof j.template === "string" && (TEMPLATE_IDS as readonly string[]).includes(j.template) ? (j.template as RoutineTemplateId) : null;
  return {
    name: str(j.name, NAME_MAX + 1).replace(/\s+/g, " "),
    when_to_use: str(j.when_to_use, WHEN_MAX + 1),
    keywords: Array.isArray(j.keywords) ? parseKeywords((j.keywords as unknown[]).map(String).join(",")) : parseKeywords(str(j.keywords, 400)),
    steps,
    active: j.active !== false,
    template,
  };
}

/** O roteiro tem passo de ação (precisa do pacote Integrações para funcionar). Pura. */
export const routineUsesActions = (r: Pick<RoutineInput, "steps">): boolean => r.steps.some((s) => s.type === "acao");

/** Todos os textos que a IA vai ler ou que o contato vai ver (para a checagem de pedido proibido). */
function routineTexts(r: RoutineInput): string[] {
  const out = [r.name, r.when_to_use];
  for (const s of r.steps) {
    out.push(s.text);
    if (s.type === "botoes") out.push(...s.options.map((o) => o.title));
  }
  return out;
}

/** Códigos com letras: a regex que aceita algum deles é de código de pedido, protocolo ou cupom, não de cartão. */
const CODE_SAMPLES = ["ABC123", "PED-2024-01", "XYZW9876"];

/**
 * A regex própria foi feita para número de cartão? Aceita um número de cartão e nenhum código com
 * letras (um formato de pedido como [A-Za-z0-9-]{4,20} aceita os dois e passa).
 */
function patternAsksCard(pattern: string): boolean {
  let re: RegExp;
  try {
    re = new RegExp(`^(?:${pattern})$`);
  } catch {
    return false;
  }
  return CARD_SAMPLES.some((c) => re.test(c)) && !CODE_SAMPLES.some((c) => re.test(c));
}

export interface RoutineContext {
  /** Ações cadastradas no chatbot (ativas ou não): o passo de ação escolhe uma delas. */
  actions: Array<{ name: string; outcomes: string[] }>;
  /** Os outros roteiros do mesmo chatbot (nome e palavras-chave não podem repetir). */
  others: Array<{ id: string; name: string; keywords: string[] }>;
  /** A conta tem o pacote Integrações (passo de ação). */
  integrations: boolean;
}

function destinationProblem(d: Destination, steps: RoutineStep[], self: string, where: string, allowSelf: boolean): string | null {
  if (d.to !== "passo") return null;
  if (!steps.some((s) => s.id === d.step)) return `${where}: o passo de destino não existe mais. Escolha outro destino.`;
  if (!allowSelf && d.step === self) return `${where}: não pode voltar para o próprio passo (ficaria repetindo a ação sem o contato responder).`;
  return null;
}

/**
 * Confere o roteiro antes de salvar. Devolve a primeira mensagem de erro, em português, ou null.
 * Pura: o chamador passa as ações, os outros roteiros e o pacote.
 */
export function routineProblem(r: RoutineInput, ctx: RoutineContext): string | null {
  if (r.name.length < 2 || r.name.length > NAME_MAX) return `O nome do roteiro precisa ter de 2 a ${NAME_MAX} caracteres.`;
  if (ctx.others.some((o) => o.name.trim().toLowerCase() === r.name.toLowerCase())) return "Já existe um roteiro com esse nome neste chatbot.";
  if (r.when_to_use.length < WHEN_MIN || r.when_to_use.length > WHEN_MAX) return `"Quando usar" precisa ter de ${WHEN_MIN} a ${WHEN_MAX} caracteres: é por ele que a IA reconhece o assunto.`;

  if (r.keywords.length > KEYWORDS_PER_ROUTINE) return `Até ${KEYWORDS_PER_ROUTINE} palavras-chave por roteiro.`;
  for (const k of r.keywords) {
    if (k.length < 2 || k.length > KEYWORD_MAX) return `Palavra-chave "${k}": de 2 a ${KEYWORD_MAX} caracteres.`;
    if (k.split(" ").length > 3) return `Palavra-chave "${k}": até 3 palavras.`;
    if (/^\d+$/.test(k)) return `Palavra-chave "${k}": só números confunde com a escolha de uma opção. Use letras junto.`;
    if (RESERVED_KEYWORDS.has(k)) return `"${k}" não pode ser palavra-chave: é usada para descadastro, confirmação ou atendente.`;
    const other = ctx.others.find((o) => o.keywords.includes(k));
    if (other) return `A palavra-chave "${k}" já começa o roteiro "${other.name}".`;
  }

  if (!r.steps.length) return "Coloque pelo menos um passo.";
  if (r.steps.length > STEPS_PER_ROUTINE) return `Até ${STEPS_PER_ROUTINE} passos por roteiro.`;
  const ids = new Set<string>();
  const variables = new Set<string>();
  for (const [i, s] of r.steps.entries()) {
    const where = `Passo ${i + 1}`;
    if (!STEP_ID_RE.test(s.id) || ids.has(s.id)) return `${where}: identificador inválido. Recarregue a página e tente de novo.`;
    ids.add(s.id);
    if (s.text.length < 3 || s.text.length > STEP_TEXT_MAX) return `${where}: o texto precisa ter de 3 a ${STEP_TEXT_MAX} caracteres.`;
  }
  for (const [i, s] of r.steps.entries()) {
    const where = `Passo ${i + 1}`;
    if (s.type === "instrucao") {
      const p = destinationProblem(s.next, r.steps, s.id, where, false);
      if (p) return p;
    } else if (s.type === "dado") {
      if (!VARIABLE_RE.test(s.variable)) return `${where}: o nome da variável vai em minúsculas, sem espaço nem acento (ex.: documento, cep_entrega).`;
      if (variables.has(s.variable)) return `${where}: a variável "${s.variable}" já é usada em outro passo.`;
      variables.add(s.variable);
      if (PASSWORD_ASK_RE.test(s.text)) return `${where}: o BoaVoz nunca pede senha ao contato.`;
      if (s.kind === "regex") {
        if (!s.pattern || s.pattern.length > PATTERN_MAX) return `${where}: escreva a regex do formato (até ${PATTERN_MAX} caracteres).`;
        try {
          new RegExp(s.pattern);
        } catch {
          return `${where}: a regex não é válida.`;
        }
        if (patternAsksCard(s.pattern)) return `${where}: essa regex aceita número de cartão. A política do WhatsApp proíbe pedir cartão ou conta.`;
      }
      const p = destinationProblem(s.next, r.steps, s.id, where, false);
      if (p) return p;
    } else if (s.type === "botoes") {
      if (s.variable !== null) {
        if (!VARIABLE_RE.test(s.variable)) return `${where}: o nome da variável vai em minúsculas, sem espaço nem acento (ex.: motivo).`;
        if (variables.has(s.variable)) return `${where}: a variável "${s.variable}" já é usada em outro passo.`;
        variables.add(s.variable);
      }
      if (s.options.length < 2 || s.options.length > OPTIONS_PER_STEP) return `${where}: de 2 a ${OPTIONS_PER_STEP} botões.`;
      const titles = new Set<string>();
      for (const o of s.options) {
        if (!o.title || o.title.length > OPTION_TITLE_MAX) return `${where}: cada botão tem de 1 a ${OPTION_TITLE_MAX} caracteres (limite do WhatsApp e do Instagram).`;
        if (titles.has(o.title.toLowerCase())) return `${where}: dois botões com o mesmo texto.`;
        titles.add(o.title.toLowerCase());
        const p = destinationProblem(o.next, r.steps, s.id, `${where}, botão "${o.title}"`, true);
        if (p) return p;
      }
    } else {
      if (!ctx.integrations) return `${where}: passo com ação faz parte do pacote Integrações. Assine em Cobrança → Assinatura.`;
      const action = ctx.actions.find((a) => a.name === s.action);
      if (!action) return `${where}: escolha uma ação deste chatbot (cadastre na aba Ações).`;
      const allowed = new Set<string>([...FIXED_RESULTS, ...action.outcomes]);
      for (const k of Object.keys(s.results)) if (!allowed.has(k)) return `${where}: a ação ${action.name} não declara o resultado "${k}".`;
      for (const k of FIXED_RESULTS) if (!s.results[k]) return `${where}: escolha para onde ir quando a ação ${RESULT_LABEL[k]}.`;
      for (const [k, d] of Object.entries(s.results)) {
        const p = destinationProblem(d, r.steps, s.id, `${where}, resultado ${k}`, false);
        if (p) return p;
      }
    }
  }
  for (const t of routineTexts(r)) if (FORBIDDEN_ASK_RE.test(t)) return "O roteiro pede número de cartão, de conta, senha ou código de verificação. A política do WhatsApp proíbe e é o caminho dos golpes: tire esse pedido.";
  return null;
}

/** Os roteiros ligados, em texto, para a análise do bot (o que a IA vai seguir também conta). Pura. */
export function routinesSummary(rows: Array<Pick<RoutineInput, "name" | "when_to_use" | "steps">>, max = 1500): string {
  return rows
    .map((r) => `${r.name} (quando usar: ${r.when_to_use}): ${r.steps.map((s, i) => `${i + 1}. ${s.text}${s.type === "botoes" ? ` [${s.options.map((o) => o.title).join(" / ")}]` : ""}`).join(" ")}`)
    .join("\n")
    .slice(0, max);
}

/** Destinos padrão de um passo de ação novo: segue no ok, chama atendente no resto. */
export function defaultResults(outcomes: string[] = []): Record<string, Destination> {
  const r: Record<string, Destination> = { ok: { to: "proximo" }, nao_encontrado: { to: "atendente" }, erro: { to: "atendente" } };
  for (const o of outcomes) if (!(o in r)) r[o] = { to: "atendente" };
  return r;
}

/** Identificador de passo (curto, só letras e números). */
export function newStepId(): string {
  let s = "";
  while (s.length < 8) s += Math.random().toString(36).slice(2);
  return s.slice(0, 8);
}

/* ------------------------------------------------------------------ modelos prontos */

export const TEMPLATE_IDS = ["orcamento", "agendamento", "troca", "segunda_via", "rastreio"] as const;
export type RoutineTemplateId = (typeof TEMPLATE_IDS)[number];

export interface RoutineTemplate {
  id: RoutineTemplateId;
  label: string;
  /** Uma frase no seletor de modelos. */
  summary: string;
  /** Nome sugerido para a ação do passo de ação (a agência escolhe a dela). */
  actionHint?: string;
  routine: Omit<RoutineInput, "template">;
}

const fixedIds = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`);

function buildTemplates(): RoutineTemplate[] {
  const [o1, o2, o3] = fixedIds("orcam", 3);
  const [a1, a2, a3, a4] = fixedIds("agend", 4);
  const [t1, t2, t3, t4] = fixedIds("troca", 4);
  const [s1, s2, s3] = fixedIds("segvia", 3);
  const [r1, r2, r3] = fixedIds("rastro", 3);
  return [
    {
      id: "orcamento",
      label: "Orçamento",
      summary: "Coleta o que a pessoa precisa e passa para a equipe montar o orçamento.",
      routine: {
        name: "Orçamento",
        when_to_use: "O cliente pede orçamento, quer saber quanto fica um serviço sob medida ou um trabalho específico.",
        keywords: ["orcamento"],
        active: true,
        steps: [
          { id: o1, type: "instrucao", text: "Pergunte o que a pessoa precisa orçar, com os detalhes que mudam o preço: o quê, quantidade ou tamanho, prazo e local.", next: { to: "proximo" } },
          { id: o2, type: "dado", text: "Peça um telefone com DDD para a equipe enviar o orçamento.", kind: "telefone", variable: "telefone", pattern: null, next: { to: "proximo" } },
          { id: o3, type: "instrucao", text: "Resuma o pedido em até 3 linhas e diga que a equipe vai preparar o orçamento e responder por aqui. Não prometa valor nem prazo.", next: { to: "atendente" } },
        ],
      },
    },
    {
      id: "agendamento",
      label: "Pedido de agendamento",
      summary: "Sem agenda ligada: coleta o serviço e os horários e passa para a equipe confirmar.",
      routine: {
        name: "Pedido de agendamento",
        when_to_use: "O cliente quer marcar, remarcar ou agendar um horário, consulta, visita ou serviço.",
        keywords: ["agendar"],
        active: true,
        steps: [
          { id: a1, type: "instrucao", text: "Pergunte qual serviço a pessoa quer agendar, se ela ainda não disse.", next: { to: "proximo" } },
          { id: a2, type: "instrucao", text: "Pergunte os dias e horários que ficam bons para ela (pode ser mais de uma opção). Não confirme horário: quem confirma é a equipe.", next: { to: "proximo" } },
          { id: a3, type: "dado", text: "Peça um telefone com DDD para a equipe confirmar o horário.", kind: "telefone", variable: "telefone", pattern: null, next: { to: "proximo" } },
          { id: a4, type: "instrucao", text: "Resuma o pedido (serviço, dias e horários) e diga que a equipe confirma o horário por aqui.", next: { to: "atendente" } },
        ],
      },
    },
    {
      id: "troca",
      label: "Troca e devolução",
      summary: "Pega o pedido e o motivo, explica a política da base e passa para a equipe.",
      routine: {
        name: "Troca e devolução",
        when_to_use: "O cliente quer trocar ou devolver um produto, ou recebeu um produto com defeito ou diferente do pedido.",
        keywords: ["troca", "devolucao"],
        active: true,
        steps: [
          { id: t1, type: "instrucao", text: "Peça o número do pedido ou da nota fiscal.", next: { to: "proximo" } },
          {
            id: t2,
            type: "botoes",
            text: "Pergunte o que aconteceu com o produto.",
            variable: "motivo",
            options: [
              { title: "Veio com defeito", next: { to: "proximo" } },
              { title: "Produto errado", next: { to: "proximo" } },
              { title: "Não serviu", next: { to: "proximo" } },
              { title: "Desisti da compra", next: { to: "proximo" } },
            ],
          },
          { id: t3, type: "instrucao", text: "Explique a política de troca e devolução que está na base (prazo e condições). Se a base não tiver, diga que a equipe explica.", next: { to: "proximo" } },
          { id: t4, type: "instrucao", text: "Resuma o caso (pedido e motivo) e diga que a equipe segue com a troca ou a devolução por aqui.", next: { to: "atendente" } },
        ],
      },
    },
    {
      id: "segunda_via",
      label: "Segunda via",
      summary: "Pede o CPF ou CNPJ e busca a segunda via no sistema do cliente (precisa de uma ação).",
      actionHint: "buscar_segunda_via",
      routine: {
        name: "Segunda via",
        when_to_use: "O cliente pede segunda via de boleto, conta ou fatura.",
        keywords: ["2via", "segunda via"],
        active: true,
        steps: [
          { id: s1, type: "dado", text: "Peça o CPF ou CNPJ do titular, só os números.", kind: "cpf_cnpj", variable: "documento", pattern: null, next: { to: "proximo" } },
          { id: s2, type: "acao", text: "Busque a segunda via com o documento informado e envie o que a ação devolver.", action: "", results: { ok: { to: "encerrar" }, nao_encontrado: { to: "passo", step: s3 }, erro: { to: "atendente" } } },
          { id: s3, type: "instrucao", text: "Diga que não encontrou nada em aberto para esse documento e que a equipe confere por aqui.", next: { to: "atendente" } },
        ],
      },
    },
    {
      id: "rastreio",
      label: "Rastreio de pedido",
      summary: "Pede o número do pedido e consulta a situação no sistema do cliente (precisa de uma ação).",
      actionHint: "rastrear_pedido",
      routine: {
        name: "Rastreio de pedido",
        when_to_use: "O cliente pergunta onde está o pedido, qual o prazo de entrega ou quer rastrear uma encomenda.",
        keywords: ["rastreio", "rastrear"],
        active: true,
        steps: [
          { id: r1, type: "dado", text: "Peça o número do pedido (está no e-mail ou no comprovante da compra).", kind: "regex", variable: "pedido", pattern: "[A-Za-z0-9-]{4,20}", next: { to: "proximo" } },
          { id: r2, type: "acao", text: "Consulte o pedido com o número informado e conte a situação e o prazo que a ação devolver.", action: "", results: { ok: { to: "encerrar" }, nao_encontrado: { to: "passo", step: r3 }, erro: { to: "atendente" } } },
          {
            id: r3,
            type: "botoes",
            text: "Diga que não encontrou esse pedido e pergunte se a pessoa quer tentar outro número.",
            variable: null,
            options: [
              { title: "Tentar de novo", next: { to: "passo", step: r1 } },
              { title: "Falar com a equipe", next: { to: "atendente" } },
            ],
          },
        ],
      },
    },
  ];
}

/** Os 5 modelos prontos (decisão de 19/10/2026). */
export const ROUTINE_TEMPLATES: RoutineTemplate[] = buildTemplates();

/**
 * O modelo pronto para o editor deste chatbot: com passo de ação, escolhe a ação do nome sugerido
 * (ou a única ação do chatbot); sem ela, o passo fica para a agência escolher. Pura.
 */
export function templateFor(id: RoutineTemplateId, actions: Array<{ name: string; outcomes: string[] }>): RoutineInput {
  const t = ROUTINE_TEMPLATES.find((x) => x.id === id)!;
  const pick = actions.find((a) => a.name === t.actionHint) ?? (actions.length === 1 ? actions[0] : null);
  const steps = t.routine.steps.map((s): RoutineStep => {
    if (s.type !== "acao") return structuredClone(s);
    const results = structuredClone(s.results);
    for (const o of pick?.outcomes ?? []) if (!(o in results)) results[o] = { to: "atendente" };
    return { ...s, action: pick?.name ?? "", results };
  });
  return { ...structuredClone(t.routine), steps, template: id };
}
