import { Bot, CalendarCheck, Inbox, Megaphone, Settings, Sparkles, Users } from "lucide-react";
import { ContactAvatar } from "@/components/contact-avatar";
import { TICKER } from "@/lib/landing";

const CONVERSATIONS = [
  { name: "Ana Souza", channel: "whatsapp", text: "Quero marcar uma avaliação", time: "10:42", unread: true, active: true },
  { name: "Bruno Lima", channel: "instagram", text: "Vocês têm horário amanhã?", time: "10:31", unread: true },
  { name: "Carla Mendes", channel: "widget", text: "Aceita convênio?", time: "10:18" },
  { name: "Diego Rocha", channel: "whatsapp", text: "Obrigado! Até sábado 👍", time: "09:55" },
  { name: "Elisa Prado", channel: "instagram", text: "Qual o valor da limpeza?", time: "09:40" },
];

/**
 * O painel na landing (24/10/2026): a Caixa de entrada com os três canais, uma conversa aberta com
 * a IA agendando e o lead ao lado, como no produto. Desenho estático, com os componentes do painel.
 */
export function InboxMockup({ business }: { business: boolean }) {
  return (
    <div className="relative">
      <div className="overflow-hidden rounded-[22px] border border-line bg-panel shadow-[var(--shadow-pop)]">
        <div className="flex items-center gap-2 border-b border-line bg-raised/60 px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="mx-auto truncate rounded-md bg-panel px-3 py-0.5 font-mono text-[11px] text-muted">{business ? "boavoz.com/painel/caixa" : "app.suaagencia.com.br/painel/caixa"}</span>
        </div>
        <div className="grid min-h-[380px] grid-cols-1 md:grid-cols-[56px_260px_minmax(0,1fr)] lg:grid-cols-[56px_280px_minmax(0,1fr)_240px]">
          <nav className="hidden flex-col items-center gap-4 border-r border-line py-4 text-muted md:flex" aria-hidden>
            <Inbox size={18} className="text-brand" />
            <Users size={18} />
            <Bot size={18} />
            <Megaphone size={18} />
            <Settings size={18} className="mt-auto" />
          </nav>
          <div className="hidden flex-col border-r border-line md:flex">
            <div className="flex items-center justify-between px-4 py-3">
              <span className="display text-[15px] font-bold">Caixa de entrada</span>
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">2 novas</span>
            </div>
            {CONVERSATIONS.map((c) => (
              <div key={c.name} className={c.active ? "flex items-center gap-3 border-l-2 border-brand bg-brand-soft/60 px-4 py-2.5" : "flex items-center gap-3 border-l-2 border-transparent px-4 py-2.5"}>
                <ContactAvatar name={c.name} channel={c.channel} size={34} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className={c.unread ? "truncate text-[13px] font-semibold" : "truncate text-[13px] font-medium"}>{c.name}</span>
                    <span className="shrink-0 text-[11px] text-muted">{c.time}</span>
                  </div>
                  <div className="truncate text-xs text-muted">{c.text}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-3 border-b border-line px-4 py-3">
              <ContactAvatar name="Ana Souza" channel="whatsapp" size={32} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">Ana Souza</div>
                <div className="text-xs text-muted">WhatsApp · {business ? "Studio Bella" : "Clínica Sorriso"}</div>
              </div>
              <span className="ml-auto flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand"><Sparkles size={12} />IA atendendo</span>
            </div>
            <div className="flex flex-1 flex-col gap-2 bg-ground px-4 py-4 text-[13px] leading-relaxed">
              <div className="max-w-[78%] self-start rounded-[14px_14px_14px_4px] border border-line bg-panel px-3 py-2">Oi! Quero marcar uma avaliação. Vocês têm horário no sábado?</div>
              <div className="max-w-[82%] self-end rounded-[14px_14px_4px_14px] bg-brand px-3 py-2 text-on-brand">Temos sim, Ana! Sábado às 9h ou às 10h30. Qual fica melhor para você?</div>
              <div className="max-w-[78%] self-start rounded-[14px_14px_14px_4px] border border-line bg-panel px-3 py-2">10h30 😊</div>
              <div className="max-w-[82%] self-end rounded-[14px_14px_4px_14px] bg-brand px-3 py-2 text-on-brand">Pronto! Sábado, 10h30, avaliação gratuita. Te mando um lembrete na sexta. Até lá!</div>
              <div className="mt-1 flex items-center gap-1.5 self-center rounded-full bg-raised px-3 py-1 text-[11px] text-muted">
                <CalendarCheck size={12} className="text-brand" />Roteiro de agendamento concluído
              </div>
            </div>
          </div>
          <aside className="hidden flex-col gap-3 border-l border-line p-4 lg:flex">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Contato</span>
            <div className="flex items-center gap-2.5">
              <ContactAvatar name="Ana Souza" channel="whatsapp" size={40} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">Ana Souza</div>
                <div className="text-xs text-muted">(21) 9••••-1234</div>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-ground p-3 text-xs">
              <span className="font-semibold">Lead</span>
              <span className="text-muted">Avaliação · sábado, 10h30</span>
              <span className="text-muted">Primeira conversa · veio do Instagram</span>
            </div>
            <div className="flex flex-col gap-1.5 rounded-xl border border-line bg-ground p-3 text-xs">
              <span className="font-semibold">Régua</span>
              <span className="text-muted">Lembrete da consulta na sexta, 18h</span>
            </div>
            <div className="mt-auto flex flex-wrap gap-1.5">
              {["avaliação", "novo"].map((t) => (
                <span key={t} className="rounded-full bg-raised px-2 py-0.5 text-[11px] text-ink-2">{t}</span>
              ))}
            </div>
          </aside>
        </div>
      </div>
      {/* um dia de atendimento, correndo embaixo do painel */}
      <div className="mt-5 overflow-hidden [mask-image:linear-gradient(90deg,transparent,#000_8%,#000_92%,transparent)]" aria-hidden>
        <div className="landing-marquee flex w-max gap-3">
          {[...TICKER, ...TICKER].map((t, i) => (
            <span key={i} className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-panel px-3.5 py-1.5 text-[13px] text-ink-2">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
