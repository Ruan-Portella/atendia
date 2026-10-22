/*
 * O rosto do chatbot (redesenho, etapa 3): a cor é a cor principal do chatbot (appearance.color);
 * os olhos e o acessório ficam em bots.face (migração 0170). Sem dependência de servidor.
 */

export const EYES = [
  { id: "pilula", label: "Pílula" },
  { id: "redondo", label: "Redondo" },
  { id: "feliz", label: "Feliz" },
  { id: "sonolento", label: "Sonolento" },
  { id: "piscadinha", label: "Piscadinha" },
] as const;

export const ACCESSORIES = [
  { id: "nenhum", label: "Nenhum" },
  { id: "chef", label: "Chapéu de chef" },
  { id: "oculos", label: "Óculos" },
  { id: "fone", label: "Fone de atendimento" },
] as const;

export type EyeStyle = (typeof EYES)[number]["id"];
export type Accessory = (typeof ACCESSORIES)[number]["id"];

export interface BotFaceStyle {
  eyes: EyeStyle;
  acc: Accessory;
}

export const DEFAULT_FACE: BotFaceStyle = { eyes: "pilula", acc: "nenhum" };

/** As cores prontas do editor (a pessoa também escolhe qualquer outra). */
export const FACE_COLORS = [
  { hex: "#e8643c", label: "Laranja" },
  { hex: "#3c7be8", label: "Azul" },
  { hex: "#8f5ae8", label: "Roxo" },
  { hex: "#1f9f6e", label: "Verde" },
  { hex: "#e85a9b", label: "Rosa" },
  { hex: "#d9a23c", label: "Amarelo" },
  { hex: "#3a3a37", label: "Grafite" },
  { hex: "#17845a", label: "Verde BoaVoz" },
] as const;

const isEye = (v: unknown): v is EyeStyle => EYES.some((e) => e.id === v);
const isAcc = (v: unknown): v is Accessory => ACCESSORIES.some((a) => a.id === v);

/** O rosto guardado (ou o padrão, com o que vier faltando ou errado). Pura. */
export function faceOf(v: unknown): BotFaceStyle {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  return { eyes: isEye(o.eyes) ? o.eyes : DEFAULT_FACE.eyes, acc: isAcc(o.acc) ? o.acc : DEFAULT_FACE.acc };
}

/** O que vem do formulário: null quando algo não é das opções. Pura. */
export function parseFace(eyes: unknown, acc: unknown): BotFaceStyle | null {
  return isEye(eyes) && isAcc(acc) ? { eyes, acc } : null;
}
