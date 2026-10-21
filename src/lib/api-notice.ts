import { invalidRequest, notFound, readJsonBody, withIdempotency, type ApiContext } from "./api-v1";
import { activeMomentNotice, checkMomentNotice, untilFromApi } from "./moment-notice";
import { audit } from "./audit";
import { meta } from "./api-provisioning";

/*
 * Aviso do momento pela API (leva das sobras, parte 1; ideia do bot do provedor de internet: o
 * sistema dele avisa a queda sozinho). O mesmo aviso do painel: um texto com prazo que a IA usa
 * quando o contato pergunta ou o assunto tem a ver. Permissão sources (é o que a IA sabe) ou
 * provisioning (quem configura os chatbots).
 * - GET /v1/bots/{id}/notice: o aviso que vale agora, ou null;
 * - PUT /v1/bots/{id}/notice {text, until}: põe ou troca (until em ISO 8601 com o fuso, de 10
 *   minutos a 30 dias à frente);
 * - DELETE /v1/bots/{id}/notice: tira antes do prazo.
 */

type NoticeRow = { moment_notice: string | null; moment_notice_until: string | null; moment_notice_by: string | null };

/** O objeto da API. Pura. */
export function noticeObject(botId: string, row: NoticeRow, now = Date.now()) {
  const n = activeMomentNotice(row, now);
  return { bot_id: `bot_${botId}`, notice: n ? { text: n.text, until: n.until, set_by: row.moment_notice_by } : null };
}

async function noticeRow(api: ApiContext, botId: string): Promise<NoticeRow> {
  const { data } = await api.db.from("bots").select("moment_notice, moment_notice_until, moment_notice_by").eq("id", botId).maybeSingle<NoticeRow>();
  if (!data) throw notFound();
  return data;
}

export async function getNoticeApi(_req: Request, api: ApiContext, rawBotId: string): Promise<Response> {
  const botId = api.requireBot(rawBotId);
  return Response.json(noticeObject(botId, await noticeRow(api, botId)));
}

export async function putNoticeApi(req: Request, api: ApiContext, rawBotId: string): Promise<Response> {
  const botId = api.requireBot(rawBotId);
  const { raw, body } = await readJsonBody(req);
  for (const k of Object.keys(body)) if (k !== "text" && k !== "until") throw invalidRequest(`Campo desconhecido: ${k}.`, { field: k });
  if (typeof body.text !== "string") throw invalidRequest("text é o texto do aviso, de 5 a 500 caracteres.", { field: "text" });
  const until = untilFromApi(body.until);
  if (body.until !== undefined && !until) throw invalidRequest("until é a data e a hora em ISO 8601 com o fuso (ex.: 2026-10-22T18:00:00-03:00).", { field: "until" });
  const check = checkMomentNotice(body.text, until);
  if (!check.ok) throw invalidRequest(check.message, { field: check.field });
  return withIdempotency(api, req, raw, async () => {
    const by = `API (${api.key.name})`.slice(0, 120);
    const { data, error } = await api.db.from("bots").update({ moment_notice: check.value.text, moment_notice_until: check.value.until, moment_notice_by: by }).eq("id", botId).select("moment_notice, moment_notice_until, moment_notice_by").maybeSingle<NoticeRow>();
    if (error) throw new Error(`aviso do momento: ${error.message}`);
    if (!data) throw notFound();
    await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "bot.aviso_momento", targetType: "bot", targetId: botId, after: { ate: check.value.until }, ...meta(req) });
    return { status: 200, body: noticeObject(botId, data) };
  });
}

export async function deleteNoticeApi(req: Request, api: ApiContext, rawBotId: string): Promise<Response> {
  const botId = api.requireBot(rawBotId);
  const before = await noticeRow(api, botId);
  const had = activeMomentNotice(before) !== null;
  const { error } = await api.db.from("bots").update({ moment_notice: null, moment_notice_until: null, moment_notice_by: null }).eq("id", botId);
  if (error) throw new Error(`aviso do momento: ${error.message}`);
  if (had) await audit(api.db, { agencyId: api.key.agency_id, actorType: "api_key", actorId: api.key.id, action: "bot.aviso_momento_apagar", targetType: "bot", targetId: botId, ...meta(req) });
  return Response.json({ bot_id: `bot_${botId}`, notice: null, removed: had });
}
