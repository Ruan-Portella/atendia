"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { isRoadmapId, parseSuggestion, submitSuggestion, toggleLike } from "@/lib/roadmap";

/* Roadmap no painel (Lançamento, parte 5): qualquer pessoa da equipe curte e manda ideias. */

export async function toggleRoadmapLike(itemId: string): Promise<ActionResult> {
  const { userId } = await requireAgency();
  if (!isRoadmapId(itemId)) return fail("Item não encontrado. Recarregue a página.");
  const r = await toggleLike(createAdminClient(), itemId, userId);
  if (!r.ok) return fail(r.message);
  revalidatePath("/painel/roadmap");
  revalidatePath("/roadmap");
  return ok(r.liked ? "Curtido." : "Curtida desfeita.");
}

export async function sendRoadmapSuggestion(formData: FormData): Promise<ActionResult> {
  const { userId, agency } = await requireAgency();
  const v = parseSuggestion({ title: formData.get("title"), details: formData.get("details") });
  if ("error" in v) return fail(v.error);
  const r = await submitSuggestion(createAdminClient(), { userId, agencyId: agency.id, ...v });
  if (!r.ok) return fail(r.message);
  revalidatePath("/painel/roadmap");
  return ok("Recebemos a sua ideia. Obrigado! Você acompanha o que acontece com ela aqui embaixo.");
}
