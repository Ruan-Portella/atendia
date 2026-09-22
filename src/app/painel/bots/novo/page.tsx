import Link from "next/link";
import { createBot } from "../../actions";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { getClientOptions } from "@/lib/panel";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ClientPicker } from "@/components/client-picker";

export const metadata = { title: "Novo chatbot" };

export default async function NewBotPage({ searchParams }: PageProps<"/painel/bots/novo">) {
  const sp = await searchParams;
  const clienteId = typeof sp.cliente === "string" ? sp.cliente : null;
  const { agency } = await requireAgency();
  const clients = await getClientOptions(await createClient(), agency.id);
  const back = clienteId ? { href: `/painel/clientes/${clienteId}`, label: "← Cliente" } : { href: "/painel", label: "← Chatbots" };

  return (
    <div className="max-w-[560px]">
      <Link href={back.href} className="text-sm font-semibold text-muted">{back.label}</Link>
      <h1 className="mt-3 text-2xl font-bold sm:text-[28px]">Novo chatbot</h1>
      <p className="text-sm text-muted">Um cliente pode ter vários chatbots (ex.: um para vendas e outro para suporte). Você adiciona o site e os documentos no próximo passo.</p>
      <ActionForm action={createBot} className="card mt-6 flex flex-col gap-4 p-6">
        <ClientPicker clients={clients} defaultClientId={clienteId ?? undefined} idPrefix="nb" />
        <div>
          <label htmlFor="name" className="label">Nome do assistente</label>
          <input id="name" name="name" required minLength={2} maxLength={40} className="input" placeholder="Sofia" defaultValue="Assistente" />
          <p className="mt-1 text-xs text-muted">De 2 a 40 caracteres. É como ele se apresenta no chat.</p>
        </div>
        <div>
          <label htmlFor="client_site" className="label">Site onde o chatbot vai ficar (opcional)</label>
          <input id="client_site" name="client_site" maxLength={200} className="input" placeholder="clinicasorriso.com.br" />
          <p className="mt-1 text-xs text-muted">Em branco, usa o site do cliente.</p>
        </div>
        <SubmitButton pendingLabel="Criando…" className="btn-primary self-start">Criar e configurar</SubmitButton>
      </ActionForm>
    </div>
  );
}
