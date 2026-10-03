/*
 * Diagnóstico do número do WhatsApp (L1; spec "Diagnóstico do número"): o que a Meta diz do número
 * (nota de qualidade, nome de exibição, situação), a forma de pagamento, restrições e ordens da
 * Meta e o motivo da última desconexão, cada um com o próximo passo. Aqui só as regras puras; a
 * consulta à Meta fica em whatsapp.ts e a tela em components/whatsapp-diagnostics.tsx.
 */

export type DiagTone = "ok" | "atencao" | "problema";

export interface DiagLine {
  label: string;
  value: string;
  tone: DiagTone;
  /** O que fazer (só quando não está tudo bem). */
  hint?: string;
}

/** Campos do número na Graph API (GET /{phone-number-id}). */
export interface PhoneInfo {
  quality_rating?: string;
  name_status?: string;
  status?: string;
  verified_name?: string;
  code_verification_status?: string;
}

const MANAGER = "no Gerenciador do WhatsApp da Meta";

/** Nota de qualidade que a Meta dá ao número pelas conversas recentes (bloqueios e denúncias). */
export function qualityLine(rating: string | undefined): DiagLine {
  switch ((rating ?? "").toUpperCase()) {
    case "GREEN":
      return { label: "Qualidade", value: "Alta", tone: "ok" };
    case "YELLOW":
      return { label: "Qualidade", value: "Média", tone: "atencao", hint: "Contatos estão bloqueando ou denunciando o número. Evite mandar modelos para quem não pediu e confira as conversas recentes." };
    case "RED":
      return { label: "Qualidade", value: "Baixa", tone: "problema", hint: `A Meta pode limitar ou bloquear o número. Pare os envios de modelos e veja os detalhes ${MANAGER}.` };
    default:
      return { label: "Qualidade", value: "Ainda sem nota (número com pouco uso)", tone: "ok" };
  }
}

/** Situação do nome de exibição (o nome que aparece para o contato). */
export function nameLine(status: string | undefined, name: string | undefined): DiagLine {
  const label = "Nome de exibição";
  const shown = name ? `“${name}”` : "sem nome";
  switch ((status ?? "").toUpperCase()) {
    case "APPROVED":
      return { label, value: `${shown}, aprovado`, tone: "ok" };
    case "AVAILABLE_WITHOUT_REVIEW":
      return { label, value: `${shown}, em uso enquanto a Meta revisa`, tone: "ok" };
    case "PENDING_REVIEW":
      return { label, value: `${shown}, em análise pela Meta`, tone: "atencao", hint: "Costuma levar até 2 dias. Enquanto isso, as mensagens saem só com o número." };
    case "DECLINED":
      return { label, value: `${shown}, recusado`, tone: "problema", hint: `Use o nome do negócio como aparece no site ou na fachada, sem palavras genéricas, e peça de novo ${MANAGER}.` };
    case "EXPIRED":
      return { label, value: `${shown}, pedido vencido`, tone: "problema", hint: `O número não foi registrado a tempo. Peça o nome de novo ${MANAGER}.` };
    default:
      return { label, value: shown, tone: "ok" };
  }
}

/** Situação do número na Meta. Só aparece quando não está conectado normalmente. */
export function statusLine(status: string | undefined): DiagLine | null {
  const s = (status ?? "").toUpperCase();
  if (!s || s === "CONNECTED") return null;
  const map: Record<string, Omit<DiagLine, "label">> = {
    FLAGGED: { value: "sinalizado pela qualidade baixa", tone: "problema", hint: "Se a qualidade não melhorar em 7 dias, a Meta reduz o limite de envios do número." },
    RESTRICTED: { value: "restrito (limite de conversas atingido)", tone: "problema", hint: "Os modelos param até o limite renovar; responder a quem escreve continua funcionando." },
    RATE_LIMITED: { value: "com envios limitados pela Meta", tone: "atencao", hint: "Muitas mensagens em pouco tempo. Diminua o ritmo dos envios." },
    BANNED: { value: "banido pela Meta", tone: "problema", hint: `Veja o motivo e peça revisão ${MANAGER}.` },
    DISCONNECTED: { value: "desconectado na Meta", tone: "problema", hint: "Conecte o número de novo." },
    PENDING: { value: "aguardando registro", tone: "atencao", hint: "O registro do número ainda não terminou. Se demorar, conecte de novo." },
    UNVERIFIED: { value: "não verificado", tone: "problema", hint: `Confirme o número com o código por SMS ou ligação ${MANAGER}.` },
    MIGRATED: { value: "migrado para outra conta", tone: "problema", hint: "O número foi levado para outra conta do WhatsApp. Conecte de novo." },
    DELETED: { value: "excluído na Meta", tone: "problema", hint: "Conecte outro número." },
  };
  const hit = map[s] ?? { value: s.toLowerCase(), tone: "atencao" as const };
  return { label: "Situação na Meta", ...hit };
}

const RESTRICTION_LABEL: Record<string, string> = {
  RESTRICTED_BIZ_INITIATED_MESSAGING: "não pode iniciar conversas (modelos)",
  RESTRICTED_CUSTOMER_INITIATED_MESSAGING: "não pode responder a quem escreve",
  RESTRICTED_ADD_PHONE_NUMBER_ACTION: "não pode adicionar números",
};

/** Data de validade que a Meta manda (segundos desde 1970 ou texto de data). */
function expirationText(expiration: unknown): string | null {
  if (expiration === undefined || expiration === null || expiration === "") return null;
  const n = Number(expiration);
  const d = Number.isFinite(n) && n > 0 ? new Date(n < 1e12 ? n * 1000 : n) : new Date(String(expiration));
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** Restrição de conta da Meta (account_update ACCOUNT_RESTRICTION), com tipo e validade. */
export function restrictionLines(restrictions: Array<{ restriction_type?: string; expiration?: unknown }> | undefined): DiagLine[] {
  return (restrictions ?? []).map((r) => {
    const until = expirationText(r.expiration);
    const what = RESTRICTION_LABEL[r.restriction_type ?? ""] ?? (r.restriction_type ?? "restrição sem tipo").toLowerCase();
    return { label: "Restrição da Meta", value: `${what}${until ? `, até ${until}` : ""}`, tone: "problema", hint: `A Meta restringiu a conta por causa de violações das regras. Veja os detalhes e o pedido de revisão ${MANAGER}.` };
  });
}

/** O que fazer depois de uma desconexão, pelo motivo gravado. Função pura. */
export function disconnectNextStep(reason: string | null | undefined, coexistence: boolean): string {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("excluída") || r.includes("saiu da api")) return "A conta do WhatsApp não existe mais na API. Conecte um número novo pelo link.";
  if (coexistence) return "Peça ao cliente para abrir o app WhatsApp Business no celular (a Meta desconecta o número quando o app fica uns 14 dias sem abrir) e conecte de novo pelo link.";
  if (r.includes("removeu o app") || r.includes("compartilhada") || r.includes("recusou o acesso")) return "O acesso do BoaVoz à conta foi retirado no Facebook do cliente. Mande o link de conexão para o dono conectar de novo.";
  return "Mande o link de conexão para o dono conectar de novo.";
}

/** Motivo e quem iniciou a remoção (account_update PARTNER_REMOVED, disconnection_info). */
export function disconnectionDetail(info: { reason?: string; initiated_by?: string } | undefined): string | null {
  if (!info?.reason && !info?.initiated_by) return null;
  const who = info.initiated_by ? ({ BUSINESS: "pelo negócio", PARTNER: "pelo parceiro", META: "pela Meta" } as Record<string, string>)[info.initiated_by.toUpperCase()] ?? `por ${info.initiated_by}` : null;
  return [info.reason ? `motivo informado pela Meta: ${info.reason}` : null, who ? `iniciado ${who}` : null].filter(Boolean).join(", ");
}
