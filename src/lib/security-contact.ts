import { company } from "./company";
import { appUrl } from "./utils";

/** Para onde vão os avisos de falha de segurança (SECURITY_EMAIL, ou o contato geral). */
export const securityEmail = () => process.env.SECURITY_EMAIL || company.email;

/**
 * /.well-known/security.txt (RFC 9116): onde reportar falhas. Expira em 1 ano a partir de
 * `now` (a página é gerada no build e de novo a cada deploy).
 */
export function securityTxt(now = new Date()): string {
  const expires = new Date(now.getTime() + 365 * 86_400_000).toISOString();
  return [
    `Contact: mailto:${securityEmail()}`,
    `Contact: ${appUrl("/seguranca")}`,
    `Expires: ${expires}`,
    "Preferred-Languages: pt, en",
    `Policy: ${appUrl("/seguranca")}`,
    `Canonical: ${appUrl("/.well-known/security.txt")}`,
    "",
  ].join("\n");
}
