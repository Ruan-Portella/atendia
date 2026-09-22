import { cache } from "react";
import { createAdminClient } from "./supabase/admin";

/**
 * Cliente dono de um link de portal. O portal é público (quem tem o link vê), então toda
 * consulta dali em diante filtra pelos chatbots deste cliente. Token desligado = null.
 */
export const getPortalClient = cache(async (token: string) => {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token)) return null;
  const db = createAdminClient();
  const { data } = await db.from("clients").select("id, name, agency_id").eq("portal_token", token).maybeSingle();
  return data ? { db, client: data } : null;
});
