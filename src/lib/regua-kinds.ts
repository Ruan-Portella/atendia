import { STATUS_LABEL, templateBody, templateVariables, validateTemplate, type Template, type TemplateCategory } from "./template-text";

/*
 * Os tipos de régua (leva Réguas) e o modelo pronto de cada uma (parte 3): o nome, o prazo, a
 * categoria pedida à Meta, as variáveis que o planejador manda e o texto sugerido, editável. Puro:
 * a tela das réguas usa no navegador; o motor fica em reguas.ts.
 */

export type ReguaKind = "aniversario" | "sumido" | "pos_atendimento" | "lembrete" | "sem_resposta";

/** Na ordem de importância: numa mesma rodada, a pessoa recebe a primeira régua que couber. */
export const REGUA_KINDS: ReguaKind[] = ["lembrete", "aniversario", "pos_atendimento", "sem_resposta", "sumido"];

export const REGUA_LABEL: Record<ReguaKind, string> = {
  aniversario: "Aniversário",
  sumido: "Faz tempo que você não vem",
  pos_atendimento: "Pós-atendimento",
  lembrete: "Lembrete antes do horário",
  sem_resposta: "Sem resposta",
};

/** O que cada régua faz, em uma frase. */
export const REGUA_DESCRIPTION: Record<ReguaKind, string> = {
  aniversario: "No dia do aniversário do contato (o dia e o mês da ficha, da planilha ou da API).",
  sumido: "Quando a pessoa passa do prazo sem vir: conta da última visita registrada ou, sem ela, da última mensagem.",
  pos_atendimento: "Depois da visita registrada (ficha, planilha ou API) ou da conversa encerrada pela equipe.",
  lembrete: "Antes do horário marcado (da ficha, da planilha ou da API), nunca depois dele.",
  sem_resposta: "Quando a loja (IA ou equipe) mandou a última mensagem e a pessoa não respondeu.",
};

/** O prazo de cada régua: a unidade, o padrão e os limites (o aniversário não tem prazo). */
export const REGUA_DELAY: Record<ReguaKind, { unit: "dias" | "horas"; default: number; min: number; max: number } | null> = {
  aniversario: null,
  sumido: { unit: "dias", default: 30, min: 7, max: 365 },
  pos_atendimento: { unit: "horas", default: 48, min: 1, max: 168 },
  lembrete: { unit: "horas", default: 24, min: 1, max: 72 },
  sem_resposta: { unit: "dias", default: 2, min: 1, max: 30 },
};

/** As réguas que saem na hora escolhida (as outras saem quando o prazo vence, das 8h às 20h). */
export const REGUA_HAS_SEND_HOUR: Record<ReguaKind, boolean> = { aniversario: true, sumido: true, pos_atendimento: false, lembrete: false, sem_resposta: true };

/**
 * A categoria do modelo pronto. Aniversário e "faz tempo" são promoção (só para quem aceitou
 * novidades); lembrete, pós-atendimento e sem resposta falam do atendimento da pessoa, sem oferta
 * (utilidade). Se a Meta reclassificar o modelo, a régua pausa e avisa o dono.
 */
export const REGUA_CATEGORY: Record<ReguaKind, TemplateCategory> = { aniversario: "MARKETING", sumido: "MARKETING", pos_atendimento: "UTILITY", lembrete: "UTILITY", sem_resposta: "UTILITY" };

/** As variáveis que o planejador manda, na ordem ({{1}}, {{2}}…). */
export const REGUA_VARIABLES: Record<ReguaKind, string[]> = {
  aniversario: ["o primeiro nome"],
  sumido: ["o primeiro nome"],
  pos_atendimento: ["o primeiro nome"],
  lembrete: ["o primeiro nome", "a data (20/12)", "a hora (14:30)"],
  sem_resposta: ["o primeiro nome"],
};

/** Os exemplos das variáveis para a Meta aprovar. */
export const REGUA_EXAMPLES: Record<ReguaKind, string[]> = { aniversario: ["Ana"], sumido: ["Ana"], pos_atendimento: ["Ana"], lembrete: ["Ana", "20/12", "14:30"], sem_resposta: ["Ana"] };

/** O texto sugerido do modelo de cada régua, com o nome do negócio fixo (sem artigo: "a equipe de X"). Pura. */
export function reguaTemplateBody(kind: ReguaKind, company: string): string {
  const name = company.replace(/[{}*_~`\n]/g, "").trim().slice(0, 60) || "nossa loja";
  const texts: Record<ReguaKind, string> = {
    aniversario: `Feliz aniversário, {{1}}! 🎉 Toda a equipe de ${name} deseja um dia muito especial para você. Obrigado por estar com a gente!`,
    sumido: `Oi, {{1}}! Faz tempo que você não aparece por aqui, e a equipe de ${name} sente sua falta. Se quiser saber das novidades, é só responder esta mensagem.`,
    pos_atendimento: `Olá, {{1}}! Aqui é a equipe de ${name}. Como foi o seu atendimento com a gente? Se ficou alguma dúvida sobre ele, é só responder esta mensagem.`,
    lembrete: `Olá, {{1}}! A equipe de ${name} lembra do seu horário: {{2}}, às {{3}}. Se precisar remarcar, é só responder esta mensagem.`,
    sem_resposta: `Olá, {{1}}! Aqui é a equipe de ${name}. Nossa conversa ficou parada: ainda podemos ajudar com o que você precisava? É só responder esta mensagem para continuarmos.`,
  };
  return texts[kind];
}

/** O nome do modelo na Meta: regua_<tipo>; com o texto novo, regua_<tipo>_2, _3… (a Meta não repete nome). Pura. */
export function reguaTemplateName(kind: ReguaKind, existing: string[]): string {
  const base = `regua_${kind}`;
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Problema no texto do modelo da régua (as regras da Meta e as variáveis que o planejador manda), ou null. Pura. */
export function reguaTemplateProblem(kind: ReguaKind, body: string): string | null {
  const base = validateTemplate({ name: `regua_${kind}`, body, examples: REGUA_EXAMPLES[kind] });
  if (base) return base;
  const need = REGUA_VARIABLES[kind];
  if (templateVariables(body).length !== need.length) return `O texto desta régua usa ${need.length} variáve${need.length === 1 ? "l" : "is"}: ${need.map((v, i) => `{{${i + 1}}} ${v}`).join(", ")}.`;
  return null;
}

export type ReguaTemplateStatus = "ausente" | "em_analise" | "aprovado" | "recusado";

export interface ReguaTemplateState {
  status: ReguaTemplateStatus;
  /** A categoria em que a Meta deixou o modelo (pode ser outra que a pedida). */
  category: string | null;
  /** O texto do modelo na Meta. */
  body: string | null;
  /** O que a tela mostra ("em análise", "reprovado: motivo"…). */
  label: string;
  /** A Meta mudou a categoria pedida (utilidade virou marketing: só vai para quem aceitou novidades). */
  reclassified: boolean;
}

/** O modelo da régua na lista da Meta. Pura. */
export function reguaTemplateState(kind: ReguaKind, templates: Template[], name: string | null): ReguaTemplateState {
  const t = name ? templates.find((x) => x.name === name) : undefined;
  if (!t) return { status: "ausente", category: null, body: null, label: "sem modelo", reclassified: false };
  const s = t.status.toUpperCase();
  const status: ReguaTemplateStatus = s === "APPROVED" ? "aprovado" : s === "PENDING" || s === "IN_APPEAL" ? "em_analise" : "recusado";
  const reason = t.rejected_reason && t.rejected_reason.toUpperCase() !== "NONE" ? `: ${t.rejected_reason}` : "";
  return { status, category: t.category.toUpperCase(), body: templateBody(t), label: `${STATUS_LABEL[s] ?? s.toLowerCase()}${status === "recusado" ? reason : ""}`, reclassified: t.category.toUpperCase() !== REGUA_CATEGORY[kind] };
}
