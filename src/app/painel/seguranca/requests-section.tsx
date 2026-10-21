import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/utils";
import { DSR_DAYS, dueDateBR } from "@/lib/data-subject";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { confirmDataSubjectRequest, refuseDataSubjectRequest } from "../actions";

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
  status: "aguardando" | "executado" | "recusado";
  requested_at: string;
  due_at: string;
  executed_at: string | null;
  refused_at: string | null;
  refuse_reason: string | null;
  contact_notified_at: string | null;
  summary: { conversas?: number; leads?: number; contatos?: number } | null;
}

/**
 * Pedidos do titular: a agência confirma como operadora, em nome do negócio (o controlador); a
 * rotina apaga e avisa o contato.
 */
export async function RequestsSection() {
  const supabase = await createClient();
  const [{ data }, { data: clients }, { data: bots }] = await Promise.all([
    supabase.from("data_subject_requests").select("id, client_id, bot_id, conversation_id, channel, origin, status, requested_at, due_at, executed_at, refused_at, refuse_reason, contact_notified_at, summary").order("requested_at", { ascending: false }).limit(100),
    supabase.from("clients").select("id, name"),
    supabase.from("bots").select("id, name"),
  ]);
  const rows = (data ?? []) as Row[];
  const clientName = new Map((clients ?? []).map((c) => [c.id as string, c.name as string]));
  const botName = new Map((bots ?? []).map((b) => [b.id as string, b.name as string]));
  const pending = rows.filter((r) => r.status === "aguardando");
  const done = rows.filter((r) => r.status !== "aguardando");

  return (
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
                  <div className="flex flex-wrap items-center gap-2">
                    <ConfirmAction
                      action={confirmDataSubjectRequest.bind(null, r.id)}
                      title="Apagar os dados deste contato?"
                      description="Saem as conversas dele neste assistente (com as mensagens), a ficha do contato, os leads, as perguntas e a resposta de 18+. O número entra na lista de quem não recebe mensagens da empresa. Não tem desfazer."
                      confirmLabel="Apagar os dados"
                      className="btn-primary py-1.5 text-xs"
                    >
                      Confirmar e apagar
                    </ConfirmAction>
                  </div>
                  <details className="w-full text-xs">
                    <summary className="cursor-pointer text-muted hover:text-ink">Recusar com motivo</summary>
                    <ActionForm action={refuseDataSubjectRequest.bind(null, r.id)} className="mt-2 flex flex-col gap-2">
                      <textarea name="reason" required minLength={10} maxLength={500} rows={2} className="input text-sm" placeholder="Ex.: as notas fiscais ficam guardadas por 5 anos por obrigação legal; o resto foi apagado no atendimento." />
                      <p className="text-muted">A LGPD admite manter dados por obrigação legal ou para exercer direitos, sempre com o motivo. Ele vai para a pessoa pelo canal (dentro das 24 horas) e fica registrado.</p>
                      <SubmitButton className="btn-ghost self-start py-1.5 text-xs" pendingLabel="Recusando…">Recusar o pedido</SubmitButton>
                    </ActionForm>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
        {done.length > 0 && (
          <details className="border-t border-line pt-3 text-sm">
            <summary className="cursor-pointer font-semibold">Atendidos e recusados ({done.length})</summary>
            <ul className="mt-2 flex flex-col gap-1.5">
              {done.map((r) => (
                <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span>{(r.client_id && clientName.get(r.client_id)) || "Demonstração"} · {CHANNEL[r.channel] ?? r.channel}</span>
                  {r.status === "recusado" ? (
                    <span className="text-xs text-muted">
                      recusado {r.refused_at ? relativeTime(r.refused_at) : ""} · {r.refuse_reason}
                      {r.contact_notified_at ? " · contato avisado" : " · contato não avisado pelo canal"}
                    </span>
                  ) : (
                    <span className="text-xs text-muted">
                      atendido {r.executed_at ? relativeTime(r.executed_at) : ""} · {r.summary?.conversas ?? 0} conversa(s), {r.summary?.leads ?? 0} lead(s), {r.summary?.contatos ?? 0} ficha(s)
                      {r.origin !== "chat" ? "" : r.contact_notified_at ? " · contato avisado" : r.channel === "widget" ? " · pelo site (a pessoa viu o prazo no pedido)" : " · janela de 24 h fechada, contato não avisado"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
  );
}
