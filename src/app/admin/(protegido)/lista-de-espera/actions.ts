"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { sendAsAgency } from "@/lib/notify";
import { company } from "@/lib/company";
import { inviteFromWaitlist, listWaitlist } from "@/lib/waitlist";

/* Lista de espera (backoffice, 24/10/2026): convidar uma pessoa ou as próximas da fila. */

const send = (to: string, mail: { subject: string; text: string }) => sendAsAgency(company.brand, to, mail.subject, mail.text.split("\n"));

export async function inviteOne(id: string): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/lista-de-espera (convidou ${id})`);
  const n = await inviteFromWaitlist(createAdminClient(), [id], s.email, send);
  revalidatePath("/admin/lista-de-espera");
  return n ? ok("Convite enviado.") : fail("Essa pessoa já tinha sido convidada (ou o e-mail não saiu deste servidor).");
}

export async function inviteNext(fd: FormData): Promise<ActionResult> {
  const count = Math.min(200, Math.max(1, Number(fd.get("count")) || 0));
  const s = await requireAdmin(`/admin/lista-de-espera (convidou os próximos ${count})`);
  const db = createAdminClient();
  const next = (await listWaitlist(db, 2000)).filter((r) => !r.invited_at).slice(0, count).map((r) => r.id);
  if (!next.length) return fail("Ninguém esperando na fila.");
  const n = await inviteFromWaitlist(db, next, s.email, send);
  revalidatePath("/admin/lista-de-espera");
  return ok(`${n} ${n === 1 ? "convite enviado" : "convites enviados"} (de ${next.length} da fila).`);
}
