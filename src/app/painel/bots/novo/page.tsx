import Link from "next/link";
import { createBot } from "../../actions";
import { requirePermission } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { getClientOptions } from "@/lib/panel";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { NewBotFields } from "@/components/new-bot-fields";

export const metadata = { title: "Novo chatbot" };

export default async function NewBotPage({ searchParams }: PageProps<"/painel/bots/novo">) {
  const sp = await searchParams;
  const clienteId = typeof sp.cliente === "string" ? sp.cliente : null;
  const { agency } = await requirePermission("config");
  const clients = await getClientOptions(await createClient(), agency.id);
  const back = clienteId ? { href: `/painel/clientes/${clienteId}`, label: "← Cliente" } : { href: "/painel/clientes", label: "← Clientes" };

  return (
    <div className="max-w-[560px]">
      <Link href={back.href} className="text-sm font-semibold text-muted">{back.label}</Link>
      <h1 className="mt-3 text-2xl font-normal sm:text-[28px]">Novo chatbot</h1>
      <p className="text-sm text-muted">Um cliente pode ter vários chatbots (ex.: um para vendas e outro para suporte). Você adiciona o site e os documentos no próximo passo.</p>
      <ActionForm action={createBot} className="card mt-6 flex flex-col gap-4 p-6">
        <NewBotFields clients={clients} defaultClientId={clienteId ?? undefined} suggestedName={agency.profile === "business" ? agency.name : ""} idPrefix="nb" />
        <SubmitButton pendingLabel="Criando…" className="btn-primary self-start">Criar e configurar</SubmitButton>
      </ActionForm>
    </div>
  );
}
