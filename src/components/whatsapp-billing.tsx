import { createAdminClient } from "@/lib/supabase/admin";
import { relativeTime } from "@/lib/utils";
import { WHATSAPP_BILLING_URL, hasPaymentMethod } from "@/lib/whatsapp";

/**
 * Pagamento da Meta do número conectado: as mensagens do WhatsApp são cobradas pela Meta direto
 * do cliente, com o cartão dele. Consulta a conta (primary_funding_id) a cada abertura da aba:
 * sem cartão, avisa; com recusa por pagamento, alerta; com cartão, limpa o alerta. Só para números
 * conectados pelo cadastro incorporado (o de teste é da própria plataforma).
 */
export async function WhatsAppBilling({ botId }: { botId: string }) {
  const admin = createAdminClient();
  const { data: ch } = await admin.from("whatsapp_channels").select("phone_number_id, waba_id, access_token_enc, business_id, payment_issue_at").eq("bot_id", botId).maybeSingle();
  if (!ch?.waba_id || !ch.business_id) return null;

  let funded: boolean;
  try {
    funded = await hasPaymentMethod({ ...ch, waba_id: ch.waba_id });
  } catch {
    return null; // sem resposta da Meta agora: melhor não mostrar nada do que mostrar errado
  }

  const link = <a href={WHATSAPP_BILLING_URL} target="_blank" rel="noopener" className="font-semibold underline">Gerenciador do WhatsApp</a>;

  if (funded) {
    if (ch.payment_issue_at) await admin.from("whatsapp_channels").update({ payment_issue_at: null }).eq("bot_id", botId);
    return <p className="text-xs text-muted">✓ Forma de pagamento cadastrada na Meta. As mensagens são cobradas direto no cartão do cliente.</p>;
  }

  if (ch.payment_issue_at) {
    return (
      <div className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">
        <strong>A Meta está recusando mensagens por falta de pagamento</strong> (desde {relativeTime(ch.payment_issue_at)}). O assistente não consegue responder por WhatsApp até o cliente cadastrar um cartão no {link}, em Configurações de pagamento. Depois disso volta sozinho.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg bg-amber-soft px-3 py-2.5 text-sm text-amber-ink">
      <p><strong>Último passo: o cliente precisa cadastrar um cartão na Meta.</strong> No {link} → Configurações de pagamento, com o login do Facebook dele.</p>
      <p className="text-xs">As mensagens do WhatsApp são cobradas pela Meta direto nesse cartão (não pela agência nem pelo Boavoz). Sem cartão, o assistente responde enquanto houver mensagens grátis; depois a Meta começa a recusar e ele para. Este aviso some sozinho quando o cartão entrar.</p>
    </div>
  );
}
