import { appUrl } from "./utils";

/**
 * Domínio próprio da agência.
 *
 * Fluxo: a agência informa `chat.agencia.com.br` → adicionamos o domínio no projeto da
 * Vercel (API, se VERCEL_TOKEN/VERCEL_PROJECT_ID existirem) → ela cria o CNAME → "Verificar"
 * confere pela Vercel e por HTTP (o domínio precisa responder /api/domain-check com o nosso
 * app). Verificado, os links de demo, portal do cliente e código do widget passam a usá-lo.
 */

/**
 * Alvos de DNS. A Vercel passou a recomendar um CNAME próprio de cada projeto
 * (ex.: 564cab…vercel-dns-017.com, em Project → Domains); os antigos cname.vercel-dns.com e
 * 76.76.21.21 continuam funcionando. Defina CUSTOM_DOMAIN_CNAME / CUSTOM_DOMAIN_A com os do
 * seu projeto, ou configure VERCEL_* para o painel perguntar à Vercel (recommendedDnsRecord).
 */
export const CNAME_TARGET = (process.env.CUSTOM_DOMAIN_CNAME ?? "cname.vercel-dns.com").replace(/\.$/, "");
export const APEX_A_RECORD = process.env.CUSTOM_DOMAIN_A ?? "76.76.21.21";
/** Resposta de /api/domain-check: prova que o domínio chega neste app (sem nome de produto). */
export const DOMAIN_MARKER = "cw-app";

/** Normaliza e valida o que a agência digitou. Devolve null se estiver vazio. */
export function parseDomain(input: string): { domain: string | null } | { error: string } {
  let d = input.trim().toLowerCase();
  if (!d) return { domain: null };
  d = d.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (d.length > 120 || !/^(?=.{4,120}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) {
    return { error: "Domínio inválido. Use algo como chat.suaagencia.com.br (sem https://)." };
  }
  const appHost = hostOf(appUrl());
  if (appHost && (d === appHost || d.endsWith(`.${appHost}`))) return { error: "Use um domínio da sua agência, não o nosso." };
  if (d.endsWith(".vercel.app")) return { error: "Use um domínio da sua agência (não .vercel.app)." };
  return { domain: d };
}

export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Domínio "raiz" (agencia.com.br) precisa de registro A; subdomínio (chat.agencia.com.br), CNAME.
 * Heurística para sufixos de 2 níveis comuns no Brasil (.com.br, .net.br...).
 */
function registrableLabels(domain: string): number {
  const parts = domain.split(".");
  return /^(com|net|org|art|eng|adv|med|ind|inf|blog|app|dev|tec|eco|nom|gov|edu)\.br$/.test(parts.slice(-2).join(".")) ? 3 : 2;
}

export function isApexDomain(domain: string): boolean {
  return domain.split(".").length <= registrableLabels(domain);
}

/** Nome do registro DNS: "chat" para chat.agencia.com.br, "@" para a raiz. */
export function dnsRecordName(domain: string): string {
  const parts = domain.split(".");
  const sub = parts.slice(0, Math.max(0, parts.length - registrableLabels(domain)));
  return sub.length ? sub.join(".") : "@";
}

/** Endereço público da agência: o domínio próprio verificado, ou o do app. */
export function agencyBaseUrl(agency: { custom_domain: string | null; custom_domain_verified_at?: string | null }): string {
  return agency.custom_domain && agency.custom_domain_verified_at ? `https://${agency.custom_domain}` : appUrl();
}

/** Host de uma requisição é um domínio de agência (e não o app, localhost ou preview)? */
export function isCustomHost(host: string | null): boolean {
  if (!host) return false;
  const h = host.toLowerCase().split(":")[0].replace(/^www\./, "");
  const app = hostOf(appUrl())?.replace(/^www\./, "");
  if (h === app || h === "localhost" || h === "127.0.0.1" || h.endsWith(".vercel.app") || h.endsWith(".localhost")) return false;
  return true;
}

/* ------------------------------------------------------------------ Vercel */

const vercel = () => {
  const token = process.env.VERCEL_TOKEN;
  const project = process.env.VERCEL_PROJECT_ID;
  if (!token || !project) return null;
  const team = process.env.VERCEL_TEAM_ID ? `teamId=${process.env.VERCEL_TEAM_ID}` : "";
  const call = async (method: string, path: string, body?: unknown) => {
    const url = `https://api.vercel.com${path}${path.includes("?") ? "&" : "?"}${team}`;
    const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, json };
  };
  return { project, call };
};

export const vercelDomainsEnabled = () => vercel() !== null;

/** Adiciona o domínio ao projeto (idempotente: "já existe neste projeto" conta como sucesso). */
export async function addDomainToProject(domain: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const v = vercel();
  if (!v) return { ok: true }; // modo manual: a agência (ou você) adiciona no painel da Vercel
  const r = await v.call("POST", `/v10/projects/${v.project}/domains`, { name: domain });
  if (r.ok) return { ok: true };
  const err = r.json.error as { code?: string; message?: string } | undefined;
  if (err?.code === "domain_already_in_use" || err?.code === "domain_already_exists") {
    // já está neste projeto? então tudo certo
    const g = await v.call("GET", `/v9/projects/${v.project}/domains/${domain}`);
    if (g.ok) return { ok: true };
    return { ok: false, message: "Este domínio já está em uso em outro projeto da Vercel." };
  }
  return { ok: false, message: err?.message ?? "A Vercel recusou o domínio." };
}

export async function removeDomainFromProject(domain: string): Promise<void> {
  const v = vercel();
  if (!v) return;
  await v.call("DELETE", `/v9/projects/${v.project}/domains/${domain}`).catch(() => {});
}

export interface DomainStatus {
  /** Pronto: DNS certo e o domínio responde pelo app. */
  live: boolean;
  /** Registros que a agência precisa criar (TXT de verificação da Vercel, quando pedido). */
  extraRecords: Array<{ type: string; name: string; value: string }>;
  message: string;
}

/** Confere o domínio: status na Vercel (se houver API) e um GET real em /api/domain-check. */
export async function checkDomain(domain: string): Promise<DomainStatus> {
  const extraRecords: DomainStatus["extraRecords"] = [];
  const v = vercel();
  if (v) {
    const g = await v.call("GET", `/v9/projects/${v.project}/domains/${domain}`);
    if (g.ok && g.json.verified === false) {
      await v.call("POST", `/v9/projects/${v.project}/domains/${domain}/verify`);
      for (const rec of (g.json.verification as Array<{ type: string; domain: string; value: string }> | undefined) ?? []) {
        extraRecords.push({ type: rec.type, name: rec.domain, value: rec.value });
      }
    }
    if (!g.ok && g.status === 404) {
      const added = await addDomainToProject(domain);
      if (!added.ok) return { live: false, extraRecords, message: added.message };
    }
  }
  try {
    const res = await fetch(`https://${domain}/api/domain-check`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    const j = (await res.json().catch(() => null)) as { app?: string } | null;
    if (res.ok && j?.app === DOMAIN_MARKER) return { live: true, extraRecords: [], message: "Domínio funcionando." };
    return { live: false, extraRecords, message: "O domínio responde, mas ainda não aponta para nós. Confira o registro DNS abaixo." };
  } catch {
    return { live: false, extraRecords, message: "Ainda não chegou aqui. DNS pode levar de minutos a algumas horas para propagar; o certificado HTTPS é emitido logo depois." };
  }
}

/** Extrai o valor de maior prioridade (rank 1) de recommendedCNAME / recommendedIPv4 da Vercel. */
export function pickRecommended(list: unknown): string | null {
  if (!Array.isArray(list) || !list.length) return null;
  const sorted = [...list].sort((a, b) => (Number((a as { rank?: number })?.rank) || 99) - (Number((b as { rank?: number })?.rank) || 99));
  const v = (sorted[0] as { value?: unknown })?.value ?? sorted[0];
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && s ? s.replace(/\.$/, "") : null;
}

/**
 * Registro DNS que a agência deve criar. Com a API da Vercel configurada, usa o que ela
 * recomenda para este domínio (o CNAME próprio do projeto); senão, os valores do .env.
 */
export async function recommendedDnsRecord(domain: string): Promise<{ type: "A" | "CNAME"; name: string; value: string }> {
  const apex = isApexDomain(domain);
  const fallback = apex ? { type: "A" as const, name: "@", value: APEX_A_RECORD } : { type: "CNAME" as const, name: dnsRecordName(domain), value: CNAME_TARGET };
  const v = vercel();
  if (!v) return fallback;
  try {
    const r = await v.call("GET", `/v6/domains/${domain}/config`);
    if (!r.ok) return fallback;
    const value = apex ? pickRecommended(r.json.recommendedIPv4) : pickRecommended(r.json.recommendedCNAME);
    return value ? { ...fallback, value } : fallback;
  } catch {
    return fallback;
  }
}
