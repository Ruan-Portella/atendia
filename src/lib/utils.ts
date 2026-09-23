export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "bot";
}

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    const u = new URL(s);
    if (!u.hostname.includes(".")) return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

export function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `há ${d} dia${d > 1 ? "s" : ""}`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

export function appUrl(path = ""): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "") + path;
}

/** Dias restantes até uma data ISO (nunca negativo). */
export function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000));
}

/** ISO de N dias atrás. */
export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

/** Identificador anônimo do visitante, persistido no localStorage (null no servidor). */
export function getOrCreateVisitorId(storageKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
    if (saved.visitorId) return saved.visitorId as string;
    const v = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(storageKey, JSON.stringify({ visitorId: v }));
    return v;
  } catch {
    return "anon";
  }
}

/**
 * Leva o visitante e a conversa aberta de uma chave antiga do localStorage para a nova
 * (sem sobrescrever o que já existe na nova), para a troca de nome não zerar ninguém.
 */
export function adoptLegacyStorage(oldKey: string, newKey: string): void {
  if (typeof window === "undefined") return;
  try {
    for (const suffix of ["", ":conversa"]) {
      const old = localStorage.getItem(oldKey + suffix);
      if (old === null) continue;
      if (localStorage.getItem(newKey + suffix) === null) localStorage.setItem(newKey + suffix, old);
      localStorage.removeItem(oldKey + suffix);
    }
  } catch {
    // sem localStorage (modo privado, bloqueado): nada a levar
  }
}

/** Minutos desde uma data ISO. */
export function minutesSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 60000;
}

/** Mês atual em São Paulo, 'AAAA-MM'. */
export function currentPeriodBR(now = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}
