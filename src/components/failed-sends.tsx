import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { failedMessages } from "@/lib/messages";
import { failureReason } from "@/lib/send-errors";
import { daysAgoIso } from "@/lib/utils";

/** Dias da lista: o bastante para ver um problema que se repete. */
const DAYS = 30;

/**
 * Envios que falharam (D', parte 7), na aba do canal: as mensagens do assistente e da equipe que o
 * canal recusou ou que a regra de estado barrou nos últimos 30 dias, com o motivo em português e o
 * link para a conversa.
 */
export async function FailedSends({ botId, channel }: { botId: string; channel: "whatsapp" | "instagram" }) {
  const rows = await failedMessages(createAdminClient(), { botIds: [botId], channel, since: daysAgoIso(DAYS), limit: 50 }).catch(() => []);
  const label = channel === "whatsapp" ? "WhatsApp" : "Instagram";
  return (
    <section className="card flex flex-col gap-2 p-5">
      <div>
        <h3 className="text-base font-medium">Envios que falharam</h3>
        <p className="text-xs text-muted">Mensagens deste chatbot que não chegaram pelo {label} nos últimos {DAYS} dias (as 50 mais novas), com o motivo.</p>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nenhuma. Tudo o que saiu pelo {label} foi aceito.</p>
      ) : (
        <ul className="flex flex-col text-sm">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-0.5 border-b border-line-2 py-2 last:border-0">
              <span className="flex flex-wrap items-center gap-x-2 text-xs text-muted">
                {new Date(r.createdAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}
                <span>· {r.role === "assistant" ? "assistente" : (r.author ?? "equipe")}</span>
                <Link href={`/painel/bots/${botId}/conversas/${r.conversationId}`} className="font-semibold text-brand hover:underline">abrir a conversa</Link>
              </span>
              <span className={r.failedAt ? "font-semibold text-danger" : "font-semibold text-amber-ink"}>
                {r.failedAt ? `Não entregue${r.errorCode ? ` (erro ${r.errorCode})` : ""}: ${failureReason(r.errorCode, channel)}` : `Não enviada: ${r.blockedReason}`}
              </span>
              <span className="line-clamp-2 text-ink-2">{r.content}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
