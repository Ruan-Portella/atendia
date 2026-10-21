"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { requestMeta } from "@/lib/audit";
import { cancelRecovery, confirmRecovery } from "@/lib/mfa-recovery";

/* O link do e-mail da recuperação do segundo fator (painel e área do cliente): o token é a prova de que a pessoa abriu o e-mail. */

const STEP_PROBLEM = {
  nao_encontrado: "Link inválido. Peça a recuperação de novo na tela de verificação.",
  vencido: "O prazo para confirmar acabou. Peça a recuperação de novo na tela de verificação.",
  fechado: "Este pedido já foi encerrado.",
} as const;

const refresh = (token: string) => {
  revalidatePath(`/segundo-fator/${token}`);
  revalidatePath(`/cliente/segundo-fator/${token}`);
};

export async function confirmRecoveryAction(token: string): Promise<ActionResult> {
  const r = await confirmRecovery(createAdminClient(), token, await requestMeta());
  if (!r.ok) return fail(STEP_PROBLEM[r.problem]);
  refresh(token);
  return ok("Pedido confirmado. Mandamos um e-mail com a data da remoção.");
}

export async function cancelRecoveryAction(token: string): Promise<ActionResult> {
  const r = await cancelRecovery(createAdminClient(), token, await requestMeta());
  if (!r.ok) return fail(STEP_PROBLEM[r.problem]);
  refresh(token);
  return ok("Pedido cancelado. O app autenticador continua na conta.");
}
