import { cache } from "react";
import { headers } from "next/headers";
import { createAdminClient } from "./supabase/admin";
import { isCustomHost } from "./domain";

/**
 * Agência dona do domínio da requisição atual; undefined quando é o domínio do app.
 * Páginas públicas (demo, portal, widget) usam para não servir conteúdo de uma agência no
 * domínio de outra.
 */
export const hostAgency = cache(async (): Promise<{ id: string; name: string; logo_url: string | null; brand_color: string; support_whatsapp: string | null; custom_domain: string | null; custom_domain_verified_at: string | null } | null | undefined> => {
  const host = (await headers()).get("host");
  if (!isCustomHost(host)) return undefined;
  const domain = host!.toLowerCase().split(":")[0];
  const { data } = await createAdminClient()
    .from("agencies")
    .select("id, name, logo_url, brand_color, support_whatsapp, custom_domain, custom_domain_verified_at")
    .in("custom_domain", [domain, domain.replace(/^www\./, "")])
    .maybeSingle();
  return data ?? null;
});

/** Num domínio de agência, o conteúdo precisa ser dela. */
export async function belongsToHost(agencyId: string): Promise<boolean> {
  const a = await hostAgency();
  return a === undefined || a?.id === agencyId;
}
