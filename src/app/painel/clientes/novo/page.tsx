import Link from "next/link";
import { createClientRecord } from "../../actions";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ClientFields } from "@/components/client-fields";

export const metadata = { title: "Novo cliente" };

export default function NewClientPage() {
  return (
    <div className="max-w-[560px]">
      <Link href="/painel/clientes" className="text-sm font-semibold text-muted">← Clientes</Link>
      <h1 className="mt-3 text-2xl font-bold sm:text-[28px]">Novo cliente</h1>
      <p className="text-sm text-muted">Depois você cria os chatbots dele dentro do painel do cliente.</p>
      <ActionForm action={createClientRecord} className="card mt-6 flex flex-col gap-4 p-6">
        <ClientFields />
        <SubmitButton pendingLabel="Criando…" className="btn-primary self-start">Criar cliente</SubmitButton>
      </ActionForm>
    </div>
  );
}
