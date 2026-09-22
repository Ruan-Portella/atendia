import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { appUrl, initials, relativeTime } from "@/lib/utils";
import { brl } from "@/lib/plans";
import { Status } from "@/components/status";
import { SourcesManager, type SourceItem } from "@/components/sources-manager";
import { ChatWindow } from "@/components/chat-window";
import { CopyButton } from "@/components/copy-button";
import { convertDemo, deleteBot, resolveUnanswered, setBotStatus, updateBot } from "../../actions";

export const metadata = { title: "Editor do chatbot" };

const TABS = [
  ["fontes", "Base de conhecimento"],
  ["personalidade", "Personalidade"],
  ["aparencia", "Aparência e marca"],
  ["leads", "Captura de leads"],
  ["conversas", "Conversas"],
  ["instalacao", "Instalação"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function BotEditorPage({ params, searchParams }: PageProps<"/painel/bots/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = (TABS.some(([t]) => t === sp.tab) ? sp.tab : "fontes") as Tab;
  const { agency } = await requireAgency();
  const supabase = await createClient();

  const { data: bot } = await supabase.from("bots").select("*").eq("id", id).maybeSingle();
  if (!bot) notFound();

  const [{ data: sources }, { data: unanswered }, { data: conversations }, { count: leadCount }] = await Promise.all([
    supabase.from("sources").select("id, kind, title, url, status, chunk_count, pages, error, updated_at").eq("bot_id", id).order("created_at"),
    supabase.from("unanswered").select("id, question, created_at").eq("bot_id", id).eq("resolved", false).order("created_at", { ascending: false }).limit(10),
    tab === "conversas" ? supabase.from("conversations").select("id, started_at, message_count, needs_human, channel").eq("bot_id", id).order("last_message_at", { ascending: false }).limit(30) : Promise.resolve({ data: null }),
    supabase.from("leads").select("id", { count: "exact", head: true }).eq("bot_id", id),
  ]);

  const persona = bot.persona ?? {};
  const appearance = bot.appearance ?? {};
  const leadCapture = bot.lead_capture ?? {};
  const color = appearance.color ?? agency.brand_color;
  const demoUrl = bot.is_demo && bot.demo_slug ? appUrl(`/demo/${bot.demo_slug}`) : null;
  const embedSnippet = `<script src="${appUrl("/widget.js")}" data-key="${bot.public_key}" async></script>`;
  const readySources = (sources ?? []).filter((s) => s.status === "ready").length;

  return (
    <div className="-mx-5 -my-7 flex min-h-full flex-col md:-mx-9">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-panel px-5 py-3.5 md:px-7">
        <Link href="/painel" className="text-sm font-semibold text-muted">← Chatbots</Link>
        <span className="text-line">/</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: color }}>{appearance.avatar_text ?? initials(bot.client_name)}</span>
        <span className="display text-lg font-bold">{bot.name} · {bot.client_name}</span>
        <Status status={bot.is_demo ? "demo" : bot.status} />
        <div className="ml-auto flex flex-wrap gap-2">
          {demoUrl && <CopyButton text={demoUrl} label="Copiar link da demo" />}
          {!bot.is_demo && <CopyButton text={embedSnippet} label="Copiar código de instalação" />}
          {!bot.is_demo && (
            <form action={setBotStatus.bind(null, id, bot.status === "live" ? "draft" : "live")}>
              <button type="submit" className={bot.status === "live" ? "btn-ghost" : "btn-primary"} disabled={readySources === 0 && bot.status !== "live"} title={readySources === 0 ? "Adicione pelo menos uma fonte" : ""}>
                {bot.status === "live" ? "Tirar do ar" : "Publicar"}
              </button>
            </form>
          )}
        </div>
      </div>

      {bot.is_demo && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-amber-soft px-5 py-3 text-sm md:px-7">
          <span className="font-semibold text-amber-ink">Esta é uma demo.</span>
          <span className="text-ink-2">Mande o link para o prospect{bot.demo_views > 0 ? ` (aberto ${bot.demo_views} ${bot.demo_views === 1 ? "vez" : "vezes"})` : ""}. Quando ele fechar, converta em chatbot pago; a base de conhecimento fica.</span>
          <form action={convertDemo.bind(null, id)} className="ml-auto flex items-center gap-2">
            <label htmlFor="price" className="sr-only">Preço mensal</label>
            <input id="price" name="price" type="number" min={0} step={10} placeholder="R$/mês" className="input w-28 py-1.5" />
            <button type="submit" className="btn-dark py-1.5">Converter em cliente</button>
          </form>
        </div>
      )}

      <div className="grid flex-1 md:grid-cols-[220px_minmax(0,1fr)_400px]">
        <nav className="flex flex-row flex-wrap gap-1 border-b border-line p-3.5 md:flex-col md:border-b-0 md:border-r">
          {TABS.map(([key, label]) => (
            <Link key={key} href={`/painel/bots/${id}?tab=${key}`} className={`rounded-lg px-3 py-2.5 text-sm ${tab === key ? "bg-brand-soft font-semibold text-brand" : "font-medium text-ink-2 hover:bg-ground"}`}>
              {label}
            </Link>
          ))}
          <form action={deleteBot.bind(null, id)} className="mt-auto pt-4">
            <button type="submit" className="px-3 text-xs text-danger">Excluir chatbot</button>
          </form>
        </nav>

        <section className="flex flex-col gap-5 px-5 py-6 md:px-7">
          {tab === "fontes" && (
            <>
              <div>
                <h2 className="text-[22px] font-bold">Base de conhecimento</h2>
                <p className="text-sm text-muted">Tudo que {bot.name} sabe vem daqui. Ele não inventa o que não está nas fontes.</p>
              </div>
              <SourcesManager botId={id} sources={(sources ?? []) as SourceItem[]} />
              {unanswered && unanswered.length > 0 && (
                <div className="flex flex-col gap-2.5 rounded-xl border border-[#efd9a9] bg-amber-soft px-[18px] py-4">
                  <div className="text-sm font-semibold text-amber-ink">{unanswered.length} pergunta{unanswered.length > 1 ? "s" : ""} que {bot.name} não soube responder</div>
                  {unanswered.map((u) => (
                    <div key={u.id} className="flex items-center justify-between gap-3 text-sm text-ink-2">
                      <span>“{u.question}”</span>
                      <form action={resolveUnanswered.bind(null, u.id, id)}><button type="submit" className="text-xs font-semibold text-brand">Resolvido</button></form>
                    </div>
                  ))}
                  <p className="text-xs text-muted">Responda adicionando um texto ou FAQ acima; depois marque como resolvido.</p>
                </div>
              )}
            </>
          )}

          {tab === "personalidade" && (
            <form action={updateBot.bind(null, id)} className="flex max-w-[640px] flex-col gap-4">
              <div><h2 className="text-[22px] font-bold">Personalidade</h2><p className="text-sm text-muted">Como o assistente se apresenta e fala.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="name" className="label">Nome do assistente</label><input id="name" name="name" defaultValue={bot.name} className="input" /></div>
                <div><label htmlFor="client_name" className="label">Nome do cliente</label><input id="client_name" name="client_name" defaultValue={bot.client_name} className="input" /></div>
              </div>
              <div><label htmlFor="client_site" className="label">Site do cliente</label><input id="client_site" name="client_site" defaultValue={bot.client_site ?? ""} className="input" /></div>
              <div><label htmlFor="tone" className="label">Tom de voz</label><input id="tone" name="tone" defaultValue={persona.tone ?? "amigável, direto e profissional"} className="input" /></div>
              <div><label htmlFor="welcome" className="label">Mensagem de boas-vindas</label><input id="welcome" name="welcome" defaultValue={persona.welcome ?? ""} className="input" /></div>
              <div><label htmlFor="instructions" className="label">Instruções extras (o que sempre dizer, o que nunca dizer)</label><textarea id="instructions" name="instructions" rows={5} defaultValue={persona.instructions ?? ""} className="input" placeholder="Ex.: Sempre ofereça a avaliação gratuita. Nunca prometa desconto." /></div>
              <div><label htmlFor="price" className="label">Quanto você cobra do cliente (R$/mês, só para o seu painel)</label><input id="price" name="price" type="number" step={10} defaultValue={bot.price_cents ? bot.price_cents / 100 : ""} className="input max-w-[200px]" /></div>
              <button type="submit" className="btn-primary self-start">Salvar</button>
            </form>
          )}

          {tab === "aparencia" && (
            <form action={updateBot.bind(null, id)} className="flex max-w-[640px] flex-col gap-4">
              <div><h2 className="text-[22px] font-bold">Aparência e marca</h2><p className="text-sm text-muted">O visitante vê a marca do cliente no chat e a sua agência no rodapé. A {process.env.NEXT_PUBLIC_BRAND_NAME ?? "Atendia"} nunca aparece.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="color" className="label">Cor principal</label><input id="color" name="color" type="color" defaultValue={color} className="input h-11 p-1" /></div>
                <div><label htmlFor="avatar_text" className="label">Iniciais do avatar</label><input id="avatar_text" name="avatar_text" maxLength={2} defaultValue={appearance.avatar_text ?? initials(bot.client_name)} className="input" /></div>
              </div>
              <div><label htmlFor="suggested" className="label">Perguntas sugeridas (uma por linha, até 6)</label><textarea id="suggested" name="suggested" rows={4} defaultValue={(appearance.suggested_questions ?? []).join("\n")} className="input" /></div>
              <button type="submit" className="btn-primary self-start">Salvar</button>
            </form>
          )}

          {tab === "leads" && (
            <form action={updateBot.bind(null, id)} className="flex max-w-[640px] flex-col gap-4">
              <div><h2 className="text-[22px] font-bold">Captura de leads</h2><p className="text-sm text-muted">Quando o visitante quer agendar, orçar ou falar com alguém, o assistente pede nome e contato. {leadCount ?? 0} leads até agora.</p></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="lead_enabled" defaultChecked={leadCapture.enabled !== false} /> Ativar captura de leads na conversa</label>
              <div><label htmlFor="notify_email" className="label">Avisar por e-mail (o dono do cliente, por exemplo)</label><input id="notify_email" name="notify_email" type="email" defaultValue={leadCapture.notify_email ?? ""} className="input" placeholder="recepcao@clinicasorriso.com.br" /></div>
              <div><label htmlFor="notify_whatsapp" className="label">WhatsApp para aviso (em breve)</label><input id="notify_whatsapp" name="notify_whatsapp" defaultValue={leadCapture.notify_whatsapp ?? ""} className="input" placeholder="+55 41 9…" /></div>
              <p className="text-xs text-muted">Você também recebe todos os leads no seu e-mail e na aba Leads do painel.</p>
              <button type="submit" className="btn-primary self-start">Salvar</button>
            </form>
          )}

          {tab === "conversas" && (
            <>
              <div><h2 className="text-[22px] font-bold">Conversas</h2><p className="text-sm text-muted">Últimas 30. Marcadas as que pediram um humano.</p></div>
              <div className="card overflow-hidden">
                {(conversations ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhuma conversa ainda.</p>}
                {(conversations ?? []).map((c) => (
                  <Link key={c.id} href={`/painel/bots/${id}/conversas/${c.id}`} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 text-sm last:border-0 hover:bg-ground">
                    <span className="text-muted">{relativeTime(c.started_at)}</span>
                    <span className="font-medium">{c.message_count} mensagens</span>
                    <span className="text-xs text-muted">{c.channel}</span>
                    {c.needs_human && <span className="ml-auto rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber-ink">pediu atendente</span>}
                  </Link>
                ))}
              </div>
            </>
          )}

          {tab === "instalacao" && (
            <div className="flex max-w-[720px] flex-col gap-5">
              <div><h2 className="text-[22px] font-bold">Instalação</h2><p className="text-sm text-muted">Cole antes do <code>&lt;/body&gt;</code> do site do cliente. Funciona em WordPress, Webflow, Framer, Wix, Shopify e HTML puro.</p></div>
              <pre className="overflow-auto rounded-xl bg-ink p-4 text-[13px] text-ground">{embedSnippet}</pre>
              <div className="flex gap-2"><CopyButton text={embedSnippet} label="Copiar código" className="btn-primary" /></div>
              <div className="card p-5 text-sm leading-relaxed text-ink-2">
                <p><strong>WordPress:</strong> Aparência → Editor de temas → footer.php, ou o plugin “Insert Headers and Footers”.</p>
                <p className="mt-2"><strong>Webflow / Framer:</strong> Configurações do site → Custom code → Footer.</p>
                <p className="mt-2"><strong>Wix / Shopify:</strong> Configurações → Código personalizado (Wix) ou theme.liquid (Shopify).</p>
                <p className="mt-2"><strong>Link direto</strong> (para Instagram ou WhatsApp): <code className="rounded bg-ground px-1">{appUrl(`/w/${bot.public_key}`)}</code></p>
              </div>
              {bot.status !== "live" && !bot.is_demo && <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">O chatbot ainda não está publicado. Clique em “Publicar” no topo para ele responder no site.</p>}
            </div>
          )}
        </section>

        <aside className="flex flex-col gap-3 border-t border-line bg-[#ecebe4] p-5 md:border-l md:border-t-0">
          <div className="flex items-center justify-between text-xs"><span className="font-semibold uppercase tracking-[0.06em] text-muted">Teste ao vivo</span><span className="text-muted">como o visitante vê</span></div>
          <div className="h-[560px] overflow-hidden rounded-2xl shadow-[0_12px_32px_rgba(27,31,29,0.12)]">
            {readySources > 0 ? (
              <ChatWindow
                channel="painel"
                bot={{ key: bot.public_key, name: bot.name, clientName: bot.client_name, color, avatarText: appearance.avatar_text ?? initials(bot.client_name), welcome: persona.welcome ?? `Olá! Sou ${bot.name}. Como posso ajudar?`, suggestedQuestions: appearance.suggested_questions ?? [], poweredBy: agency.name }}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-white p-6 text-center text-sm text-muted">Adicione uma fonte para testar o assistente.</div>
            )}
          </div>
          {bot.price_cents ? <p className="text-xs text-muted">Você cobra {brl(bot.price_cents / 100)}/mês deste cliente.</p> : null}
        </aside>
      </div>
    </div>
  );
}
