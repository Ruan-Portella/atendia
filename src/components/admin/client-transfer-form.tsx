import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { transferClientAction } from "@/app/admin/(protegido)/acoes";

/**
 * Transferência de cliente (D', parte 5): o suporte leva um cliente desta conta para outra, a
 * pedido do próprio negócio (também quando a agência sumiu). Não tem desfazer.
 */
export function ClientTransferForm({ agencyId, clients, transfers }: { agencyId: string; clients: Array<{ id: string; name: string }>; transfers: Array<{ id: number; client_name: string; to: string; from: string; requested_by: string; done_by: string; created_at: string }> }) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-lg font-bold">Transferir cliente para outra conta</h2>
        <p className="text-sm text-muted">
          Só a pedido do negócio (o dono dos dados), também quando a agência sumiu. Vão o cliente, os chatbots, as conversas, os contatos e a base; ficam com esta conta a auditoria, o uso já contado e a cobrança. As chaves, os webhooks e os segredos desta conta deixam de alcançar o cliente, as ações ficam desligadas sem segredo, as campanhas agendadas pausam e o negócio precisa fazer o aceite de novo na conta nova. Chatbot de um modelo daqui vira chatbot comum, com a versão em uso. Não tem desfazer.
        </p>
      </div>
      {clients.length ? (
        <ActionForm action={transferClientAction.bind(null, agencyId)} className="grid gap-2 sm:grid-cols-2">
          <div>
            <label htmlFor="tr-client" className="label">Cliente</label>
            <select id="tr-client" name="client_id" required className="input">
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="tr-to" className="label">Conta de destino (id ou e-mail do dono)</label>
            <input id="tr-to" name="to" required className="input" placeholder="dono@outraagencia.com.br" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="tr-by" className="label">Quem pediu, do lado do negócio (nome e como pediu)</label>
            <input id="tr-by" name="requested_by" required maxLength={300} className="input" placeholder="Zé, dono da Pizzaria do Zé, por e-mail de 19/10" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="tr-reason" className="label">Motivo (opcional)</label>
            <input id="tr-reason" name="reason" maxLength={1000} className="input" placeholder="troca de agência" />
          </div>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" name="confirm" className="mt-1 accent-brand" />
            O pedido veio do próprio negócio, e os donos das duas contas vão receber o aviso.
          </label>
          <SubmitButton className="btn-primary justify-self-start" pendingLabel="Transferindo…">Transferir</SubmitButton>
        </ActionForm>
      ) : (
        <p className="text-sm text-muted">Esta conta não tem clientes.</p>
      )}
      {transfers.length > 0 && (
        <ul className="flex flex-col text-sm">
          {transfers.map((t) => (
            <li key={t.id} className="border-b border-line-2 py-1.5 last:border-0">
              <span className="font-semibold">{t.client_name}</span> · {t.from} → {t.to}
              <span className="block text-xs text-muted">
                {new Date(t.created_at).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })} · pedido por {t.requested_by} · feito por {t.done_by}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
