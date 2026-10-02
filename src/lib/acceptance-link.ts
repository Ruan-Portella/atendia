import type { SupabaseClient } from "@supabase/supabase-js";
import { acceptanceEmail, confirmAcceptance } from "./acceptance";
import { sendAsAgency } from "./notify";
import { connectLinkUrl, hashToken, type ResolvedLink } from "./whatsapp-connect-link";

/**
 * A Meta concluiu a conexão pelo link: o aceite pendente vira confirmado, com a conta da Meta
 * (WABA e nome verificado, ou a conta do Instagram), e uma cópia vai ao e-mail informado, sem
 * confirmação que bloqueie. O remetente é a agência (white-label).
 */
export async function confirmLinkAcceptance(db: SupabaseClient, link: ResolvedLink, token: string) {
  if (!link.clientId) return;
  let meta: { account: string | null; businessId?: string | null; verifiedName?: string | null };
  if (link.channel === "whatsapp") {
    const { data: ch } = await db.from("whatsapp_channels").select("waba_id, business_id, verified_name").eq("bot_id", link.botId).maybeSingle();
    meta = { account: (ch?.waba_id as string | null) ?? null, businessId: (ch?.business_id as string | null) ?? null, verifiedName: (ch?.verified_name as string | null) ?? null };
  } else {
    const { data: ch } = await db.from("instagram_channels").select("ig_user_id, username").eq("bot_id", link.botId).maybeSingle();
    meta = { account: (ch?.ig_user_id as string | null) ?? null, verifiedName: ch?.username ? `@${ch.username}` : null };
  }
  const who = await confirmAcceptance(db, { clientId: link.clientId, channel: link.channel, linkTokenHash: hashToken(token), metaAccount: meta.account, metaBusinessId: meta.businessId, metaVerifiedName: meta.verifiedName });
  if (!who) return;
  const mail = acceptanceEmail({ name: who.name, clientName: link.bot.client_name, channel: link.channel, agencyName: link.agency.name, policyUrl: `${connectLinkUrl(token)}/uso-aceitavel` });
  await sendAsAgency(link.agency.name, who.email, mail.subject, mail.lines).catch(() => false);
}
