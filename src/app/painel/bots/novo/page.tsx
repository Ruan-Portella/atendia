import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/agency";

export const metadata = { title: "Novo chatbot" };

/**
 * O endereço antigo de Novo chatbot (os primeiros passos ainda levam para cá; 23/10/2026): abre o
 * modal de criar, na página do cliente quando ele vem junto, senão na lista de Clientes.
 */
export default async function NewBotPage({ searchParams }: PageProps<"/painel/bots/novo">) {
  const sp = await searchParams;
  await requirePermission("config");
  const cliente = typeof sp.cliente === "string" && /^[0-9a-f-]{36}$/i.test(sp.cliente) ? sp.cliente : null;
  redirect(cliente ? `/painel/clientes/${cliente}?criar=chatbot&cliente=${cliente}` : "/painel/clientes?criar=chatbot");
}
