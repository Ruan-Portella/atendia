import Link from "next/link";
import { createBot } from "../../actions";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata = { title: "Novo chatbot" };

export default function NewBotPage() {
  return (
    <div className="max-w-[560px]">
      <Link href="/painel" className="text-sm font-semibold text-muted">← Chatbots</Link>
      <h1 className="mt-3 text-2xl font-bold sm:text-[28px]">Novo chatbot</h1>
      <p className="text-sm text-muted">Você adiciona o site e os documentos do cliente no próximo passo.</p>
      <form action={createBot} className="card mt-6 flex flex-col gap-4 p-6">
        <div>
          <label htmlFor="client_name" className="label">Nome do cliente (empresa)</label>
          <input id="client_name" name="client_name" required className="input" placeholder="Clínica Sorriso" />
        </div>
        <div>
          <label htmlFor="name" className="label">Nome do assistente</label>
          <input id="name" name="name" required className="input" placeholder="Sofia" defaultValue="Assistente" />
        </div>
        <div>
          <label htmlFor="client_site" className="label">Site do cliente (opcional)</label>
          <input id="client_site" name="client_site" className="input" placeholder="clinicasorriso.com.br" />
        </div>
        <div>
          <label htmlFor="price" className="label">Quanto você vai cobrar por mês (R$, só para o seu controle)</label>
          <input id="price" name="price" type="number" min={0} step="10" className="input" placeholder="400" />
        </div>
        <SubmitButton pendingLabel="Criando…" className="btn-primary self-start">Criar e configurar</SubmitButton>
      </form>
    </div>
  );
}
