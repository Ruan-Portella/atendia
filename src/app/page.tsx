import Link from "next/link";
import { ArrowRight, Check, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/logo";
import { LegalFooter } from "@/components/legal-page";
import { DemoGenerator } from "@/components/demo-generator";
import { RoiCalculator } from "@/components/roi-calculator";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { ChatDemo } from "@/components/landing/chat-demo";
import { InboxMockup } from "@/components/landing/inbox-mockup";
import { BOT_SIZES, CREDIT_MIN_BRL, DEMOS_PER_MONTH_FREE, OVERAGE_PRICE_BRL, PACKS, TEST_ANSWERS_FREE, brl, brlCents, num } from "@/lib/plans";
import { FEATURES, LANDING, audienceOf, type Audience } from "@/lib/landing";
import { waitlistMode } from "@/lib/waitlist";
import { cn } from "@/lib/utils";

/** Perguntas frequentes (revisão de preços, parte 6), mais as da lista de espera quando ligada. */
const FAQ: Array<[string, string]> = [
  ["Posso testar antes de pagar?", `Sim. A conta grátis monta e testa os chatbots com até ${TEST_ANSWERS_FREE} respostas da IA e gera até ${DEMOS_PER_MONTH_FREE} demos por mês, sem cartão.`],
  ["Preciso de chave da OpenAI?", "Não. A IA vem incluída no tamanho do chatbot, com o custo dela por nossa conta."],
  ["E se a cota acabar?", `Só aquele chatbot passa para a sua equipe até o mês virar. Ou ligue o excedente: cada atendimento a mais custa ${brlCents(OVERAGE_PRICE_BRL)}, pago com crédito pré-pago (a partir de ${brl(CREDIT_MIN_BRL)}).`],
  ["Como funciona a cobrança?", "No cartão, todo dia 1º, e o primeiro mês é proporcional. Subir de tamanho vale na hora, pagando só a diferença dos dias que faltam; descer vale no mês seguinte. Sem fidelidade."],
  ["A Meta cobra à parte?", "No WhatsApp, a Meta cobra direto na conta do número, sem nada nosso em cima. As respostas do atendimento têm 1.000 grátis por mês em cada número; depois, cerca de R$ 0,035 cada. Os lembretes custam cerca de R$ 0,035 e as promoções, cerca de R$ 0,32 (tabela da Meta de outubro de 2026). No Instagram, a Meta não cobra."],
  ["E sem IA?", `O tamanho Atendimento (${brl(BOT_SIZES.atendimento.priceBrl)}/mês) liga o WhatsApp, o Instagram e o chat do site só com a sua equipe respondendo.`],
];

const WAITLIST_FAQ: Array<[string, string]> = [
  ["Por que lista de espera?", "Estamos abrindo aos poucos, para acompanhar de perto cada conta no começo. Quem entra na lista recebe o convite por ordem de chegada."],
  ["Quando chega o meu convite?", "Nas próximas semanas. O convite chega no e-mail que você deixou, com o link para entrar e montar o primeiro chatbot na hora."],
];

const SITES = ["WordPress", "Webflow", "Framer", "Wix", "Shopify", "Lovable", "HTML puro"];

function AudienceSwitch({ audience }: { audience: Audience }) {
  const options: Array<[Audience, string, string, string]> = [
    ["agency", "/", "Para a minha agência", "Agência"],
    ["business", "/?para=negocio", "Para o meu negócio", "Meu negócio"],
  ];
  return (
    <nav aria-label="Para quem é" className="inline-flex rounded-full border border-line bg-panel p-1 text-sm font-medium">
      {options.map(([a, href, label, short]) => (
        <Link key={a} href={href} scroll={false} aria-current={a === audience ? "page" : undefined} className={cn("rounded-full px-4 py-1.5 transition-colors", a === audience ? "bg-ink text-ground" : "text-muted hover:text-ink")}>
          <span className="sm:hidden">{short}</span>
          <span className="hidden sm:inline">{label}</span>
        </Link>
      ))}
    </nav>
  );
}

function SectionHead({ eyebrow, title, children, center }: { eyebrow: string; title: string; children?: React.ReactNode; center?: boolean }) {
  return (
    <div className={cn("flex max-w-[720px] flex-col gap-3", center && "mx-auto items-center text-center")}>
      <span className="eyebrow">{eyebrow}</span>
      <h2 className="text-3xl font-bold leading-[1.08] md:text-[44px]">{title}</h2>
      {children && <p className="text-[17px] leading-relaxed text-ink-2">{children}</p>}
    </div>
  );
}

/**
 * Landing (redesenho de 24/10/2026, com as referências do usuário): para a agência ou para o próprio
 * negócio (?para=negocio). O produto aparece de verdade logo no alto, a demonstração deixa escolher a
 * pergunta e ver o assistente responder, e, com a lista de espera ligada (NEXT_PUBLIC_WAITLIST=1),
 * os botões levam para a lista em vez do cadastro.
 */
export default async function LandingPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const audience = audienceOf(sp.para);
  const business = audience === "business";
  const c = LANDING[audience];
  const waitlist = waitlistMode();
  const sizes = Object.values(BOT_SIZES).filter((s) => s.atendimentos > 0);
  const packs = Object.values(PACKS).filter((p) => !(business && p.id === "plataforma"));
  const faq = waitlist ? [...WAITLIST_FAQ, ...FAQ] : FAQ;

  const primaryCta = waitlist ? (
    <a href="#lista" className="btn-primary">Entrar na lista</a>
  ) : (
    <Link href="/cadastro" className="btn-primary">Começar grátis</Link>
  );

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-ground/85 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-5 py-3.5 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-7 text-[15px] font-medium lg:flex">
            <a href="#demo" className="text-ink-2 hover:text-ink">Demonstração</a>
            <a href="#como" className="text-ink-2 hover:text-ink">Como funciona</a>
            <a href="#precos" className="text-ink-2 hover:text-ink">Preços</a>
            <a href="#perguntas" className="text-ink-2 hover:text-ink">Perguntas</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-sm font-medium text-ink-2 hover:text-ink">Entrar</Link>
            {primaryCta}
          </div>
        </div>
      </header>

      <main className="flex flex-col">
        {/* o alto: para quem é, a promessa, a lista (ou o cadastro) e o produto de verdade */}
        <section className="relative overflow-hidden">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_50%_0%,var(--color-brand-soft),transparent)]" aria-hidden />
          <div className="relative mx-auto flex w-full max-w-[1200px] flex-col items-center gap-7 px-5 pb-16 pt-12 text-center sm:px-6 sm:pt-16 lg:pt-20">
            <AudienceSwitch audience={audience} />
            <span className="rounded-full border border-brand-line bg-panel px-3 py-1 text-xs font-semibold text-brand">
              {waitlist ? "Acesso antecipado · abrindo aos poucos" : c.eyebrow}
            </span>
            <h1 className="max-w-[920px] text-[38px] font-bold leading-[1.04] sm:text-5xl md:text-[58px] lg:text-[64px]">{c.title}</h1>
            <p className="max-w-[640px] text-lg leading-relaxed text-ink-2">{c.subtitle}</p>
            {waitlist ? (
              <WaitlistForm profile={audience} source={`hero-${audience}`} />
            ) : (
              <div className="flex flex-wrap items-center justify-center gap-3">
                <Link href="/cadastro" className="btn-primary px-5 py-3.5 text-base">Criar conta grátis<ArrowRight size={16} /></Link>
                <a href="#demo" className="btn-ghost px-4 py-3.5 text-base">Ver a demonstração</a>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-sm text-muted">
              {["Sem cartão", "IA incluída", "WhatsApp oficial da Meta", "Sem fidelidade"].map((t) => (
                <span key={t} className="flex items-center gap-1.5"><Check size={14} className="text-brand" />{t}</span>
              ))}
            </div>
            <div className="mt-6 w-full max-w-[1120px] text-left">
              <InboxMockup business={business} />
            </div>
          </div>
        </section>

        <section className="border-y border-line bg-panel">
          <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center gap-3 px-5 py-7 text-sm text-muted sm:px-6">
            <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-2">
              <span>O chat funciona em qualquer site:</span>
              {SITES.map((s) => <span key={s} className="font-semibold text-ink">{s}</span>)}
            </div>
            <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
              <span>E responde no</span>
              <span className="font-semibold text-ink">WhatsApp oficial</span>
              <span>e no</span>
              <span className="font-semibold text-ink">Instagram Direct</span>
              <span>pela integração oficial da Meta.</span>
            </div>
          </div>
        </section>

        <section id="demo" className="mx-auto flex w-full max-w-[1200px] scroll-mt-20 flex-col gap-10 px-5 py-20 sm:px-6 lg:py-24">
          <SectionHead eyebrow="Demonstração" title={business ? "Pergunte como os seus clientes perguntam." : "Pergunte como o cliente do seu cliente pergunta."}>
            {business
              ? "Preço, horário, agendamento, áudio e a hora de chamar você: escolha uma mensagem e veja o assistente responder."
              : "Preço, horário, agendamento, comprovante e a hora de chamar a recepção: escolha uma mensagem e veja o assistente da clínica responder."}
          </SectionHead>
          <ChatDemo name={c.demoName} initials={c.demoInitials} color={c.demoColor} turns={c.demo} />
          <div className="card flex flex-col gap-4 p-6 sm:p-7 lg:flex-row lg:items-center lg:gap-10">
            <div className="flex flex-col gap-1.5 lg:max-w-[380px]">
              <div className="display text-[22px] font-bold">{business ? "Agora com o seu site" : "Agora com o site de um cliente"}</div>
              <p className="text-[15px] leading-relaxed text-ink-2">Cole o endereço e receba um assistente de demonstração em 30 segundos, respondendo com o que está no site. Nada inventado.</p>
            </div>
            <div className="min-w-0 flex-1"><DemoGenerator /></div>
          </div>
        </section>

        <section id="como" className="border-t border-line bg-panel">
          <div className="mx-auto flex w-full max-w-[1200px] scroll-mt-20 flex-col gap-12 px-5 py-20 sm:px-6 lg:py-24">
            <SectionHead eyebrow="Como funciona" title={business ? "Do seu site ao assistente no ar em uma tarde." : "Do site do cliente ao assistente no ar em uma tarde."} />
            <ol className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {c.steps.map(([t, d], i) => (
                <li key={t} className="flex flex-col gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand font-mono text-sm font-semibold text-on-brand">{i + 1}</span>
                    {i < c.steps.length - 1 && <span className="hidden h-px flex-1 bg-line-strong lg:block" aria-hidden />}
                  </div>
                  <div className="display text-xl font-bold">{t}</div>
                  <p className="text-[15px] leading-relaxed text-ink-2">{d}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="recursos" className="mx-auto flex w-full max-w-[1200px] scroll-mt-20 flex-col gap-10 px-5 py-20 sm:px-6 lg:py-24">
          <SectionHead eyebrow="Recursos" title="Tudo o que um bom atendimento precisa, num lugar só." />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <div className="flex flex-col gap-3 rounded-[16px] bg-brand p-7 text-on-brand md:col-span-2 lg:col-span-1 lg:row-span-2">
              <ShieldCheck size={22} />
              <div className="display text-2xl font-bold">{c.brandFeature[0]}</div>
              <p className="text-[15px] leading-relaxed opacity-90">{c.brandFeature[1]}</p>
            </div>
            {FEATURES.map(([t, d]) => (
              <div key={t} className="card flex flex-col gap-2 p-6">
                <div className="display text-lg font-bold">{t}</div>
                <p className="text-[15px] leading-relaxed text-ink-2">{d}</p>
              </div>
            ))}
          </div>
        </section>

        {!business && (
          <section className="bg-[#161615] text-[#efefec]">
            <div className="mx-auto grid w-full max-w-[1200px] items-center gap-12 px-5 py-20 sm:px-6 md:grid-cols-2">
              <div className="flex flex-col gap-4">
                <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-[#9fd3bf]">Faça a conta</span>
                <h2 className="text-3xl font-bold leading-[1.08] md:text-[44px]">Você paga a partir de {brl(BOT_SIZES.P.priceBrl)} por chatbot com IA. Seus clientes pagam você.</h2>
                <p className="max-w-[520px] text-[17px] leading-relaxed text-[#b9c2bd]">Um atendimento que responde 24 horas, agenda e qualifica leads tem valor para qualquer negócio local. Você define o preço do seu serviço; seu cliente vê a sua marca no painel, no chat e nos e-mails.</p>
              </div>
              <RoiCalculator />
            </div>
          </section>
        )}

        <section id="precos" className="mx-auto flex w-full max-w-[1200px] scroll-mt-20 flex-col gap-10 px-5 py-20 sm:px-6 lg:py-24">
          <SectionHead eyebrow="Preços" title={business ? "Pague pelo tamanho do seu atendimento." : "Conta grátis. Cada chatbot no ar com um tamanho."}>
            {`Monte e teste grátis, sem cartão. Para atender, cada chatbot ganha um tamanho, com a IA incluída e os três canais sem custo a mais. 1 atendimento = 24 horas de conversa da IA com um contato, com até 40 respostas; as respostas da ${business ? "sua equipe" : "equipe"} não contam.`}
          </SectionHead>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {sizes.map((s) => {
              const featured = s.id === "M";
              return (
                <div key={s.id} className={featured ? "relative flex flex-col gap-4 rounded-[16px] bg-ink p-7 text-ground" : "card flex flex-col gap-4 p-7"}>
                  {featured && <span className="absolute -top-3 left-7 rounded-full bg-amber px-2.5 py-1 text-xs font-bold uppercase tracking-[0.06em] text-ink">Mais escolhido</span>}
                  <div className="display text-xl font-bold">{s.id === "volume" ? "Volume" : `Chatbot ${s.name}`}</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="display text-[40px] font-bold leading-none">{brl(s.priceBrl)}</span>
                    <span className={featured ? "text-sm opacity-70" : "text-sm text-muted"}>{s.id === "volume" ? "/pacote/mês" : "/mês"}</span>
                  </div>
                  <ul className={cn("flex flex-col gap-2 text-[15px]", featured ? "opacity-90" : "text-ink-2")}>
                    <li>{num(s.atendimentos)} atendimentos/mês{s.id === "volume" ? " por pacote" : ""}</li>
                    <li>{s.description}</li>
                    <li>{business ? "WhatsApp, Instagram e site" : "Sua marca no chat e no painel"}</li>
                  </ul>
                  {waitlist ? (
                    <a href="#lista" className={featured ? "btn mt-auto bg-ground text-ink hover:opacity-90" : "btn-ghost mt-auto"}>Entrar na lista</a>
                  ) : (
                    <Link href="/cadastro" className={featured ? "btn mt-auto bg-ground text-ink hover:opacity-90" : "btn-ghost mt-auto"}>Começar grátis</Link>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-[15px] leading-relaxed text-ink-2">
            Só a caixa de entrada da equipe, sem IA: tamanho Atendimento, {brl(BOT_SIZES.atendimento.priceBrl)}/mês por chatbot. Pacotes da conta: {packs.map((p) => `${p.name} ${brl(p.priceBrl)}/mês`).join(" · ")}. Passou da cota? Ligue o excedente, pago com crédito: {brlCents(OVERAGE_PRICE_BRL)} por atendimento a mais.
          </p>
        </section>

        <section id="perguntas" className="border-t border-line bg-panel">
          <div className="mx-auto grid w-full max-w-[1200px] scroll-mt-20 gap-10 px-5 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:py-24">
            <SectionHead eyebrow="Perguntas" title="Ficou alguma dúvida?">
              {`Se não estiver aqui, escreva para contato@boavoz.com: quem responde é gente.`}
            </SectionHead>
            <div className="flex flex-col divide-y divide-line border-y border-line">
              {faq.map(([q, a]) => (
                <details key={q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold [&::-webkit-details-marker]:hidden">
                    {q}
                    <span className="text-xl leading-none text-muted transition-transform group-open:rotate-45" aria-hidden>+</span>
                  </summary>
                  <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="lista" className="relative scroll-mt-20 overflow-hidden">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(50%_70%_at_50%_100%,var(--color-brand-soft),transparent)]" aria-hidden />
          <div className="relative mx-auto flex w-full max-w-[860px] flex-col items-center gap-6 px-5 py-20 text-center sm:px-6 lg:py-28">
            <span className="eyebrow">{waitlist ? "Você leu até aqui" : "Comece hoje"}</span>
            <h2 className="text-3xl font-bold leading-[1.08] md:text-[48px]">{c.ctaTitle}</h2>
            {waitlist ? (
              <>
                <p className="max-w-[560px] text-[17px] leading-relaxed text-ink-2">Deixe o e-mail e garanta o seu lugar na fila. O convite chega por ordem de chegada.</p>
                <WaitlistForm profile={audience} source={`fim-${audience}`} />
              </>
            ) : (
              <Link href="/cadastro" className="btn-primary px-6 py-3.5 text-base">Criar conta grátis<ArrowRight size={16} /></Link>
            )}
          </div>
        </section>
      </main>
      <LegalFooter />
    </div>
  );
}
