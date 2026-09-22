import Link from "next/link";
import { MessageCircle, Trash2 } from "lucide-react";
import { relativeTime } from "@/lib/utils";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { deleteLead } from "@/app/painel/actions";

export interface LeadRow {
  id: string;
  bot_id: string;
  conversation_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  created_at: string;
}

interface Props {
  leads: LeadRow[];
  /** Rótulo da coluna de origem (cliente na lista geral, chatbot no painel do cliente). */
  originLabel: string;
  originOf: (botId: string) => string;
  empty: string;
}

/** Tabela de leads (lista geral e painel do cliente). */
export function LeadList({ leads, originLabel, originOf, empty }: Props) {
  return (
    <div className="card overflow-hidden">
      <div className="hidden grid-cols-[1.1fr_1.3fr_1.3fr_2.2fr_auto] gap-3 border-b border-line bg-ground px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.06em] text-muted lg:grid">
        <span>Quando</span><span>{originLabel}</span><span>Nome</span><span>Contato · interesse</span><span className="w-[150px]" />
      </div>
      {leads.length === 0 && <p className="p-5 text-sm text-muted">{empty}</p>}
      {leads.map((l) => (
        <div key={l.id} className="flex flex-col gap-1.5 border-b border-line-2 px-4 py-3 text-sm last:border-0 lg:grid lg:grid-cols-[1.1fr_1.3fr_1.3fr_2.2fr_auto] lg:items-center lg:gap-3">
          <span className="order-2 text-xs text-muted lg:order-none lg:text-sm" title={new Date(l.created_at).toLocaleString("pt-BR")}>{relativeTime(l.created_at)}<span className="lg:hidden"> · {originOf(l.bot_id)}</span></span>
          <span className="hidden truncate lg:inline">{originOf(l.bot_id)}</span>
          <span className="order-1 truncate font-semibold lg:order-none">{l.name ?? <span className="font-normal text-muted">sem nome</span>}</span>
          <span className="order-3 min-w-0 leading-tight lg:order-none">
            <span className="block truncate">{[l.phone, l.email].filter(Boolean).join(" · ") || <span className="text-muted">sem contato</span>}</span>
            {l.notes && <span className="block truncate text-xs text-muted">{l.notes}</span>}
          </span>
          <span className="order-4 flex items-center gap-3 pt-1 text-[13px] font-semibold lg:order-none lg:w-[150px] lg:justify-end lg:pt-0">
            {l.phone && <a href={`https://wa.me/${l.phone.replace(/\D/g, "")}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-brand hover:underline"><MessageCircle size={14} />WhatsApp</a>}
            {l.conversation_id && <Link href={`/painel/bots/${l.bot_id}/conversas/${l.conversation_id}`} className="text-muted hover:underline">Conversa</Link>}
            <ConfirmAction
              action={deleteLead.bind(null, l.id)}
              title="Excluir este lead?"
              description={<>O contato de <strong className="text-ink">{l.name ?? "visitante"}</strong> sai da lista. A conversa continua salva.</>}
              confirmLabel="Excluir"
              className="btn-icon ml-auto lg:ml-0"
            >
              <Trash2 size={15} />
              <span className="sr-only">Excluir lead</span>
            </ConfirmAction>
          </span>
        </div>
      ))}
    </div>
  );
}
