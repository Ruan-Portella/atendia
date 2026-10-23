import { redirect } from "next/navigation";

/** A importação virou um painel lateral na aba Contatos do cliente (rodada 2 das telas, 23/10/2026); o endereço antigo leva para lá. */
export default async function ImportContactsPage({ params }: PageProps<"/painel/clientes/[id]/contatos/importar">) {
  const { id } = await params;
  redirect(`/painel/clientes/${id}?tab=contatos`);
}
