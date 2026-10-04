import Link from "next/link";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/utils";
import { DSR_DAYS, dueDateBR } from "@/lib/data-subject";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { confirmDataSubjectRequest } from "../actions";

export const metadata = { title: "Segurança" };

/** Prazo da LGPD já passou? */
const overdue = (iso: string) => Date.parse(iso) < Date.now();

const CHANNEL: Record<string, string> = { widget: "Chat do site", whatsapp: "WhatsApp", instagram: "Instagram", painel: "Painel", api: "API" };

interface Row {
  id: string;
  client_id: string | null;
  bot_id: string | null;
  conversation_id: string | null;
  channel: string;
  origin: string;
  status: "aguardando" | "executado";
  requested_at: string;
  due_at: string;
  executed_at: string | null;
  contact_notified_at: string | null;
  summary: { conversas?: number; leads?: number; contatos?: number } | null;
}

/**
 * Segurança (leva S): pedidos do titular. A agência confirma como operadora, em nome do negócio
 * (o controlador); a rotina apaga e avisa o contato. Auditoria, acessos, suporte e segundo fator
 * entram aqui na próxima parte.
 */
export default async function SecurityPage() {
  await requireAgency();
  const supabase = await createClient();
  const [{ data }, { data: clients }, { data: bots }] = await Promise.all([
    supabase.from("data_subject_requests").select("id, client_id, bot_id, conversation_id, channel, origin, status, requested_at, due_at, executed_at, contact_notified_at, summary").order("requested_at", { ascending: false }).limit(100),
    supabase.from("clients").select("id, name"),
    supabase.from("bots").select("id, name"),
  ]);
  const rows = (data ?? []) as Row[];
  const clientName = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  const botName = new Map((bots ?? []).map((b) => [b.id as string, b.name as string]));
  const pending = rows.filter((r) => r.status === "aguardando");
  const done = rows.filter((r) => r.status === "executado");

  return (
    <div className="flex max-w-[860px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-[28px]">Segurança</h1>
        <p className="text-sm text-muted">Pedidos de exclusão de dados feitos pelos contatos (LGPD). Você confirma como operadora, em nome do negócio atendido.</p>
      </div>

      <section className="card flex flex-col gap-3 p-6">
        <div>
          <h2 className="text-base font-bold">Pedidos do titular</h2>
          <p className="text-sm text-muted">
            O contato pede pelo chat (“apaga meus dados”) e confirma. Ao confirmar aqui, o BoaVoz apaga as conversas, a ficha do contato, os leads e o que ele informou, põe o número na lista de quem não recebe mensagens da empresa e avisa a pessoa pelo canal, quando a janela de 24 horas ainda está aberta. A LGPD dá {DSR_DAYS} dias para atender.
          </p>
        </div>
        {pending.length === 0 ? (
          <p className="text-sm text-muted">Nenhum pedido aguardando.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {pending.map((r) => {
              const late = overdue(r.due_at);
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0 text-sm">
                    <div className="font-semibold">{(r.client_id && clientName.get(r.client_id)) || "Demonstração"}{r.bot_id && botName.get(r.bot_id) ? ` · ${botName.get(r.bot_id)}` : ""}</div>
                    <div className="text-xs text-muted">
                      {CHANNEL[r.channel] ?? r.channel} · pedido {relativeTime(r.requested_at)} ·{" "}
                      <span className={late ? "font-semibold text-danger" : ""}>{late ? `prazo venceu em ${dueDateBR(r.due_at)}` : `prazo até ${dueDateBR(r.due_at)}`}</span>
                      {r.conversation_id && r.bot_id ? <> · <Link href={`/painel/bots/${r.bot_id}/conversas/${r.conversation_id}`} className="underline">ver conversa</Link></> : null}
                    </div>
                  </div>
                  <ConfirmAction
                    action={confirmDataSubjectRequest.bind(null, r.id)}
                    title="Apagar os dados deste contato?"
                    description="Saem as conversas dele neste assistente (com as mensagens), a ficha do contato, os leads, as perguntas e a resposta de 18+. O número entra na lista de quem não recebe mensagens da empresa. Não tem desfazer."
                    confirmLabel="Apagar os dados"
                    className="btn-primary py-1.5 text-xs"
                  >
                    Confirmar e apagar
                  </ConfirmAction>
                </li>
              );
            })}
          </ul>
        )}
        {done.length > 0 && (
          <details className="border-t border-line pt-3 text-sm">
            <summary className="cursor-pointer font-semibold">Atendidos ({done.length})</summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {done.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span>{(r.client_id && clientName.get(r.client_id)) || "Demonstração"} · {CHANNEL[r.channel] ?? r.channel}</span>
                  <span className="text-xs text-muted">
                    atendido {r.executed_at ? relativeTime(r.executed_at) : ""} · {r.summary?.conversas ?? 0} conversa(s), {r.summary?.leads ?? 0} lead(s), {r.summary?.contatos ?? 0} ficha(s)
                    {r.origin === "chat" ? (r.contact_notified_at ? " · contato avisado" : " · janela fechada, contato não avisado") : ""}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
