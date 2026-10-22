import { notFound, redirect } from "next/navigation";
import { requireAgency } from "@/lib/agency";
import { firstSettingsHref } from "@/lib/nav";

/** "Configurações" do menu: abre o primeiro ajuste que a pessoa pode ver. */
export default async function ConfiguracoesPage() {
  const { role, packs } = await requireAgency();
  const href = firstSettingsHref(role, packs);
  if (!href) notFound();
  redirect(href);
}
