import Link from "next/link";
import { ArrowDown, MessagesSquare } from "lucide-react";
import { CONVERSATION_FILTERS, loadConversationList, type ConversationFilter } from "@/lib/conversation-list";
import type { InboxBot } from "@/lib/inbox";
import type { SupabaseClient } from "@supabase/supabase-js";
import { waitLabel } from "@/lib/inbox";
import { cn } from "@/lib/utils";
import { BotFace } from "@/components/bot-face";
import { ContactAvatar } from "@/components/contact-avatar";
import { StatusPill } from "@/components/inbox-view";
import { AgencyConversation } from "@/components/agency-conversation";

const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", instagram: "Instagram", widget: "Site", painel: "Teste", demo: "Demo" };
const FROM: Record<string, string> = { ia: "IA: ", equipe: "Equipe: ", contato: "" };

/**
 * As abas Conversas do cliente e do chatbot no jeito da Caixa de entrada (23/10/2026, a pedido do
 * usuário): a lista à esquerda (a pessoa, o começo da última mensagem, a situação e o chatbot), com
 * os filtros no alto, e a conversa aberta ao lado. No celular, a lista ocupa a tela e a conversa
 * abre no lugar dela, com a seta para voltar. O endereço guarda o filtro (`f`), quantas carregar
 * (`n`) e a conversa aberta (`c`). No cliente com setores, uma segunda linha filtra pelo setor
 * (rodada 2 das telas, 23/10/2026).
 */
export async function ConversationsBrowser({
  db,
  bots,
  filter,
  limit,
  selectedId,
  hrefFor,
  showBot,
  earlier = 0,
  intro,
  renderConversation,
  sectors = [],
  sector = null,
  heightClass = "h-[calc(100dvh-230px)] min-h-[540px] max-md:h-[calc(100dvh-170px)]",
}: {
  db: SupabaseClient;
  bots: InboxBot[];
  filter: ConversationFilter;
  limit: number;
  selectedId: string | null;
  /** o endereço desta aba com o filtro, quantas e a conversa aberta */
  hrefFor: (o: { filter?: ConversationFilter; limit?: number; conversationId?: string | null; earlier?: number; sector?: string | null }) => string;
  /** o nome do chatbot em cada linha (no cliente, que tem mais de um) */
  showBot: boolean;
  earlier?: number;
  /** o que vai em cima da lista (o "+ Nova conversa" do WhatsApp, por exemplo) */
  intro?: React.ReactNode;
  /** a conversa aberta (padrão: a do painel; a área do cliente passa a dela) */
  renderConversation?: (o: { botId: string; convId: string; back: string; mobileBack: string; earlier: number; earlierHref: (n: number) => string }) => React.ReactNode;
  /** os setores do cliente (o filtro só aparece com algum) e o escolhido */
  sectors?: Array<{ id: string; name: string }>;
  sector?: string | null;
  /** a altura do cartão (a área do cliente tem outro topo) */
  heightClass?: string;
}) {
  const { items, more } = await loadConversationList(db, { bots, filter, limit, sectorId: sector });
  const selected = selectedId ? (items.find((i) => i.id === selectedId) ?? null) : null;
  // a conversa aberta pode estar fora da página carregada (veio de um link): o chatbot dela precisa estar na lista
  const openBot = selected?.botId ?? (selectedId ? (await db.from("conversations").select("bot_id").eq("id", selectedId).in("bot_id", bots.map((b) => b.id)).maybeSingle()).data?.bot_id : null);

  return (
    <div className={cn("card relative flex overflow-hidden", heightClass)}>
      <section className={cn("flex w-full min-w-0 flex-col md:w-[340px] md:shrink-0 md:border-r md:border-line", selectedId && openBot && "hidden md:flex")}>
        <div className="flex flex-col gap-2.5 border-b border-line-2 px-3 py-3">
          {intro}
          <nav aria-label="Filtro das conversas" className="flex flex-wrap gap-1">
            {CONVERSATION_FILTERS.map((f) => (
              <Link
                key={f.key}
                href={hrefFor({ filter: f.key, limit: 40, conversationId: selectedId, sector })}
                scroll={false}
                aria-current={f.key === filter ? "page" : undefined}
                className={cn("rounded-full px-2.5 py-1 text-[12.5px] transition-colors duration-[120ms]", f.key === filter ? "bg-ink font-medium text-ground" : "bg-raised/70 text-ink-2 hover:bg-raised hover:text-ink")}
              >
                {f.label}
              </Link>
            ))}
          </nav>
          {sectors.length > 0 && (
            <nav aria-label="Setor" className="flex flex-wrap items-center gap-1">
              <span className="mr-0.5 text-[11.5px] text-muted">Setor</span>
              {[{ id: null, name: "Todos" }, ...sectors].map((s) => (
                <Link
                  key={s.id ?? "todos"}
                  href={hrefFor({ filter, limit: 40, conversationId: selectedId, sector: s.id })}
                  scroll={false}
                  aria-current={s.id === sector ? "page" : undefined}
                  className={cn("rounded-full px-2.5 py-0.5 text-[12px] transition-colors duration-[120ms]", s.id === sector ? "bg-brand-soft font-medium text-brand shadow-[inset_0_0_0_1px_var(--color-brand)]" : "text-ink-2 shadow-[inset_0_0_0_1px_var(--color-line)] hover:text-ink")}
                >
                  {s.name}
                </Link>
              ))}
            </nav>
          )}
        </div>
        <ul className="relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {items.length === 0 && (
            <li className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-raised">
                <MessagesSquare size={18} />
              </span>
              {filter === "todas" && !sector ? "Nenhuma conversa ainda." : "Nenhuma conversa neste filtro."}
            </li>
          )}
          {items.map((i) => {
            const name = i.contact ?? (i.channel === "widget" ? "Visitante do site" : "Contato");
            const on = i.id === selectedId;
            return (
              <li key={i.id}>
                <Link
                  href={hrefFor({ filter, limit, conversationId: i.id, sector })}
                  scroll={false}
                  aria-current={on ? "true" : undefined}
                  className={cn("flex gap-3 rounded-[14px] px-2.5 py-2.5 transition-colors duration-[120ms]", on ? "bg-raised shadow-[inset_0_0_0_1px_var(--color-line-strong)]" : "hover:bg-raised/60")}
                >
                  <ContactAvatar name={name} photo={i.photo} channel={i.channel} size={36} className="mt-0.5" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{name}</span>
                      <span className="shrink-0 font-mono text-[11px] text-muted tabular">{waitLabel(i.lastAt)}</span>
                    </span>
                    {i.last ? (
                      <span className="truncate text-[13px] text-ink-2">
                        <span className="text-muted">{FROM[i.last.from]}</span>
                        {i.last.text || "foto ou arquivo"}
                      </span>
                    ) : (
                      <span className="truncate text-[13px] text-muted">{i.messages} mensagens</span>
                    )}
                    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusPill status={i.status} />
                      <span className="inline-flex min-w-0 items-center gap-1 text-[11.5px] text-muted">
                        {showBot && <BotFace color={i.botColor} face={i.botFace} size={14} className="shrink-0" />}
                        <span className="truncate">{showBot ? `${i.botName} · ` : ""}{CHANNEL[i.channel] ?? i.channel}</span>
                      </span>
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
          {more && (
            <li className="flex justify-center py-2">
              <Link href={hrefFor({ filter, limit: limit + 40, conversationId: selectedId, sector })} scroll={false} className="btn-ghost py-1.5 text-[13px]">
                <ArrowDown size={14} />
                Carregar mais
              </Link>
            </li>
          )}
        </ul>
      </section>

      <div className={cn("min-w-0 flex-1 flex-col bg-ground", selectedId && openBot ? "flex" : "hidden md:flex")}>
        {selectedId && openBot ? (
          (renderConversation ?? ((o) => <AgencyConversation botId={o.botId} convId={o.convId} embedded back={o.back} mobileBack={o.mobileBack} earlier={o.earlier} earlierHref={o.earlierHref} />))({
            botId: openBot as string,
            convId: selectedId,
            back: hrefFor({ filter, limit, conversationId: selectedId, sector }),
            mobileBack: hrefFor({ filter, limit, conversationId: null, sector }),
            earlier,
            earlierHref: (n) => hrefFor({ filter, limit, conversationId: selectedId, earlier: n, sector }),
          })
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center text-sm text-muted">
            <span className="flex h-12 w-12 items-center justify-center rounded-[16px] bg-raised">
              <MessagesSquare size={20} />
            </span>
            Escolha uma conversa da lista para ler e responder aqui.
          </div>
        )}
      </div>
    </div>
  );
}
