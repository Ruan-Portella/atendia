import type { SupabaseClient } from "@supabase/supabase-js";
import { activeOf } from "./entitlements";
import { removeDomainFromProject } from "./domain";
import { notifyAgencyOwner } from "./notify";
import { audit } from "./audit";
import { appUrl } from "./utils";

/*
 * Domínio próprio é um pacote (revisão de preços, 16/10/2026): sem ele, o domínio da agência sai
 * da Vercel e do cadastro, e o painel, as demos e o chat voltam ao domínio do BoaVoz (18/10/2026:
 * antes, o domínio seguia funcionando depois que o pacote saía). Roda no fim da assinatura, na
 * virada do mês (pacote tirado vale até o dia 1º) e na tarefa diária.
 */

/** E-mail do domínio desligado. Função pura. */
export function domainReleasedEmail(domain: string, brandUrl: string): [string, string[]] {
  return [
    "Domínio próprio desligado",
    [
      `O pacote Domínio próprio saiu, então o domínio ${domain} foi desligado: o painel, as demos e o chat voltaram para o domínio do BoaVoz. O resto continua igual.`,
      "",
      `Para usar o seu domínio de novo, assine o pacote em Cobrança → Assinatura e cadastre o domínio em Marca: ${brandUrl}`,
    ],
  ];
}

/** Tira o domínio das agências sem o pacote Domínio próprio. Devolve quantas perderam o domínio. */
export async function releaseDomainsWithoutPack(db: SupabaseClient, o: { agencyId?: string; now?: number } = {}): Promise<number> {
  let q = db.from("agencies").select("id, custom_domain, agency_packs(pack, ends_at)").not("custom_domain", "is", null);
  if (o.agencyId) q = q.eq("id", o.agencyId);
  const { data, error } = await q;
  if (error) throw new Error(`domínio sem pacote: ${error.message}`);
  let released = 0;
  for (const a of data ?? []) {
    const packs = activeOf(((a.agency_packs ?? []) as Array<{ pack: unknown; ends_at: unknown }>), o.now);
    if (packs.includes("dominio")) continue;
    const domain = a.custom_domain as string;
    await removeDomainFromProject(domain);
    const { data: done } = await db.from("agencies").update({ custom_domain: null, custom_domain_verified_at: null }).eq("id", a.id).eq("custom_domain", domain).select("id");
    if (!done?.length) continue;
    await audit(db, { agencyId: a.id as string, actorType: "system", actorId: null, action: "dominio.remover_sem_pacote", targetType: "agency", targetId: a.id as string, before: { dominio: domain } });
    const [subject, lines] = domainReleasedEmail(domain, appUrl("/painel/marca"));
    await notifyAgencyOwner(db, a.id as string, subject, lines).catch(() => false);
    released++;
  }
  return released;
}
