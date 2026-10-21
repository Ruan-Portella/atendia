import { describe, expect, it } from "vitest";
import { memoryDb } from "../memory-db";
import { retentionContacts } from "../contacts";
import { heldContacts } from "../retention";

const old = "2025-01-01T00:00:00.000Z";
const cutoff = "2025-10-01T00:00:00.000Z";
const contact = (id: string, extra: Record<string, unknown> = {}) => ({ id, bot_id: "b1", channel: "whatsapp", created_at: old, updated_at: old, last_inbound_at: null, phone_enc: null, wa_user_enc: null, ig_enc: null, appointment_at: null, ...extra });

describe("retenção dos contatos", () => {
  it("só apaga a ficha parada sem conversa, vínculo, aceite em vigor, lead, envio na fila nem horário pela frente", async () => {
    const db = memoryDb({
      contacts: [
        contact("livre"),
        contact("conversa"),
        contact("vinculo"),
        contact("aceite"),
        contact("aceite-revogado"),
        contact("lead"),
        contact("na-fila"),
        contact("ja-enviado"),
        contact("horario", { appointment_at: "2026-11-05T13:00:00.000Z" }),
        contact("horario-passado", { appointment_at: "2025-05-01T13:00:00.000Z" }),
        contact("recente", { updated_at: "2025-12-01T00:00:00.000Z" }),
      ],
      conversations: [{ id: "c1", contact_id: "conversa" }],
      contact_links: [{ id: "l1", contact_id: "vinculo", unlinked_at: null }],
      marketing_consents: [
        { id: 1, contact_id: "aceite", granted: true, revoked_at: null },
        { id: 2, contact_id: "aceite-revogado", granted: true, revoked_at: old },
      ],
      leads: [{ id: "ld1", contact_id: "lead" }],
      campaign_sends: [
        { id: "s1", contact_id: "na-fila", status: "queued" },
        { id: "s2", contact_id: "ja-enviado", status: "delivered" },
      ],
    });
    const { rows } = await retentionContacts(db, "b1", cutoff, { now: new Date("2026-10-20T12:00:00Z"), held: heldContacts(db) });
    expect(rows.map((r) => r.id).sort()).toEqual(["aceite-revogado", "horario-passado", "ja-enviado", "livre"]);
  });
});
