"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { text } from "@/lib/validation";
import { STATUS_COMPONENTS, addIncidentUpdate, createIncident, isIncidentLevel, isStatusComponent, resolveIncident, runStatusCheck } from "@/lib/status";

/* Página de status (backoffice): os incidentes escritos pela equipe e a conferência na hora. Cada mudança fica no registro de acesso. */

const refresh = () => {
  revalidatePath("/admin/status");
  revalidatePath("/status");
};

const bodyOf = (fd: FormData) => {
  const body = text(fd.get("body")).trim();
  return body.length < 3 || body.length > 1000 ? null : body;
};

export async function createStatusIncident(fd: FormData): Promise<ActionResult> {
  const title = text(fd.get("title")).replace(/\s+/g, " ").trim();
  if (title.length < 3 || title.length > 120) return fail("O título vai de 3 a 120 letras.");
  const level = String(fd.get("level") ?? "");
  if (!isIncidentLevel(level)) return fail("Escolha o tipo do incidente.");
  const components = STATUS_COMPONENTS.map((c) => c.id).filter((id) => fd.get(`c_${id}`) === "on" && isStatusComponent(id));
  if (!components.length) return fail("Marque pelo menos uma parte afetada.");
  const body = bodyOf(fd);
  if (!body) return fail("Escreva o primeiro aviso (de 3 a 1.000 letras): o que está acontecendo e o que já sabemos.");
  const s = await requireAdmin(`/admin/status (abriu o incidente "${title}")`);
  if (!(await createIncident(createAdminClient(), { title, level, components, body, by: s.email }))) return fail("Não foi possível salvar. Tente de novo.");
  refresh();
  return ok("Incidente publicado na página de status.");
}

export async function addStatusUpdate(incidentId: string, fd: FormData): Promise<ActionResult> {
  const body = bodyOf(fd);
  if (!body) return fail("Escreva a atualização (de 3 a 1.000 letras).");
  const s = await requireAdmin(`/admin/status (atualizou o incidente ${incidentId})`);
  if (!(await addIncidentUpdate(createAdminClient(), incidentId, body, s.email))) return fail("Não foi possível salvar. Tente de novo.");
  refresh();
  return ok("Atualização publicada.");
}

export async function resolveStatusIncident(incidentId: string, fd: FormData): Promise<ActionResult> {
  const body = bodyOf(fd) ?? "Resolvido. Tudo voltou a funcionar normalmente.";
  const s = await requireAdmin(`/admin/status (resolveu o incidente ${incidentId})`);
  if (!(await resolveIncident(createAdminClient(), incidentId, body, s.email))) return fail("Não foi possível salvar. Tente de novo.");
  refresh();
  return ok("Incidente resolvido.");
}

/** Confere os sinais agora (sem esperar o tique de 5 minutos). */
export async function checkStatusNow(): Promise<ActionResult> {
  await requireAdmin("/admin/status (conferiu os sinais)");
  const r = await runStatusCheck(createAdminClient(), new Date(), { force: true });
  refresh();
  return ok(r.changed.length ? `Conferido: mudou ${r.changed.join(", ")}.` : "Conferido: nada mudou.");
}
