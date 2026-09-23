import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgency } from "@/lib/agency";
import { createClient } from "@/lib/supabase/server";
import { initials, relativeTime } from "@/lib/utils";
import { getClientOptions } from "@/lib/panel";
import { agencyBaseUrl } from "@/lib/domain";
import { embeddedSignupConfig, whatsappAllowed } from "@/lib/whatsapp";
import { WhatsAppConnect } from "@/components/whatsapp-connect";
import { Status } from "@/components/status";
import { SourcesManager, type SourceItem } from "@/components/sources-manager";
import { ChatWindow } from "@/components/chat-window";
import { CopyButton } from "@/components/copy-button";
import { ConvertDemo } from "@/components/convert-demo";
import { InstallGuide } from "@/components/install-guide";
import { ChatPreviewSheet } from "@/components/chat-preview-sheet";
import { WidgetPositionPicker } from "@/components/widget-position";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ClientPicker } from "@/components/client-picker";
import { answerUnanswered, completeWhatsAppSignup, connectWhatsApp, convertDemo, deleteBot, disconnectWhatsApp, resolveUnanswered, setAutoRefresh, setBotStatus, updateBot } from "../../actions";
import { UnansweredItem } from "@/components/unanswered-item";
import { ConversationStateBadge } from "@/components/conversation-state";

export const metadata = { title: "Editor do chatbot" };

const TABS = [
  ["fontes", "Base de conhecimento"],
  ["personalidade", "Personalidade"],
  ["aparencia", "Aparência e marca"],
  ["leads", "Captura de leads"],
  ["conversas", "Conversas"],
  ["whatsapp", "WhatsApp"],
  ["instalacao", "Instalação"],
] as const;
type Tab = (typeof TABS)[number][0];

export default async function BotEditorPage({ params, searchParams }: PageProps<"/painel/bots/[id]">) {
  const [{ id }, sp, { email }] = await Promise.all([params, searchParams, requireAgency()]);
  // WhatsApp em teste: a aba só existe para os e-mails liberados
  const tabs = whatsappAllowed(email) ? TABS : TABS.filter(([t]) => t !== "whatsapp");
  const tab = (tabs.some(([t]) => t === sp.tab) ? sp.tab : "fontes") as Tab;
  const supabase = await createClient();

  // Tudo em paralelo e só o que a aba aberta usa. O texto bruto das fontes (sites e PDFs
  // inteiros) não vem mais: só o de textos/FAQs, que o modal de edição precisa.
  const none = Promise.resolve({ data: null, count: null });
  const [{ agency }, { data: bot }, { count: readySources }, { data: sourceMeta }, { data: sourceTexts }, { data: unanswered }, { data: conversations }, { count: leadCount }, { data: whatsapp }] = await Promise.all([
    requireAgency(),
    supabase.from("bots").select("*").eq("id", id).maybeSingle(),
    supabase.from("sources").select("id", { count: "exact", head: true }).eq("bot_id", id).eq("status", "ready"),
    tab === "fontes" ? supabase.from("sources").select("id, kind, title, url, status, chunk_count, pages, error, refresh_error, created_by, updated_at").eq("bot_id", id).order("created_at") : none,
    tab === "fontes" ? supabase.from("sources").select("id, content").eq("bot_id", id).in("kind", ["text", "faq"]) : none,
    tab === "fontes" ? supabase.from("unanswered").select("id, question, created_at").eq("bot_id", id).eq("resolved", false).order("created_at", { ascending: false }).limit(10) : none,
    tab === "conversas" ? supabase.from("conversations").select("id, started_at, last_message_at, visitor_seen_at, message_count, needs_human, channel, handoff_requested_at, handled_at").eq("bot_id", id).order("last_message_at", { ascending: false }).limit(30) : none,
    tab === "leads" ? supabase.from("leads").select("id", { count: "exact", head: true }).eq("bot_id", id) : none,
    tab === "whatsapp" ? supabase.from("whatsapp_channels").select("phone_number_id, business_id, display_phone, verified_name, created_at").eq("bot_id", id).maybeSingle() : none,
  ]);
  if (!bot) notFound();
  const clients = bot.is_demo || tab === "personalidade" ? await getClientOptions(supabase, agency.id) : [];
  const textOf = new Map(((sourceTexts ?? []) as Array<{ id: string; content: string | null }>).map((t) => [t.id, t.content]));
  const sources: SourceItem[] = ((sourceMeta ?? []) as Array<Omit<SourceItem, "content">>).map((s) => ({ ...s, content: textOf.get(s.id) ?? null }));

  const persona = bot.persona ?? {};
  const appearance = bot.appearance ?? {};
  const leadCapture = bot.lead_capture ?? {};
  const color = appearance.color ?? agency.brand_color;
  // domínio próprio da agência (quando verificado) nos links que o cliente e o prospect veem
  const base = agencyBaseUrl(agency);
  const demoUrl = bot.is_demo && bot.demo_slug ? `${base}/demo/${bot.demo_slug}` : null;
  const signup = embeddedSignupConfig();
  const embedSnippet = `<script src="${base}/widget.js" data-key="${bot.public_key}" async></script>`;

  return (
    <div className="-mx-4 -my-5 flex min-h-full flex-col sm:-mx-6 sm:-my-7 lg:-mx-9">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel px-4 py-3 sm:px-5 md:px-7 md:py-3.5">
        {bot.client_id ? (
          <Link href={`/painel/clientes/${bot.client_id}`} className="max-w-[40vw] truncate text-sm font-semibold text-muted">← {bot.client_name}</Link>
        ) : (
          <Link href={bot.is_demo ? "/painel/demos" : "/painel/clientes"} className="text-sm font-semibold text-muted">← {bot.is_demo ? "Demos" : "Clientes"}</Link>
        )}
        <span className="hidden text-line sm:inline">/</span>
        <span className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white" style={{ background: color }}>{appearance.avatar_text ?? initials(bot.client_name)}</span>
        <span className="display min-w-0 truncate text-base font-bold sm:text-lg">{bot.name} · {bot.client_name}</span>
        <Status status={bot.is_demo ? "demo" : bot.status} />
        <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto">
          {demoUrl && <CopyButton text={demoUrl} label="Copiar link da demo" className="btn-ghost flex-1 sm:flex-none" />}
          {!bot.is_demo && <CopyButton text={embedSnippet} label="Copiar código" className="btn-ghost flex-1 sm:flex-none" />}
          {!bot.is_demo && (
            <ActionForm action={setBotStatus.bind(null, id, bot.status === "live" ? "draft" : "live")}>
              <SubmitButton pendingLabel={bot.status === "live" ? "Tirando do ar…" : "Publicando…"} className={bot.status === "live" ? "btn-ghost" : "btn-primary"} disabled={!readySources && bot.status !== "live"} title={!readySources ? "Adicione pelo menos uma fonte" : ""}>
                {bot.status === "live" ? "Tirar do ar" : "Publicar"}
              </SubmitButton>
            </ActionForm>
          )}
        </div>
      </div>

      {bot.is_demo && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-amber-soft px-4 py-3 text-sm sm:px-5 md:px-7">
          <span className="font-semibold text-amber-ink">Esta é uma demo.</span>
          <span className="text-ink-2">Mande o link para o prospect{bot.demo_views > 0 ? ` (aberto ${bot.demo_views} ${bot.demo_views === 1 ? "vez" : "vezes"})` : ""}. Quando ele fechar, converta em chatbot pago; a base de conhecimento fica.</span>
          <div className="w-full sm:ml-auto sm:w-auto">
            <ConvertDemo action={convertDemo.bind(null, id)} clients={clients} clientName={bot.client_name} assistantName={bot.name} />
          </div>
        </div>
      )}

      <div className="grid flex-1 lg:grid-cols-[200px_minmax(0,1fr)_360px] xl:grid-cols-[220px_minmax(0,1fr)_400px]">
        <nav className="flex flex-row items-center gap-1 overflow-x-auto border-b border-line px-3 py-2 [scrollbar-width:none] lg:flex-col lg:items-stretch lg:overflow-visible lg:border-b-0 lg:border-r lg:p-3.5">
          {tabs.map(([key, label]) => (
            <Link key={key} href={`/painel/bots/${id}?tab=${key}`} className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm lg:py-2.5 ${tab === key ? "bg-brand-soft font-semibold text-brand" : "font-medium text-ink-2 hover:bg-ground"}`}>
              {label}
            </Link>
          ))}
          <div className="ml-auto shrink-0 lg:ml-0 lg:mt-auto lg:pt-4">
            <ConfirmAction
              action={deleteBot.bind(null, id, bot.client_id ? `/painel/clientes/${bot.client_id}` : bot.is_demo ? "/painel/demos" : "/painel/clientes")}
              title={`Excluir ${bot.is_demo ? "esta demo" : "este chatbot"}?`}
              description={
                <>
                  <strong className="text-ink">{bot.name} · {bot.client_name}</strong> será apagado com a base de conhecimento, as conversas e os leads.{bot.status === "live" ? " O balão some do site do cliente na hora, sem precisar mexer no código dele." : ""} Não tem desfazer.
                </>
              }
              confirmLabel="Excluir definitivamente"
              className="px-3 text-xs font-medium text-danger hover:underline"
            >
              Excluir {bot.is_demo ? "demo" : "chatbot"}
            </ConfirmAction>
          </div>
        </nav>

        <section className="flex min-w-0 flex-col gap-5 px-4 py-5 pb-24 sm:px-5 md:px-7 md:py-6 lg:pb-6">
          {tab === "fontes" && (
            <>
              <div>
                <h2 className="text-[22px] font-bold">Base de conhecimento</h2>
                <p className="text-sm text-muted">Tudo que {bot.name} sabe vem daqui. Ele não inventa o que não está nas fontes.</p>
              </div>
              <SourcesManager botId={id} sources={sources} />
              {!bot.is_demo && sources.some((s) => s.kind === "site" || s.kind === "page") && (
                <ActionForm key={String(bot.auto_refresh)} action={setAutoRefresh.bind(null, id)} className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2"><input type="checkbox" name="auto_refresh" defaultChecked={bot.auto_refresh !== false} /> Reler o site do cliente automaticamente toda semana</label>
                  <SubmitButton pendingLabel="Salvando…" className="text-xs font-semibold text-brand hover:underline disabled:opacity-50">Salvar</SubmitButton>
                  <span className="w-full text-xs text-muted">Se nada mudou no site, não gasta nada. Se mudou, o assistente aprende sozinho.</span>
                </ActionForm>
              )}
              {unanswered && unanswered.length > 0 && (
                <div className="flex flex-col gap-2.5 rounded-xl border border-[#efd9a9] bg-amber-soft px-[18px] py-4">
                  <div className="text-sm font-semibold text-amber-ink">{unanswered.length} pergunta{unanswered.length > 1 ? "s" : ""} que {bot.name} não soube responder</div>
                  {unanswered.map((u) => (
                    <UnansweredItem key={u.id} question={u.question} answer={answerUnanswered.bind(null, u.id, id)} dismiss={resolveUnanswered.bind(null, u.id, id)} />
                  ))}
                  <p className="text-xs text-muted">Clique em “Responder” e escreva o que o assistente deve dizer: ele aprende na hora.</p>
                </div>
              )}
            </>
          )}

          {tab === "personalidade" && (
            <ActionForm key={bot.updated_at} action={updateBot.bind(null, id)} className="flex max-w-[640px] flex-col gap-4">
              <div><h2 className="text-[22px] font-bold">Personalidade</h2><p className="text-sm text-muted">Como o assistente se apresenta e fala.</p></div>
              <div><label htmlFor="name" className="label">Nome do assistente</label><input id="name" name="name" required minLength={2} maxLength={40} defaultValue={bot.name} className="input" /></div>
              {!bot.is_demo && <ClientPicker clients={clients} defaultClientId={bot.client_id} suggestedName={bot.client_id ? "" : bot.client_name} idPrefix="pers" />}
              <div><label htmlFor="client_site" className="label">Site onde o chatbot fica</label><input id="client_site" name="client_site" maxLength={200} defaultValue={bot.client_site ?? ""} className="input" /></div>
              <div><label htmlFor="tone" className="label">Tom de voz</label><input id="tone" name="tone" maxLength={200} defaultValue={persona.tone ?? "amigável, direto e profissional"} className="input" /></div>
              <div><label htmlFor="welcome" className="label">Mensagem de boas-vindas</label><input id="welcome" name="welcome" maxLength={300} defaultValue={persona.welcome ?? ""} className="input" /></div>
              <div><label htmlFor="instructions" className="label">Instruções extras (o que sempre dizer, o que nunca dizer)</label><textarea id="instructions" name="instructions" rows={5} maxLength={4000} defaultValue={persona.instructions ?? ""} className="input" placeholder="Ex.: Sempre ofereça a avaliação gratuita. Nunca prometa desconto." /></div>
              {bot.client_id && <p className="text-xs text-muted">O nome do cliente e quanto você cobra ficam no <Link href={`/painel/clientes/${bot.client_id}?tab=dados`} className="font-semibold text-brand hover:underline">painel do cliente</Link>.</p>}
              <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
            </ActionForm>
          )}

          {tab === "aparencia" && (
            <ActionForm key={bot.updated_at} action={updateBot.bind(null, id)} className="flex max-w-[640px] flex-col gap-4">
              <div><h2 className="text-[22px] font-bold">Aparência e marca</h2><p className="text-sm text-muted">O visitante vê a marca do cliente no chat e a sua agência no rodapé. A {process.env.NEXT_PUBLIC_BRAND_NAME ?? "Boavoz"} nunca aparece.</p></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label htmlFor="color" className="label">Cor principal</label><input id="color" name="color" type="color" defaultValue={color} className="input h-11 p-1" /></div>
                <div><label htmlFor="avatar_text" className="label">Iniciais do avatar</label><input id="avatar_text" name="avatar_text" maxLength={2} defaultValue={appearance.avatar_text ?? initials(bot.client_name)} className="input" /></div>
              </div>
              <div><label htmlFor="suggested" className="label">Perguntas sugeridas (uma por linha, até 6)</label><textarea id="suggested" name="suggested" rows={4} defaultValue={(appearance.suggested_questions ?? []).join("\n")} className="input" /></div>
              <div className="border-t border-line pt-4">
                <h3 className="text-sm font-semibold">Balão no site do cliente</h3>
                <p className="mb-3 text-xs text-muted">Vale para o widget já instalado em até um minuto; não precisa trocar o código.</p>
                <WidgetPositionPicker position={appearance.position === "left" ? "left" : "right"} offset={Number(appearance.offset ?? 20)} color={color} />
              </div>
              <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
            </ActionForm>
          )}

          {tab === "leads" && (
            <ActionForm key={bot.updated_at} action={updateBot.bind(null, id)} className="flex max-w-[640px] flex-col gap-4">
              <div><h2 className="text-[22px] font-bold">Captura de leads</h2><p className="text-sm text-muted">Quando o visitante quer agendar, orçar ou falar com alguém, o assistente pede nome e contato. {leadCount ?? 0} leads até agora.</p></div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="lead_enabled" defaultChecked={leadCapture.enabled !== false} /> Ativar captura de leads na conversa</label>
              <div><label htmlFor="notify_email" className="label">Avisar por e-mail (o dono do cliente, por exemplo)</label><input id="notify_email" name="notify_email" type="email" defaultValue={leadCapture.notify_email ?? ""} className="input" placeholder="recepcao@clinicasorriso.com.br" /></div>
              <div><label htmlFor="notify_whatsapp" className="label">WhatsApp para aviso (em breve)</label><input id="notify_whatsapp" name="notify_whatsapp" defaultValue={leadCapture.notify_whatsapp ?? ""} className="input" placeholder="+55 41 9…" /></div>
              <p className="text-xs text-muted">Você também recebe todos os leads no seu e-mail e na aba Leads do painel.</p>
              <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
            </ActionForm>
          )}

          {tab === "conversas" && (
            <>
              <div><h2 className="text-[22px] font-bold">Conversas</h2><p className="text-sm text-muted">Últimas 30. Abra uma conversa para assumir e responder como pessoa da equipe.</p></div>
              <div className="card overflow-hidden">
                {(conversations ?? []).length === 0 && <p className="p-5 text-sm text-muted">Nenhuma conversa ainda.</p>}
                {(conversations ?? []).map((c) => (
                  <Link key={c.id} href={`/painel/bots/${id}/conversas/${c.id}`} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 text-sm last:border-0 hover:bg-ground">
                    <span className="text-muted">{relativeTime(c.started_at)}</span>
                    <span className="font-medium">{c.message_count} mensagens</span>
                    <span className="text-xs text-muted">{c.channel}</span>
                    <ConversationStateBadge conv={c} />
                    {c.handoff_requested_at && !c.handled_at ? <span className="ml-auto rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber-ink">esperando atendente</span> : c.needs_human ? <span className="ml-auto text-xs text-muted">precisou de ajuda</span> : null}
                  </Link>
                ))}
              </div>
            </>
          )}

          {tab === "whatsapp" && (
            <div className="flex max-w-[640px] flex-col gap-4">
              <div>
                <h2 className="text-[22px] font-bold">WhatsApp</h2>
                <p className="text-sm text-muted">{bot.name} responde no WhatsApp do cliente com a mesma base de conhecimento. Pedidos de atendente aparecem em Conversas, e a sua resposta sai pelo WhatsApp.</p>
              </div>
              {bot.is_demo ? (
                <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Converta a demo em chatbot para ligar o WhatsApp.</p>
              ) : whatsapp ? (
                <div className="card flex flex-col gap-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">conectado</span>
                    <span className="display text-lg font-bold">{whatsapp.display_phone ?? whatsapp.phone_number_id}</span>
                    {whatsapp.verified_name && <span className="text-sm text-muted">· {whatsapp.verified_name}</span>}
                  </div>
                  <p className="text-sm text-ink-2">Ligado {relativeTime(whatsapp.created_at)}. {bot.status === "live" ? "Mande uma mensagem para este número para testar." : "O chatbot não está publicado: ele só responde no WhatsApp depois de clicar em “Publicar” no topo."}</p>
                  {whatsapp.business_id && (
                    <p className="text-xs text-muted">As conversas do WhatsApp são cobradas pela Meta direto do cliente. Para não parar, ele precisa ter uma forma de pagamento no <a href="https://business.facebook.com/wa/manage/home/" target="_blank" rel="noopener" className="font-semibold text-brand hover:underline">Gerenciador do WhatsApp</a>.</p>
                  )}
                  <ConfirmAction
                    action={disconnectWhatsApp.bind(null, id)}
                    title="Desconectar o WhatsApp?"
                    description={<>O assistente para de responder pelo número <strong className="text-ink">{whatsapp.display_phone ?? whatsapp.phone_number_id}</strong>. As conversas antigas continuam no painel.</>}
                    confirmLabel="Desconectar"
                    className="self-start text-xs font-medium text-danger hover:underline"
                  >
                    Desconectar
                  </ConfirmAction>
                </div>
              ) : (
                <div className="card flex flex-col gap-4 p-5">
                  {signup ? (
                    <>
                      <p className="text-sm text-ink-2">O cliente entra com o Facebook dele, escolhe a conta do WhatsApp Business e o número. Pode ser feito com ele do lado, na chamada, ou pelo seu acesso ao Facebook da empresa dele.</p>
                      <WhatsAppConnect appId={signup.appId} configId={signup.configId} graphVersion={signup.graphVersion} action={completeWhatsAppSignup.bind(null, id)} />
                      <p className="text-xs text-muted">O número escolhido passa a funcionar pela API e sai do aplicativo do WhatsApp no celular. Use um número dedicado ao atendimento.</p>
                    </>
                  ) : (
                    <p className="text-sm text-muted">O botão de conexão aparece quando META_APP_ID e WHATSAPP_CONFIG_ID estiverem configurados.</p>
                  )}
                  <details className="border-t border-line-2 pt-3 text-sm">
                    <summary className="cursor-pointer text-xs font-semibold text-muted">Ligar pelo ID (número de teste do app)</summary>
                    <ActionForm action={connectWhatsApp.bind(null, id)} className="mt-3 flex flex-col gap-4">
                      <div><label htmlFor="phone_number_id" className="label">Phone number ID</label><input id="phone_number_id" name="phone_number_id" required inputMode="numeric" className="input" placeholder="1234567890123456" /></div>
                      <div><label htmlFor="waba_id" className="label">WhatsApp Business Account ID (opcional)</label><input id="waba_id" name="waba_id" inputMode="numeric" className="input" /></div>
                      <p className="text-xs text-muted">Os dois aparecem no app da Meta, em WhatsApp › Configuração da API. Usa o token do servidor (WHATSAPP_TOKEN).</p>
                      <SubmitButton pendingLabel="Conferindo com a Meta…" className="btn-ghost self-start">Ligar pelo ID</SubmitButton>
                    </ActionForm>
                  </details>
                </div>
              )}
            </div>
          )}

          {tab === "instalacao" && (
            <div className="flex max-w-[860px] flex-col gap-5">
              <div>
                <h2 className="text-[22px] font-bold">Instalação</h2>
                <p className="text-sm text-muted">Escolha onde o site do cliente foi feito e siga o passo a passo. O código é o mesmo em todo lugar; o que muda é onde colar.</p>
              </div>
              {bot.status !== "live" && !bot.is_demo && <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">O chatbot ainda não está publicado. Você pode instalar agora: o balão fica invisível no site do cliente até você clicar em “Publicar” no topo.</p>}
              <InstallGuide
                widgetSrc={`${base}/widget.js`}
                publicKey={bot.public_key}
                directLink={`${base}/w/${bot.public_key}`}
                brand={process.env.NEXT_PUBLIC_BRAND_NAME ?? "Boavoz"}
                isLive={bot.status === "live"}
                installed={bot.installed_at && bot.installed_host ? { host: bot.installed_host, at: bot.installed_at, lastSeen: bot.last_seen_at ?? null } : null}
              />
            </div>
          )}
        </section>

        <aside className="hidden flex-col gap-3 border-l border-line bg-[#ecebe4] p-5 lg:flex">
          <div className="flex items-center justify-between text-xs"><span className="font-semibold uppercase tracking-[0.06em] text-muted">Teste ao vivo</span><span className="text-muted">como o visitante vê</span></div>
          <div className="h-[560px] overflow-hidden rounded-2xl shadow-[0_12px_32px_rgba(27,31,29,0.12)]">
            {readySources ? (
              <ChatWindow
                channel="painel"
                bot={{ key: bot.public_key, name: bot.name, clientName: bot.client_name, color, avatarText: appearance.avatar_text ?? initials(bot.client_name), welcome: persona.welcome ?? `Olá! Sou ${bot.name}. Como posso ajudar?`, suggestedQuestions: appearance.suggested_questions ?? [], poweredBy: agency.name, privacyUrl: agency.privacy_url }}
              />
            ) : (
              <div className="flex h-full items-center justify-center bg-white p-6 text-center text-sm text-muted">Adicione uma fonte para testar o assistente.</div>
            )}
          </div>
        </aside>

        {/* abaixo de lg o teste ao vivo abre por um botão flutuante */}
        <ChatPreviewSheet disabledReason={!readySources ? "Adicione uma fonte para testar o assistente." : null}>
          <ChatWindow
            channel="painel"
            bot={{ key: bot.public_key, name: bot.name, clientName: bot.client_name, color, avatarText: appearance.avatar_text ?? initials(bot.client_name), welcome: persona.welcome ?? `Olá! Sou ${bot.name}. Como posso ajudar?`, suggestedQuestions: appearance.suggested_questions ?? [], poweredBy: agency.name, privacyUrl: agency.privacy_url }}
          />
        </ChatPreviewSheet>
      </div>
    </div>
  );
}
