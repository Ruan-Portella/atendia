import type { ClientOption } from "@/lib/panel";
import { ClientPicker } from "@/components/client-picker";

/**
 * Os campos do chatbot novo: o cliente, o nome do assistente e o site (a tela Novo chatbot e o modal
 * da lista de Clientes; redesenho, etapa 5). Vão para createBot, que abre o chatbot criado.
 */
export function NewBotFields({ clients, defaultClientId, suggestedName = "", idPrefix }: { clients: ClientOption[]; defaultClientId?: string; suggestedName?: string; idPrefix: string }) {
  return (
    <>
      {/* o próprio negócio: o cliente do chatbot é ele mesmo (o nome vem do primeiro acesso) */}
      <ClientPicker clients={clients} defaultClientId={defaultClientId} suggestedName={suggestedName} idPrefix={idPrefix} />
      <div>
        <label htmlFor={`${idPrefix}-name`} className="label">Nome do assistente</label>
        <input id={`${idPrefix}-name`} name="name" required minLength={2} maxLength={40} className="input" placeholder="Sofia" defaultValue="Assistente" />
        <p className="mt-1 text-xs text-muted">De 2 a 40 caracteres. É como ele se apresenta no chat.</p>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-site`} className="label">Site onde o chatbot vai ficar (opcional)</label>
        <input id={`${idPrefix}-site`} name="client_site" maxLength={200} className="input" placeholder="clinicasorriso.com.br" />
        <p className="mt-1 text-xs text-muted">Em branco, usa o site do cliente.</p>
      </div>
    </>
  );
}
