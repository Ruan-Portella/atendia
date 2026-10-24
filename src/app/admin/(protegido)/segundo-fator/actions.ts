"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/platform-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { text } from "@/lib/validation";
import { supportRefuseRecovery, supportRemoveFactors } from "@/lib/mfa-recovery";

/* Recuperação do segundo fator (backoffice): remover o app autenticador depois das 48 horas, ou recusar. Cada uma fica no registro de acesso e na auditoria da agência. */

const SUPPORT_PROBLEM = {
  nao_encontrado: "Pedido não encontrado.",
  espera: "Ainda está na espera de 48 horas depois da confirmação.",
  fechado: "Este pedido já foi encerrado (ou ainda não foi confirmado pelo e-mail).",
  erro: "O Supabase não removeu o fator. Tente de novo em alguns minutos.",
  conferencia: "Escreva como conferiu a pessoa fora do e-mail (pelo menos 10 letras): o WhatsApp do dono, outro administrador da conta…",
} as const;

export async function removeRecoveredFactor(id: string, fd: FormData): Promise<ActionResult> {
  const s = await requireAdmin(`/admin/segundo-fator (removeu o segundo fator do pedido ${id})`);
  const r = await supportRemoveFactors(createAdminClient(), id, s.email, { check: text(fd.get("check")) });
  if (!r.ok) return fail(SUPPORT_PROBLEM[r.problem]);
  revalidatePath("/admin/segundo-fator");
  return ok(r.removed ? `Pronto: o app autenticador saiu da conta (${r.removed === 1 ? "1 fator" : `${r.removed} fatores`}) e o e-mail foi para a pessoa.` : "A conta já estava sem fator: o pedido foi encerrado e o e-mail foi para a pessoa.");
}

export async function refuseRecovery(id: string, fd: FormData): Promise<ActionResult> {
  const note = text(fd.get("note")).trim();
  if (note.length < 3) return fail("Escreva o motivo (vai no e-mail à pessoa).");
  const s = await requireAdmin(`/admin/segundo-fator (recusou o pedido ${id})`);
  const r = await supportRefuseRecovery(createAdminClient(), id, s.email, note);
  if (!r.ok) return fail(SUPPORT_PROBLEM[r.problem]);
  revalidatePath("/admin/segundo-fator");
  return ok("Pedido recusado. O motivo foi por e-mail.");
}
