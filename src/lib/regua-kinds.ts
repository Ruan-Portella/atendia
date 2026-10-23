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

/** O modelo da régua na lista da Meta (`kind`: o tipo da pronta, ou a categoria pedida na personalizada). Pura. */
export function reguaTemplateState(kind: ReguaKind | TemplateCategory, templates: Template[], name: string | null): ReguaTemplateState {
  const requested = kind === "MARKETING" || kind === "UTILITY" ? kind : REGUA_CATEGORY[kind];
  const t = name ? templates.find((x) => x.name === name) : undefined;
  if (!t) return { status: "ausente", category: null, body: null, label: "sem modelo", reclassified: false };
  const s = t.status.toUpperCase();
  const status: ReguaTemplateStatus = s === "APPROVED" ? "aprovado" : s === "PENDING" || s === "IN_APPEAL" ? "em_analise" : "recusado";
  const reason = t.rejected_reason && t.rejected_reason.toUpperCase() !== "NONE" ? `: ${t.rejected_reason}` : "";
  return { status, category: t.category.toUpperCase(), body: templateBody(t), label: `${STATUS_LABEL[s] ?? s.toLowerCase()}${status === "recusado" ? reason : ""}`, reclassified: t.category.toUpperCase() !== requested };
}

/* ------------------------------------------------------------------ régua personalizada (23/10/2026) */

/** A data que dispara a régua personalizada: uma das datas da ficha ou uma data nova com nome. */
export type ReguaTrigger = "aniversario" | "ultima_visita" | "horario" | "data";
export const REGUA_TRIGGERS: ReguaTrigger[] = ["aniversario", "ultima_visita", "horario", "data"];
export const REGUA_TRIGGER_LABEL: Record<ReguaTrigger, string> = { aniversario: "Aniversário", ultima_visita: "Última visita ou compra", horario: "Horário marcado", data: "Uma data nova" };
export const isReguaTrigger = (v: unknown): v is ReguaTrigger => typeof v === "string" && (REGUA_TRIGGERS as string[]).includes(v);

/**
 * Os limites do "quando sai": dias antes (negativo) ou depois (positivo) da data, 0 no dia; no
 * horário marcado, horas antes (como o lembrete). A última visita só tem "depois".
 */
export const CUSTOM_OFFSET: Record<ReguaTrigger, { min: number; max: number }> = {
  aniversario: { min: -60, max: 60 },
  ultima_visita: { min: 0, max: 365 },
  horario: { min: 1, max: 72 },
  data: { min: -365, max: 365 },
};

export type ReguaCategory = "MARKETING" | "UTILITY";

/** O que a régua personalizada guarda (o que a tela mostra e o motor usa). */
export interface CustomRegua {
  name: string;
  trigger: ReguaTrigger;
  /** o nome da data nova (só no trigger "data") */
  dateLabel: string | null;
  repeatYearly: boolean;
  /** dias antes (negativo) ou depois (positivo) da data; null no horário marcado */
  offsetDays: number | null;
  /** horas antes do horário marcado; null nas outras */
  hoursBefore: number | null;
  sendHour: number;
  tag: string | null;
  category: ReguaCategory;
}

/** As variáveis que o planejador manda na régua personalizada, na ordem ({{1}}, {{2}}…). Pura. */
export const customVariables = (trigger: ReguaTrigger): string[] => (trigger === "horario" ? ["o primeiro nome", "a data (20/12)", "a hora (14:30)"] : ["o primeiro nome", "a data (10/03)"]);

/** Os exemplos das variáveis para a Meta aprovar (a data nova de uma vez vai com o ano). Pura. */
export const customExamples = (trigger: ReguaTrigger, yearly: boolean): string[] => (trigger === "horario" ? ["Ana", "20/12", "14:30"] : trigger === "data" && !yearly ? ["Ana", "10/03/2027"] : trigger === "ultima_visita" ? ["Ana", "10/03/2026"] : ["Ana", "10/03"]);

const cleanCompany = (company: string) => company.replace(/[{}*_~`\n]/g, "").trim().slice(0, 60) || "nossa loja";

/** O texto sugerido da régua personalizada, pela data que dispara (editável na tela). Pura. */
export function customTemplateBody(o: { trigger: ReguaTrigger; dateLabel: string | null; company: string }): string {
  const name = cleanCompany(o.company);
  if (o.trigger === "horario") return `Olá, {{1}}! A equipe de ${name} lembra do seu horário: {{2}}, às {{3}}. Se precisar remarcar, é só responder esta mensagem.`;
  if (o.trigger === "aniversario") return `Olá, {{1}}! A equipe de ${name} lembrou de você: seu aniversário é dia {{2}}. Se quiser falar com a gente, é só responder esta mensagem.`;
  if (o.trigger === "ultima_visita") return `Olá, {{1}}! Aqui é a equipe de ${name}. Sua última visita foi em {{2}}: como está tudo? Se precisar de algo, é só responder esta mensagem.`;
  const label = (o.dateLabel ?? "").replace(/[{}*_~`\n]/g, "").trim() || "a sua data";
  return `Olá, {{1}}! Aqui é a equipe de ${name}. Passando para lembrar: ${label}, {{2}}. Se precisar de ajuda, é só responder esta mensagem.`;
}

/** Só letras minúsculas sem acento, números e _, sem _ nas pontas. Pura. */
function slugOf(text: string, max: number): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max)
    .replace(/_+$/, "");
}

/** A chave da data nova na planilha e na API ("Renovação do plano" → renovacao_do_plano). Pura. */
export function dateFieldKey(label: string): string {
  const slug = slugOf(label, 40);
  if (!slug) return "data_nova";
  return /^[a-z]/.test(slug) && slug.length >= 2 ? slug : `data_${slug}`.slice(0, 40).replace(/_+$/, "");
}

/** O nome do modelo da régua personalizada na Meta: regua_p_<nome>, depois _2, _3… (a Meta não repete nome). Pura. */
export function customTemplateName(reguaName: string, existing: string[]): string {
  const base = `regua_p_${slugOf(reguaName, 40) || "personalizada"}`;
  if (!existing.includes(base)) return base;
  let n = 2;
  while (existing.includes(`${base}_${n}`)) n++;
  return `${base}_${n}`;
}

/** Problema no texto do modelo da régua personalizada (as regras da Meta e as variáveis que o planejador manda), ou null. Pura. */
export function customTemplateProblem(trigger: ReguaTrigger, yearly: boolean, body: string): string | null {
  const base = validateTemplate({ name: "regua_p_modelo", body, examples: customExamples(trigger, yearly) });
  if (base) return base;
  const need = customVariables(trigger);
  if (templateVariables(body).length !== need.length) return `O texto desta régua usa ${need.length} etiquetas: ${need.map((v) => v.replace(/ \(.*\)$/, "")).join(", ")}. Arraste cada uma para o texto.`;
  return null;
}

/** O que está errado na régua personalizada, ou null. Pura. */
export function customReguaProblem(c: CustomRegua): string | null {
  const name = c.name.trim();
  if (name.length < 2 || name.length > 60) return "Dê um nome de 2 a 60 letras para a régua.";
  if (c.trigger === "data" && (!c.dateLabel || c.dateLabel.trim().length < 2 || c.dateLabel.trim().length > 60)) return "Escolha a data, ou dê um nome de 2 a 60 letras para a data nova.";
  const lim = CUSTOM_OFFSET[c.trigger];
  if (c.trigger === "horario") {
    if (!Number.isInteger(c.hoursBefore) || c.hoursBefore! < lim.min || c.hoursBefore! > lim.max) return `No horário marcado, a régua sai de ${lim.min} a ${lim.max} horas antes.`;
  } else {
    if (!Number.isInteger(c.offsetDays) || c.offsetDays! < lim.min || c.offsetDays! > lim.max) return c.trigger === "ultima_visita" ? `Depois da última visita, de 0 a ${lim.max} dias.` : `De ${-lim.min} dias antes a ${lim.max} dias depois da data.`;
    if (!Number.isInteger(c.sendHour) || c.sendHour < 8 || c.sendHour > 19) return "A hora do envio vai das 8h às 19h.";
  }
  if (c.tag !== null && (c.tag.trim().length < 1 || c.tag.trim().length > 40)) return "A etiqueta tem até 40 letras.";
  if (c.category !== "MARKETING" && c.category !== "UTILITY") return "Escolha se a régua é promoção ou utilidade.";
  return null;
}

/** "10 dias antes de Renovação do plano, às 9h": quando a régua personalizada sai, numa frase. Pura. */
export function customTiming(c: Pick<CustomRegua, "trigger" | "dateLabel" | "repeatYearly" | "offsetDays" | "hoursBefore" | "sendHour">): string {
  if (c.trigger === "horario") return `${c.hoursBefore ?? 24} ${c.hoursBefore === 1 ? "hora" : "horas"} antes do horário marcado`;
  const n = c.offsetDays ?? 0;
  const days = `${Math.abs(n)} ${Math.abs(n) === 1 ? "dia" : "dias"}`;
  const side = n < 0 ? "antes" : "depois";
  const label = `${(c.dateLabel ?? "a data").trim()}${c.repeatYearly ? " (todo ano)" : ""}`;
  const when =
    c.trigger === "aniversario"
      ? n === 0 ? "No aniversário" : `${days} ${side} do aniversário`
      : c.trigger === "ultima_visita"
        ? n === 0 ? "No dia da última visita" : `${days} depois da última visita`
        : n === 0 ? `No dia de ${label}` : `${days} ${side} de ${label}`;
  return `${when}, às ${c.sendHour}h`;
}
