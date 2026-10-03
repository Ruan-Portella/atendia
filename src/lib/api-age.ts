import { apiContacts, parseContactAddress, type ApiContact } from "./contacts";
import { setCompanyAge } from "./gate/age";
import { audit } from "./audit";
import { clientIp } from "./rate-limit";
import { invalidRequest, notFound, type ApiContext } from "./api-v1";

/*
 * PUT /v1/contacts/{contact}/age (P1; spec "Formatos de payload", rotas da API): a empresa informa
 * a idade do contato com um texto de origem ("CPF e data de nascimento conferidos no cadastro").
 * age_verified: false vale como "Não"; birth_date, se vier, serve só para calcular o sim ou não e
 * nunca é guardada. Um "Não" dado no chat sempre vence: a resposta volta com age_confirmed: false.
 * Contato que não existe: 404 (a API não cria contato aqui).
 */

export interface AgeBody {
  botId: unknown;
  verified: boolean;
  origin: string;
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Data de hoje em São Paulo (AAAA-MM-DD). */
const todaySaoPaulo = (now: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(now));

/** 18 anos completos em São Paulo nesta data? null = data inválida ou no futuro. Função pura. */
export function adultOn(birthDate: string, now = Date.now()): boolean | null {
  const m = DATE.exec(birthDate);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || +m[1] < 1900) return null;
  const today = todaySaoPaulo(now);
  if (birthDate > today) return null;
  return `${+today.slice(0, 4) - 18}${today.slice(4)}` >= birthDate;
}

/** Confere o corpo; erro 400 com o campo em details. Função pura. */
export function parseAgeBody(body: Record<string, unknown>, now = Date.now()): AgeBody {
  const origin = typeof body.origin === "string" ? body.origin.trim() : "";
  if (origin.length < 3 || origin.length > 300) throw invalidRequest("origin é obrigatório: diga como a idade foi conferida (3 a 300 caracteres).", { field: "origin" });
  let fromDate: boolean | null = null;
  if (body.birth_date !== undefined && body.birth_date !== null) {
    fromDate = typeof body.birth_date === "string" ? adultOn(body.birth_date, now) : null;
    if (fromDate === null) throw invalidRequest("birth_date inválida: use AAAA-MM-DD, no passado.", { field: "birth_date" });
  }
  if (body.age_verified !== undefined && typeof body.age_verified !== "boolean") throw invalidRequest("age_verified deve ser true ou false.", { field: "age_verified" });
  const verified = body.age_verified as boolean | undefined;
  if (verified === undefined && fromDate === null) throw invalidRequest("Envie age_verified (true ou false) ou birth_date.", { field: "age_verified" });
  if (verified !== undefined && fromDate !== null && verified !== fromDate) throw invalidRequest("age_verified não bate com birth_date.", { field: "age_verified" });
  return { botId: body.bot_id, verified: fromDate ?? (verified as boolean), origin };
}

/** Identidades do contato no canal, como o portão guarda a idade (telefone e BSUID; IGSID). */
export function ageIdentities(c: ApiContact): Array<{ channel: "whatsapp" | "instagram"; contact: string }> {
  if (c.channel === "whatsapp") return [c.phone, c.bsuid].filter((v): v is string => !!v).map((contact) => ({ channel: "whatsapp" as const, contact }));
  if (c.channel === "instagram" && c.igsid) return [{ channel: "instagram", contact: c.igsid }];
  return [];
}

export async function putContactAge(req: Request, api: ApiContext, contactParam: string): Promise<Response> {
  const addr = parseContactAddress(decodeURIComponent(contactParam));
  if (!addr) throw invalidRequest("{contact} inválido: use ctc_<id>, phone:<número>, wa:<BSUID>, ig:<id> ou ext:<id>.", { field: "contact" });
  const body = parseAgeBody(await api.json(req));
  // bot_id é obrigatório nas escritas; ctc_ já diz o bot (se vier, tem de bater)
  const botIds = body.botId === undefined && addr.kind === "id" ? api.botIds : [api.requireBot(body.botId)];
  // só contatos de WhatsApp e Instagram têm a barreira de idade
  const contacts = (await apiContacts(api.db, botIds, addr)).filter((c) => ageIdentities(c).length);
  if (!contacts.length) throw notFound();

  let result = { confirmed: body.verified, source: "company" as "company" | "chat" };
  for (const c of contacts) {
    const r = await setCompanyAge(api.db, c.bot_id, ageIdentities(c), body.verified, { origin: body.origin, apiKeyId: api.key.id });
    // ext: com vários contatos: um "Não" do chat em qualquer um aparece na resposta
    if (r.source === "chat") result = r;
    await audit(api.db, {
      agencyId: api.key.agency_id,
      actorType: "api_key",
      actorId: api.key.id,
      action: "idade.informar",
      targetType: "contact",
      targetId: c.id,
      after: { age_verified: body.verified, origin: body.origin, valendo: r.confirmed, origem_valendo: r.source },
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
    });
  }
  return Response.json({ age_confirmed: result.confirmed, age_confirmed_source: result.source });
}
