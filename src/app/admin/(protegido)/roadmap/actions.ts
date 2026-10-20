"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { isRoadmapId, mergeSuggestion, parseItemFields, publishSuggestion, rejectSuggestion, saveItem } from "@/lib/roadmap";

/* Roadmap público (backoffice): os itens das quatro colunas e a moderação das ideias. Cada mudança fica no registro de acesso. */

const refresh = () => {
  revalidatePath("/admin/roadmap");
  revalidatePath("/roadmap");
  revalidatePath("/painel/roadmap");
};

const fields = (formData: FormData, status?: string) => parseItemFields({ title: formData.get("title"), summary: formData.get("summary"), status: status ?? formData.get("status") });

export async function saveRoadmapItem(id: string | null, formData: FormData): Promise<ActionResult> {
  await requireAdmin(`/admin/roadmap (${id ? `alterou o item ${id}` : "criou um item"})`);
  const v = fields(formData);
  if ("error" in v) return fail(v.error);
  if (!(await saveItem(createAdminClient(), id, v))) return fail("Não foi possível salvar. Tente de novo.");
  refresh();
  return ok(id ? "Item salvo." : "Item criado.");
}

export async function deleteRoadmapItem(id: string): Promise<ActionResult> {
  await requireAdmin(`/admin/roadmap (apagou o item ${id})`);
  const { error } = await createAdminClient().from("roadmap_items").delete().eq("id", id);
  if (error) return fail("Não foi possível apagar. Tente de novo.");
  refresh();
  return ok("Item apagado.");
}

export async function publishRoadmapSuggestion(id: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin(`/admin/roadmap (publicou a ideia ${id})`);
  const v = fields(formData, "ideia");
  if ("error" in v) return fail(v.error);
  if (!(await publishSuggestion(createAdminClient(), id, { title: v.title, summary: v.summary }))) return fail("Não foi possível publicar: a ideia já pode ter sido moderada.");
  refresh();
  return ok("Publicada em Ideias, com a curtida de quem mandou.");
}

export async function mergeRoadmapSuggestion(id: string, formData: FormData): Promise<ActionResult> {
  await requireAdmin(`/admin/roadmap (juntou a ideia ${id})`);
  const itemId = formData.get("item_id");
  if (!isRoadmapId(itemId)) return fail("Escolha o item parecido.");
  if (!(await mergeSuggestion(createAdminClient(), id, itemId))) return fail("Não foi possível juntar: a ideia já pode ter sido moderada.");
  refresh();
  return ok("Juntada ao item, com a curtida de quem mandou.");
}

export async function rejectRoadmapSuggestion(id: string): Promise<ActionResult> {
  await requireAdmin(`/admin/roadmap (recusou a ideia ${id})`);
  if (!(await rejectSuggestion(createAdminClient(), id))) return fail("A ideia já tinha sido moderada.");
  refresh();
  return ok("Ideia recusada.");
}
