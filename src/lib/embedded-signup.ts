/*
 * Pedido do cadastro incorporado da Meta (FB.login, campo extras). A coexistência (conectar o app
 * WhatsApp Business do celular) é pedida com featureType; a documentação da Meta não deixa claro
 * quais outros campos a v4 aceita junto, e a tela da coexistência não apareceu com o formato atual.
 * Enquanto isso, a página aceita ?es=a…e para testar os formatos no botão da coexistência, sem
 * deploy entre um teste e outro. Função pura (o botão roda no navegador).
 */

export type EsVariant = "a" | "b" | "c" | "d" | "e";

export const ES_VARIANTS: Record<EsVariant, string> = {
  a: "atual: setup, version v4 e sessionInfoVersion 3",
  b: "só version v4",
  c: "só setup",
  d: "setup e sessionInfoVersion 3, sem version",
  e: "version v4-public-preview e sessionInfoVersion 3 (como o teste do painel da Meta)",
};

/** O formato pedido no endereço (?es=b); sem ou inválido, o atual. Pura. */
export const esVariantOf = (v: unknown): EsVariant => (typeof v === "string" && Object.hasOwn(ES_VARIANTS, v) ? (v as EsVariant) : "a");

/** O campo extras do FB.login. O formato só muda no pedido de coexistência. Pura. */
export function signupExtras(coexistence: boolean, variant: EsVariant = "a"): Record<string, unknown> {
  if (!coexistence) return { setup: {}, version: "v4", sessionInfoVersion: "3" };
  const feature = { featureType: "whatsapp_business_app_onboarding" };
  switch (variant) {
    case "b":
      return { version: "v4", ...feature };
    case "c":
      return { setup: {}, ...feature };
    case "d":
      return { setup: {}, sessionInfoVersion: "3", ...feature };
    case "e":
      return { setup: {}, version: "v4-public-preview", sessionInfoVersion: "3", ...feature };
    default:
      return { setup: {}, version: "v4", sessionInfoVersion: "3", ...feature };
  }
}
