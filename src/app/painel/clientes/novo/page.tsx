import { notFound, redirect } from "next/navigation";
import { requirePermission } from "@/lib/agency";

export const metadata = { title: "Novo cliente" };

/** O endereço antigo de Novo cliente (23/10/2026): abre o modal da lista de Clientes. */
export default async function NewClientPage() {
  // cliente novo fica fora do escopo de quem vê só alguns clientes
  const { member } = await requirePermission("config");
  if (member.scope !== "all") notFound();
  redirect("/painel/clientes?criar=cliente");
}
