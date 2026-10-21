/*
 * E-mails descartáveis (Trava da conta grátis, parte 1): os domínios mais usados para abrir conta
 * de mentira, recusados no cadastro por código. A lista é curta de propósito (os grandes e os
 * brasileiros); o resto da trava fica com os outros sinais (navegador, IP, número).
 */

const DISPOSABLE = new Set([
  "10minutemail.com", "10minutemail.net", "10minemail.com", "20minutemail.com", "byom.de", "crazymailing.com", "discard.email",
  "discardmail.com", "dispostable.com", "dropmail.me", "emailfake.com", "emailondeck.com",
  "emailtemporario.com.br", "emltmp.com", "fakeinbox.com", "fakemail.net", "fexbox.org",
  "getairmail.com", "getnada.com", "guerrillamail.biz", "guerrillamail.com", "guerrillamail.de",
  "guerrillamail.info", "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com",
  "harakirimail.com", "inboxbear.com", "inboxkitten.com", "incognitomail.org", "jetable.org",
  "linshiyouxiang.net", "mail-temp.com", "mail.tm", "mail7.io", "mailcatch.com", "maildrop.cc",
  "mailinator.com", "mailinator.net", "mailinator2.com", "mailnesia.com", "mailpoof.com",
  "mailsac.com", "mailtemp.net", "mintemail.com", "mohmal.com", "moakt.com", "mytemp.email",
  "nada.email", "owlymail.com", "pokemail.net", "sharklasers.com", "spam4.me",
  "spambox.us", "spamgourmet.com", "temp-mail.io", "temp-mail.org", "tempail.com",
  "tempinbox.com", "tempmail.com", "tempmail.dev", "tempmail.net", "tempmail.plus",
  "tempmailo.com", "tempr.email", "temporary-mail.net", "throwawaymail.com", "tmail.ws",
  "tmailor.com", "tmpmail.net", "tmpmail.org", "trashmail.com", "trashmail.de", "trashmail.net",
  "yopmail.com", "yopmail.fr", "yopmail.net", "zetmail.com", "grr.la", "1secmail.com", "1secmail.net", "1secmail.org",
  "esiix.com", "wwjmp.com", "xojxe.com", "yoggm.com", "kzccv.com", "qiott.com",
]);

/** O domínio é de e-mail descartável (também os subdomínios dele). Pura. */
export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  if (!domain) return false;
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) if (DISPOSABLE.has(parts.slice(i).join("."))) return true;
  return false;
}
