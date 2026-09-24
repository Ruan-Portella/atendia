import Link from "next/link";
import { Logo } from "@/components/logo";
import { LegalFooter } from "@/components/legal-page";
import { DemoGenerator } from "@/components/demo-generator";
import { RoiCalculator } from "@/components/roi-calculator";
import { PLANS, brl, num } from "@/lib/plans";

const brand = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Boavoz";

const NICHOS = ["Clínicas", "Imobiliárias", "Advogados", "Escolas e cursos", "Academias", "Restaurantes", "E-commerce", "Hotéis e pousadas"];

export default function LandingPage() {
  return (
    <div className="flex min-h-full flex-col">
      <header className="flex items-center justify-between border-b border-line px-5 py-4 sm:px-6 sm:py-5 lg:px-16 xl:px-24">
        <Logo />
        <nav className="hidden items-center gap-6 text-[15px] font-medium lg:flex xl:gap-8">
          <a href="#como">Como funciona</a>
          <a href="#precos">Preços</a>
          <a href="#nichos">Por nicho</a>
          <a href="#afiliados">Afiliados</a>
          <Link href="/login">Entrar</Link>
          <Link href="/cadastro" className="btn-primary">Começar grátis</Link>
        </nav>
        <div className="flex items-center gap-3 lg:hidden">
          <Link href="/login" className="text-sm font-medium">Entrar</Link>
          <Link href="/cadastro" className="btn-primary">Começar grátis</Link>
        </div>
      </header>

      <section className="grid items-center gap-10 px-5 py-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:px-16 lg:py-22 xl:px-24">
        <div className="flex flex-col gap-6">
          <span className="self-start rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-brand">Para agências e freelancers</span>
          <h1 className="text-[34px] font-bold leading-[1.06] sm:text-4xl md:text-5xl xl:text-6xl" style={{ textWrap: "balance" }}>
            Adicione R$ 3.000 por mês na sua agência revendendo chatbots de IA com a sua marca.
          </h1>
          <p className="max-w-[560px] text-lg leading-relaxed text-ink-2">
            Crie um chatbot treinado no site e nos documentos de cada cliente em minutos, coloque o seu logo e cobre o que quiser. Ele atende no site e, em breve, também no WhatsApp oficial e no Instagram Direct do cliente. Nós cuidamos da IA. Você cuida dos clientes.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/cadastro" className="btn-primary px-5 py-3.5 text-base">Criar conta grátis</Link>
            <a href="#como" className="btn-ghost px-4 py-3.5 text-base">Ver como funciona</a>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted"><span>14 dias grátis</span><span className="hidden sm:inline">·</span><span>Sem cartão</span><span className="hidden sm:inline">·</span><span>Cancele quando quiser</span></div>
        </div>

        <div className="card flex flex-col gap-4 p-7 shadow-[0_20px_50px_rgba(27,31,29,0.08)]">
          <div>
            <div className="display text-[22px] font-bold">Teste com o site de um cliente</div>
            <div className="text-sm text-muted">Cole a URL e receba um chatbot de demonstração em 30 segundos.</div>
          </div>
          <DemoGenerator />
          <div className="flex flex-col gap-2.5 rounded-xl bg-ground p-4 text-sm">
            <div className="flex items-center gap-2.5">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#2a6fd6] text-[11px] font-bold text-white">CS</div>
              <div className="text-[13px] font-semibold">Clínica Sorriso · assistente</div>
              <span className="ml-auto rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand">exemplo</span>
            </div>
            <div className="max-w-[78%] self-end rounded-[14px_14px_4px_14px] bg-ink px-3.5 py-2.5 text-ground">Vocês fazem clareamento? Quanto custa?</div>
            <div className="max-w-[84%] self-start rounded-[14px_14px_14px_4px] border border-line bg-white px-3.5 py-2.5">Fazemos sim. O clareamento a laser custa R$ 890 e o caseiro R$ 450. Quer agendar uma avaliação gratuita? Atendemos de segunda a sábado, das 8h às 19h.</div>
          </div>
          <div className="text-center text-xs text-muted">Respostas baseadas no conteúdo real do site. Nada inventado.</div>
        </div>
      </section>

      <div className="flex flex-col items-center gap-3 px-6 pb-14 text-sm text-muted">
        <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
          <span>Funciona em qualquer site:</span>
          {["WordPress", "Webflow", "Framer", "Wix", "Shopify", "Lovable", "HTML puro"].map((s) => (
            <span key={s} className="font-semibold text-ink">{s}</span>
          ))}
        </div>
        {/* canais da Meta ainda em teste fechado: tirar o "em breve" no lançamento */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-2">
          <span>E também:</span>
          <span className="font-semibold text-ink">WhatsApp oficial</span>
          <span>·</span>
          <span className="font-semibold text-ink">Instagram Direct</span>
          <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">em breve</span>
          <span className="w-full text-center text-xs sm:w-auto">pela integração oficial da Meta</span>
        </div>
      </div>

      <section className="grid items-center gap-12 bg-ink px-6 py-16 text-ground md:grid-cols-2 lg:px-16 xl:px-24">
        <div className="flex flex-col gap-4">
          <span className="text-xs font-semibold uppercase tracking-[0.08em] text-brand-tint">Faça a conta</span>
          <h2 className="text-3xl font-bold leading-[1.08] md:text-[44px]">Você paga {brl(PLANS.agencia.priceBrl)}. Seus clientes pagam você.</h2>
          <p className="max-w-[520px] text-[17px] leading-relaxed text-[#b9c2bd]">Um chatbot que responde 24 horas, agenda e qualifica leads vale entre R$ 300 e R$ 800 por mês para um negócio local. Você define o preço, o cliente nunca vê a {brand}.</p>
        </div>
        <RoiCalculator />
      </section>

      <section id="como" className="flex flex-col gap-10 px-6 py-20 lg:px-16 xl:px-24">
        <div className="max-w-[640px]">
          <span className="eyebrow">Como funciona</span>
          <h2 className="mt-2 text-3xl font-bold leading-[1.1] md:text-[40px]">Do site do cliente ao chatbot no ar em uma tarde.</h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Cole a URL", `A ${brand} lê o site, os PDFs e as perguntas frequentes do cliente e monta a base de conhecimento.`],
            ["Coloque a sua marca", "Logo, cores, nome do assistente e tom de voz. O cliente vê a sua agência, nunca a nossa."],
            ["Cole uma linha no site", "Um script de uma linha. Funciona em qualquer plataforma, do WordPress ao HTML puro. Em breve, conecte também o WhatsApp e o Instagram do cliente, com o login oficial da Meta."],
            ["Receba os leads", "Nome, WhatsApp e o resumo da conversa chegam por e-mail ou direto no seu painel."],
          ].map(([t, d], i) => (
            <div key={t} className="card flex flex-col gap-3 p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-brand-soft text-sm font-bold text-brand">{i + 1}</div>
              <div className="display text-xl font-bold">{t}</div>
              <div className="text-[15px] leading-relaxed text-ink-2">{d}</div>
            </div>
          ))}
        </div>
      </section>

      <section id="precos" className="flex flex-col gap-9 px-6 pb-20 lg:px-16 xl:px-24">
        <div className="max-w-[640px]">
          <span className="eyebrow">Preços</span>
          <h2 className="mt-2 text-3xl font-bold leading-[1.1] md:text-[40px]">Um plano por tamanho de agência. Sem cobrança por mensagem.</h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {(["freelancer", "agencia", "escala"] as const).map((id) => {
            const p = PLANS[id];
            const featured = id === "agencia";
            return (
              <div key={id} className={featured ? "relative flex flex-col gap-4 rounded-2xl bg-brand p-7 text-ground" : "card flex flex-col gap-4 p-7"}>
                {featured && <span className="absolute -top-3 left-7 rounded-full bg-amber px-2.5 py-1 text-xs font-bold uppercase tracking-[0.06em] text-ink">Mais escolhido</span>}
                <div className="display text-xl font-bold">{p.name}</div>
                <div className="flex items-baseline gap-1.5">
                  <span className="display text-[44px] font-bold leading-none">{brl(p.priceBrl)}</span>
                  <span className={featured ? "text-sm text-[#c7d9d1]" : "text-sm text-muted"}>/mês</span>
                </div>
                <div className={featured ? "flex flex-col gap-2 text-[15px] text-[#dfe9e4]" : "flex flex-col gap-2 text-[15px] text-ink-2"}>
                  <span>{p.bots} chatbots</span>
                  <span>{num(p.conversations)} conversas/mês</span>
                  <span>Sua marca no widget</span>
                  <span>Gerador de demos ilimitado</span>
                  {p.customDomain && <span>Painel com o seu domínio</span>}
                </div>
                <Link href="/cadastro" className={featured ? "btn mt-auto bg-ground text-brand hover:bg-white" : "btn-ghost mt-auto"}>Começar grátis</Link>
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-8 px-6 pb-20 md:grid-cols-2 lg:px-16 xl:px-24">
        <div id="nichos" className="card flex flex-col gap-4 p-7">
          <div className="display text-2xl font-bold">Material de venda pronto, por nicho</div>
          <p className="text-[15px] leading-relaxed text-ink-2">Uma página para cada tipo de cliente, com exemplos de conversa e argumentos. Use para vender.</p>
          <div className="flex flex-wrap gap-2">
            {NICHOS.map((n) => (
              <span key={n} className="rounded-full border border-line bg-ground px-3 py-1.5 text-sm font-medium">{n}</span>
            ))}
          </div>
        </div>
        <div id="afiliados" className="card flex flex-col gap-4 p-7">
          <div className="display text-2xl font-bold">Indique e ganhe 30% em crédito, para sempre</div>
          <p className="text-[15px] leading-relaxed text-ink-2">Cada agência que assinar pelo seu link gera 30% do que ela paga, todo mês, como crédito na sua assinatura. Com três ou quatro indicações, seu plano sai de graça. Sem teto.</p>
          <Link href="/cadastro" className="btn-dark mt-auto self-start">Quero meu link</Link>
        </div>
      </section>

      <section className="flex flex-col items-center gap-5 bg-brand-soft px-6 py-16 text-center">
        <h2 className="max-w-[760px] text-3xl font-bold leading-[1.1] md:text-[40px]">Gere a primeira demo hoje. Mande para um cliente amanhã.</h2>
        <Link href="/cadastro" className="btn-primary px-6 py-3.5 text-base">Criar conta grátis</Link>
      </section>
      <LegalFooter />
    </div>
  );
}
