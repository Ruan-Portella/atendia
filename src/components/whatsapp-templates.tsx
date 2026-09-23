import { createAdminClient } from "@/lib/supabase/admin";
import { WhatsAppError } from "@/lib/whatsapp";
import { STATUS_LABEL, listTemplates, templateBody, type Template, type TemplateChannel } from "@/lib/whatsapp-templates";
import { createWhatsAppTemplate, deleteWhatsAppTemplate } from "@/app/painel/actions";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";

const STATUS_STYLE: Record<string, string> = {
  APPROVED: "bg-brand-soft text-brand",
  PENDING: "bg-amber-soft text-amber-ink",
  REJECTED: "bg-danger-soft text-danger",
};

/**
 * Modelos de mensagem da conta do WhatsApp do chatbot: lista com status da Meta, criação e
 * exclusão (o envio fica nas conversas). Quem renderiza já conferiu o dono do chatbot e o e-mail liberado.
 */
export async function WhatsAppTemplates({ botId }: { botId: string }) {
  const { data: ch } = await createAdminClient().from("whatsapp_channels").select("phone_number_id, waba_id, access_token_enc").eq("bot_id", botId).maybeSingle();
  if (!ch?.waba_id) {
    return <p className="text-sm text-muted">Para usar modelos de mensagem, conecte o número informando a conta do WhatsApp Business (WABA ID).</p>;
  }

  let templates: Template[] = [];
  let error: string | null = null;
  try {
    templates = await listTemplates(ch as TemplateChannel);
  } catch (e) {
    error = e instanceof WhatsAppError ? e.message : "erro desconhecido";
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-lg font-bold">Modelos de mensagem</h3>
        <p className="text-sm text-muted">Fora das 24 h depois da última mensagem do cliente, o WhatsApp só deixa mandar modelos aprovados pela Meta. Os aprovados aparecem para envio dentro das conversas e em “+ Nova conversa”.</p>
      </div>

      {error ? (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Não deu para ler os modelos na Meta: {error}</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted">Nenhum modelo ainda.</p>
      ) : (
        <div className="card overflow-hidden">
          {templates.map((t) => (
            <div key={t.id} className="flex flex-col gap-1.5 border-b border-line-2 px-4 py-3 text-sm last:border-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-semibold">{t.name}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_STYLE[t.status] ?? "bg-ground text-muted"}`}>{STATUS_LABEL[t.status] ?? t.status.toLowerCase()}</span>
                <span className="text-xs text-muted">{t.category === "MARKETING" ? "marketing" : t.category === "UTILITY" ? "utilidade" : t.category.toLowerCase()} · {t.language}</span>
                <ConfirmAction
                  action={deleteWhatsAppTemplate.bind(null, botId, t.name)}
                  title={`Excluir o modelo ${t.name}?`}
                  description="Ele sai da conta do WhatsApp. A Meta não deixa criar outro com o mesmo nome por 30 dias."
                  confirmLabel="Excluir modelo"
                  className="ml-auto text-xs font-medium text-danger hover:underline"
                >
                  Excluir
                </ConfirmAction>
              </div>
              <p className="whitespace-pre-line text-ink-2">{templateBody(t)}</p>
              {t.status === "REJECTED" && t.rejected_reason && t.rejected_reason !== "NONE" && <p className="text-xs text-danger">Motivo da Meta: {t.rejected_reason}</p>}
            </div>
          ))}
        </div>
      )}

      <details className="card p-5">
        <summary className="cursor-pointer text-sm font-semibold">Criar modelo</summary>
        <ActionForm action={createWhatsAppTemplate.bind(null, botId)} className="mt-4 flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div><label htmlFor="tpl-name" className="label">Nome (só minúsculas e _)</label><input id="tpl-name" name="name" required maxLength={512} pattern="[a-z0-9_ ]+" className="input font-mono" placeholder="retorno_atendimento" /></div>
            <div>
              <label htmlFor="tpl-category" className="label">Categoria</label>
              <select id="tpl-category" name="category" className="input" defaultValue="UTILITY">
                <option value="UTILITY">Utilidade (retorno, confirmação, aviso)</option>
                <option value="MARKETING">Marketing (promoção, novidade)</option>
              </select>
            </div>
          </div>
          <div><label htmlFor="tpl-body" className="label">Texto (variáveis: {"{{1}}"}, {"{{2}}"}…)</label><textarea id="tpl-body" name="body" required rows={4} maxLength={1024} className="input" placeholder={"Olá, {{1}}! Aqui é da equipe. Vimos sua mensagem sobre {{2}} e podemos continuar por aqui."} /></div>
          <div><label htmlFor="tpl-examples" className="label">Exemplos das variáveis (um por linha, na ordem)</label><textarea id="tpl-examples" name="examples" rows={2} className="input" placeholder={"Maria\nclareamento"} /></div>
          <p className="text-xs text-muted">Idioma: português (Brasil). A Meta analisa em minutos. Modelos de marketing são cobrados mais caro e exigem que a pessoa tenha aceitado receber.</p>
          <SubmitButton pendingLabel="Enviando para a Meta…" className="btn-primary self-start">Enviar para análise</SubmitButton>
        </ActionForm>
      </details>
    </div>
  );
}
