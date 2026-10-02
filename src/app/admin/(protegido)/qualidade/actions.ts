"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyPending } from "@/lib/gate/base";
import { ok, type ActionResult } from "@/lib/action-result";

/**
 * Classifica agora os trechos pendentes da base (portão, parte 6). Na dev a rotina diária não
 * roda, então é por aqui; em produção ela termina o que sobrar. Até ~4 minutos por clique.
 */
export async function classifyBaseNow(): Promise<ActionResult> {
  await requireAdmin("/admin/qualidade (classificou a base)");
  const r = await classifyPending(createAdminClient(), { budgetMs: 240_000 });
  revalidatePath("/admin/qualidade");
  const errors = r.failed ? ` ${r.failed} com erro (tenta de novo no próximo clique).` : "";
  return ok(r.remaining ? `${r.classified} trechos classificados.${errors} Faltam ${r.remaining}: clique de novo.` : `${r.classified} trechos classificados.${errors} Base em dia.`);
}
