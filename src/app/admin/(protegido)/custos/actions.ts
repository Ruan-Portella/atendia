"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fixedCostFields } from "@/lib/validation";
import { fail, ok, type ActionResult } from "@/lib/action-result";

/* Custos fixos mensais da plataforma (backoffice). Cada mudança fica no registro de acesso. */

export async function addFixedCost(fd: FormData): Promise<ActionResult> {
  await requireAdmin("/admin/custos (adicionou custo fixo)");
  const v = fixedCostFields(fd);
  if ("error" in v) return fail(v.error);
  const { error } = await createAdminClient().from("platform_costs").insert(v);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath("/admin", "layout");
  return ok("Custo adicionado.");
}

export async function updateFixedCost(id: number, fd: FormData): Promise<ActionResult> {
  await requireAdmin(`/admin/custos (alterou custo fixo ${id})`);
  const v = fixedCostFields(fd);
  if ("error" in v) return fail(v.error);
  const { error } = await createAdminClient().from("platform_costs").update({ ...v, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath("/admin", "layout");
  return ok("Custo salvo.");
}

export async function deleteFixedCost(id: number): Promise<ActionResult> {
  await requireAdmin(`/admin/custos (apagou custo fixo ${id})`);
  const { error } = await createAdminClient().from("platform_costs").delete().eq("id", id);
  if (error) return fail("Não foi possível apagar. Tente de novo.");
  revalidatePath("/admin", "layout");
  return ok("Custo apagado.");
}
