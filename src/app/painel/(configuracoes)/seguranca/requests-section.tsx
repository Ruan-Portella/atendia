import Link from "next/link";
import { ChevronDown, UserX } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { relativeTime } from "@/lib/utils";
import { DSR_DAYS, dueDateBR } from "@/lib/data-subject";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { DialogButton } from "@/components/ui/setting-row";
import { HowItWorks, StatusPill } from "@/components/ui/form-section";
import { confirmDataSubjectRequest, refuseDataSubjectRequest } from "@/app/painel/actions";

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
 * rotina apaga e avisa o contato. Redesenho, etapa 5: cada pedido numa linha com o prazo em pílula,
 * o Confirmar e apagar e o Recusar num modal com o motivo.
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
  const whose = (r: Row) => `${(r.client_id && clientName.get(r.client_id)) || "Demonstração"}${r.bot_id && botName.get(r.bot_id) ? ` · ${botName.get(r.bot_id)}` : ""}`;

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-muted">O contato pede pelo chat (&ldquo;apaga meus dados&rdquo;) e confirma; você confirma aqui, em nome do negócio. A LGPD dá {DSR_DAYS} dias para atender.</p>
        <HowItWorks label="O que acontece ao confirmar">
          <p>
            O BoaVoz apaga as conversas do contato naquele assistente (com as mensagens), a ficha do contato, os leads e o que ele informou, põe o número na lista de quem não recebe mensagens da empresa e avisa a pessoa pelo canal, quando a janela de 24 horas
            ainda está aberta. Não tem desfazer.
          </p>
          <p>Recusar só cabe com motivo: a LGPD admite manter dados por obrigação legal ou para exercer direitos. O motivo vai para a pessoa pelo canal (dentro das 24 horas) e fica registrado.</p>
        </HowItWorks>
      </div>

      {pending.length === 0 ? (
        <p className="card flex items-center justify-center gap-2 px-5 py-8 text-sm text-muted">
          <UserX size={16} /> Nenhum pedido aguardando.
        </p>
      ) : (
        <ul className="card flex flex-col divide-y divide-line-2 overflow-hidden">
          {pending.map((r) => {
            const late = overdue(r.due_at);
            return (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="text-[15px] font-medium text-ink">{whose(r)}</span>
                    <StatusPill tone={late ? "danger" : "warn"}>{late ? `prazo venceu em ${dueDateBR(r.due_at)}` : `prazo até ${dueDateBR(r.due_at)}`}</StatusPill>
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {CHANNEL[r.channel] ?? r.channel} · pedido {relativeTime(r.requested_at)}
                    {r.conversation_id && r.bot_id ? (
                      <>
                        {" · "}
                        <Link href={`/painel/bots/${r.bot_id}/conversas/${r.conversation_id}`} className="font-medium text-brand hover:underline">
                          ver a conversa
                        </Link>
                      </>
                    ) : null}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2">
                  <DialogButton
                    label="Recusar"
                    className="btn-ghost py-1.5 text-xs"
                    title="Recusar o pedido"
                    description="A LGPD admite manter dados por obrigação legal ou para exercer direitos, sempre com o motivo. Ele vai para a pessoa pelo canal (dentro das 24 horas) e fica registrado."
                    action={refuseDataSubjectRequest.bind(null, r.id)}
                    saveLabel="Recusar o pedido"
                  >
                    <div>
                      <label htmlFor={`reason-${r.id}`} className="label">
                        Motivo
                      </label>
                      <textarea id={`reason-${r.id}`} name="reason" required minLength={10} maxLength={500} rows={3} className="input text-sm" placeholder="Ex.: as notas fiscais ficam guardadas por 5 anos por obrigação legal; o resto foi apagado no atendimento." />
                    </div>
                  </DialogButton>
                  <ConfirmAction
                    action={confirmDataSubjectRequest.bind(null, r.id)}
                    title="Apagar os dados deste contato?"
                    description="Saem as conversas dele neste assistente (com as mensagens), a ficha do contato, os leads, as perguntas e a resposta de 18+. O número entra na lista de quem não recebe mensagens da empresa. Não tem desfazer."
                    confirmLabel="Apagar os dados"
                    className="btn-primary py-1.5 text-xs"
                  >
                    Confirmar e apagar
                  </ConfirmAction>
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {done.length > 0 && (
        <details className="group/done">
          <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-sm font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
            Atendidos e recusados ({done.length})
            <ChevronDown size={14} className="transition-transform duration-[220ms] group-open/done:rotate-180" />
          </summary>
          <ul className="card mt-2 flex flex-col divide-y divide-line-2 overflow-hidden">
            {done.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-sm text-ink">{whose(r)}</span>
                  <StatusPill tone={r.status === "recusado" ? "muted" : "ok"}>{r.status === "recusado" ? "Recusado" : "Atendido"}</StatusPill>
                  <span className="text-xs text-muted">
                    {CHANNEL[r.channel] ?? r.channel} · {r.status === "recusado" ? (r.refused_at ? relativeTime(r.refused_at) : "") : r.executed_at ? relativeTime(r.executed_at) : ""}
                  </span>
                </span>
                {r.status === "recusado" ? (
                  <span className="text-xs text-muted">
                    Motivo: {r.refuse_reason}
                    {r.contact_notified_at ? " · contato avisado" : " · contato não avisado pelo canal"}
                  </span>
                ) : (
                  <span className="text-xs text-muted">
                    Apagados: {r.summary?.conversas ?? 0} conversa(s), {r.summary?.leads ?? 0} lead(s), {r.summary?.contatos ?? 0} ficha(s)
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
