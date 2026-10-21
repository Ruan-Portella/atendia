"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { markFiscalEmitted } from "@/lib/fiscal-invoices";

/* Notas fiscais (backoffice): marcar como emitida a nota que o Ruan lançou no Emissor Nacional. Cada mudança fica no registro de acesso. */

export async function markInvoiceEmitted(id: string, formData: FormData): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/notas (marcou a nota ${id} como emitida)`);
  const number = String(formData.get("number") ?? "").trim() || null;
  if (!(await markFiscalEmitted(createAdminClient(), id, { number, by: s.email }))) return fail("Não foi possível marcar: a nota já pode ter sido marcada.");
  revalidatePath("/admin/notas");
  return ok("Nota marcada como emitida.");
}
