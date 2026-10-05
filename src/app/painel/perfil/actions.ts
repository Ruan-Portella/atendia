"use server";

import { revalidatePath } from "next/cache";
import { requireAgency } from "@/lib/agency";
import { createAdminClient } from "@/lib/supabase/admin";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import { profileProblem } from "@/lib/attendants";

/** Meu perfil: nome de exibição e foto de quem está logado (qualquer papel). */
export async function updateMyProfile(formData: FormData): Promise<ActionResult> {
  const { member } = await requireAgency();
  const name = String(formData.get("display_name") ?? "").replace(/\s+/g, " ").trim();
  const avatar = String(formData.get("avatar_url") ?? "").trim() || null;
  const problem = profileProblem(name, avatar, member.id);
  if (problem) return fail(problem);
  const { error } = await createAdminClient().from("agency_members").update({ display_name: name, avatar_url: avatar }).eq("id", member.id);
  if (error) return fail("Não foi possível salvar. Tente de novo.");
  revalidatePath("/painel", "layout");
  return ok("Perfil salvo. As próximas mensagens já saem com este nome.");
}
