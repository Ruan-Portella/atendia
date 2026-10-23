import { CUSTOM_OFFSET, customReguaProblem, isReguaTrigger, type CustomRegua, type ReguaTrigger } from "./regua-kinds";

/*
 * O formulário da régua personalizada (23/10/2026): o "+ Nova régua" e a edição. Puro: a ação lê
 * o FormData por aqui. Os campos:
 *  name, trigger (aniversario | ultima_visita | horario | data), date_field (o id da data nova ou
 *  "nova"), date_label (o nome da data nova), repeat (uma_vez | todo_ano), when (antes | no_dia |
 *  depois), days, hours, send_hour, tag, category (MARKETING | UTILITY).
 * Na edição, a data que dispara, a repetição e a categoria ficam (o modelo aprovado depende delas).
 */

export interface ReguaFormInput {
  config: CustomRegua;
  /** a data nova escolhida (trigger "data" com um campo que já existe) */
  dateFieldId: string | null;
  /** o nome da data nova a criar (trigger "data" com "nova") */
  newDateLabel: string | null;
}

type Get = (key: string) => string;
const intOf = (v: string) => (/^-?\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

/** Os dias com sinal: antes vira negativo, no dia vira 0. Pura. */
export function signedDays(when: string, days: number): number {
  if (when === "no_dia") return 0;
  return when === "antes" ? -Math.abs(days) : Math.abs(days);
}

/** "Quando sai" de volta no formulário: antes, no dia ou depois, e os dias. Pura. */
export function whenOf(offsetDays: number | null): { when: "antes" | "no_dia" | "depois"; days: number } {
  const n = offsetDays ?? 0;
  return { when: n < 0 ? "antes" : n === 0 ? "no_dia" : "depois", days: Math.abs(n) || 1 };
}

/**
 * O formulário da régua nova (ou o da edição, com `fixed`: a data que dispara, a repetição e a
 * categoria que já estão na régua), conferido. `fields`: as datas novas do chatbot.
 */
export function parseReguaForm(get: Get, fields: Array<{ id: string; label: string }>, fixed?: Pick<CustomRegua, "trigger" | "repeatYearly" | "category" | "dateLabel"> & { dateFieldId: string | null }): ReguaFormInput | { error: string } {
  const triggerRaw = fixed?.trigger ?? get("trigger");
  if (!isReguaTrigger(triggerRaw)) return { error: "Escolha a data que dispara a régua." };
  const trigger: ReguaTrigger = triggerRaw;
  let dateFieldId: string | null = null;
  let newDateLabel: string | null = null;
  let dateLabel: string | null = null;
  if (trigger === "data") {
    if (fixed) {
      dateFieldId = fixed.dateFieldId;
      dateLabel = fixed.dateLabel;
    } else if (get("date_field") === "nova") {
      newDateLabel = get("date_label").replace(/\s+/g, " ").trim();
      dateLabel = newDateLabel;
    } else {
      const f = fields.find((x) => x.id === get("date_field"));
      if (!f) return { error: "Escolha a data, ou crie uma data nova." };
      dateFieldId = f.id;
      dateLabel = f.label;
    }
  }
  const when = trigger === "ultima_visita" && get("when") === "antes" ? "depois" : get("when");
  const days = when === "no_dia" ? 0 : intOf(get("days"));
  const category = fixed?.category ?? get("category");
  const config: CustomRegua = {
    name: get("name").replace(/\s+/g, " ").trim(),
    trigger,
    dateLabel,
    repeatYearly: trigger === "data" ? (fixed ? fixed.repeatYearly : get("repeat") === "todo_ano") : false,
    offsetDays: trigger === "horario" ? null : Number.isNaN(days) ? NaN : signedDays(when, days),
    hoursBefore: trigger === "horario" ? intOf(get("hours")) : null,
    sendHour: trigger === "horario" ? 9 : intOf(get("send_hour")),
    tag: get("tag").trim() ? get("tag").trim().toLowerCase().slice(0, 40) : null,
    category: category === "MARKETING" ? "MARKETING" : category === "UTILITY" ? "UTILITY" : ("" as CustomRegua["category"]),
  };
  if (trigger !== "horario" && Number.isNaN(config.offsetDays)) {
    const lim = CUSTOM_OFFSET[trigger];
    return { error: trigger === "ultima_visita" ? `Diga quantos dias depois da última visita (até ${lim.max}).` : `Diga quantos dias antes ou depois da data (até ${lim.max}).` };
  }
  const problem = customReguaProblem(config);
  if (problem) return { error: problem };
  return { config, dateFieldId, newDateLabel };
}
