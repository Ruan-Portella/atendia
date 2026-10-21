"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit, requestMeta } from "@/lib/audit";
import { can } from "@/lib/team";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { deleteSector, parseHolidays, saveHolidays, saveSector, sectorFromForm } from "@/lib/sectors";

/* Setores e feriados do cliente (Caixa de entrada, parte 1): quem configura o cliente (dono, administrador e editor no escopo). */

const DENIED = "O seu papel na equipe não permite esta ação. Fale com o dono ou com um administrador da agência.";

/** A sessão pode configurar este cliente? (a RLS do cliente limita ao escopo da pessoa) */
async function configClient(clientId: string) {
  const ctx = await requireAgency();
  if (!can(ctx.role, "config")) return null;
  const { data } = await (await createClient()).from("clients").select("id, name").eq("id", clientId).maybeSingle();
  return data ? { ctx, client: data as { id: string; name: string } } : null;
}

async function auditClient(ctx: Awaited<ReturnType<typeof requireAgency>>, action: string, target: { type: string; id: string }, after: Record<string, unknown>) {
  await audit(createAdminClient(), { agencyId: ctx.agency.id, actorType: "user", actorId: ctx.userId, action, targetType: target.type, targetId: target.id, after, ...(await requestMeta()) });
}

export async function saveSectorAction(clientId: string, sectorId: string | null, formData: FormData): Promise<ActionResult> {
  const c = await configClient(clientId);
  if (!c) return fail(DENIED);
  const input = sectorFromForm(formData);
  if ("error" in input) return fail(input.error);
  const r = await saveSector(createAdminClient(), { agencyId: c.ctx.agency.id, clientId, id: sectorId, input });
  if ("error" in r) return fail(r.error);
  await auditClient(c.ctx, sectorId ? "setor.editar" : "setor.criar", { type: "sector", id: r.id }, { nome: input.name, distribuicao: input.distribution, pessoas: input.members.length, horario_proprio: Boolean(input.hours) });
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok(sectorId ? "Setor salvo." : `Setor ${input.name.trim()} criado.`);
}

export async function deleteSectorAction(clientId: string, sectorId: string): Promise<ActionResult> {
  const c = await configClient(clientId);
  if (!c) return fail(DENIED);
  if (!(await deleteSector(createAdminClient(), { clientId, id: sectorId }))) return fail("Não foi possível apagar o setor. Tente de novo.");
  await auditClient(c.ctx, "setor.apagar", { type: "sector", id: sectorId }, {});
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok("Setor apagado. As conversas dele voltaram para a fila geral do cliente.");
}

export async function saveHolidaysAction(clientId: string, formData: FormData): Promise<ActionResult> {
  const c = await configClient(clientId);
  if (!c) return fail(DENIED);
  const parsed = parseHolidays(String(formData.get("holidays") ?? ""));
  if ("error" in parsed) return fail(parsed.error);
  if (!(await saveHolidays(createAdminClient(), clientId, parsed.holidays))) return fail("Não foi possível salvar os feriados. Tente de novo.");
  await auditClient(c.ctx, "cliente.feriados", { type: "client", id: clientId }, { feriados: parsed.holidays.length });
  revalidatePath(`/painel/clientes/${clientId}`);
  return ok(parsed.holidays.length ? `${parsed.holidays.length} feriado${parsed.holidays.length === 1 ? "" : "s"} salvo${parsed.holidays.length === 1 ? "" : "s"}.` : "Sem feriados.");
}
