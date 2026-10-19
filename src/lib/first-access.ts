import { profileProblem } from "./attendants";

/**
 * Primeiro acesso (Entrada e docs, parte 1, 19/10/2026): o dono diz como vai usar o BoaVoz (para
 * os clientes da agência, para o próprio negócio ou para integrar pela API), o nome da conta e o
 * dele. O perfil muda os primeiros passos do painel (onboarding.ts); o WhatsApp dos avisos vem
 * junto, opcional. Enquanto agencies.profile é null, o painel leva o dono a /comecar.
 */
export type AccountProfile = "agency" | "business" | "developer";

export const ACCOUNT_PROFILES: Record<AccountProfile, { label: string; hint: string; nameLabel: string; namePlaceholder: string }> = {
  agency: { label: "Para os clientes da minha agência", hint: "Chatbots para vários clientes, com a sua marca no chat, nas demos e no portal.", nameLabel: "Nome da agência", namePlaceholder: "Norte Marketing" },
  business: { label: "Para o meu negócio", hint: "Um assistente que atende os seus clientes no site, no WhatsApp e no Instagram.", nameLabel: "Nome do seu negócio", namePlaceholder: "Clínica Sorriso" },
  developer: { label: "Para integrar pela API", hint: "Sou dev: quero mandar mensagens e receber os eventos no meu sistema.", nameLabel: "Nome da empresa ou do projeto", namePlaceholder: "Loja Exemplo" },
};

export const PROFILE_ORDER: AccountProfile[] = ["agency", "business", "developer"];

export const isAccountProfile = (v: unknown): v is AccountProfile => typeof v === "string" && Object.hasOwn(ACCOUNT_PROFILES, v);

export interface FirstAccess {
  profile: AccountProfile;
  accountName: string;
  displayName: string;
  /** O WhatsApp dos avisos como foi digitado (vazio: não quis agora). */
  phone: string;
}

/** Confere o formulário do primeiro acesso. Pura. */
export function parseFirstAccess(fd: FormData): { ok: true; value: FirstAccess } | { ok: false; message: string } {
  const profile = fd.get("profile");
  if (!isAccountProfile(profile)) return { ok: false, message: "Escolha como você vai usar o BoaVoz." };
  const { nameLabel } = ACCOUNT_PROFILES[profile];
  const accountName = String(fd.get("account_name") ?? "").replace(/\s+/g, " ").trim();
  if (accountName.length < 2) return { ok: false, message: `${nameLabel}: escreva pelo menos 2 letras.` };
  if (accountName.length > 80) return { ok: false, message: `${nameLabel}: no máximo 80 caracteres.` };
  const displayName = String(fd.get("display_name") ?? "").replace(/\s+/g, " ").trim();
  // as regras do nome de exibição de Meu perfil, com o nome do campo daqui
  const problem = profileProblem(displayName, null, "");
  if (problem) return { ok: false, message: problem.replace(/nome de exibição/g, "seu nome") };
  return { ok: true, value: { profile, accountName, displayName, phone: String(fd.get("phone") ?? "").trim() } };
}
