import Link from "next/link";
import { Logo } from "@/components/logo";
import { LegalFooter } from "@/components/legal-page";
import { DemoGenerator } from "@/components/demo-generator";
import { RoiCalculator } from "@/components/roi-calculator";
import { BOT_SIZES, CREDIT_MIN_BRL, DEMOS_PER_MONTH_FREE, OVERAGE_PRICE_BRL, PACKS, TEST_ANSWERS_FREE, brl, brlCents, num } from "@/lib/plans";

const brand = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Boavoz";

/** Perguntas da seção de preços (revisão de preços, parte 6). */
const FAQ: Array<[string, string]> = [
  ["Posso testar antes de pagar?", `Sim. A conta grátis monta e testa os chatbots com até ${TEST_ANSWERS_FREE} respostas da IA e gera até ${DEMOS_PER_MONTH_FREE} demos por mês para mandar aos clientes, sem cartão.`],
  ["Preciso de chave da OpenAI?", "Não. A IA vem incluída no tamanho do chatbot, com o custo dela por nossa conta."],
  ["E se a cota acabar?", `Só aquele chatbot passa para a sua equipe até o mês virar. Ou ligue o excedente: cada atendimento a mais custa ${brlCents(OVERAGE_PRICE_BRL)}, pago com crédito pré-pago (a partir de ${brl(CREDIT_MIN_BRL)}).`],
  ["Como funciona a cobrança?", "No cartão, todo dia 1º, e o primeiro mês é proporcional. Subir de tamanho vale na hora, pagando só a diferença dos dias que faltam; descer vale no mês seguinte. Sem fidelidade."],
  ["A Meta cobra à parte?", "No WhatsApp, a Meta cobra direto na conta do seu cliente, sem nada nosso em cima. As respostas do atendimento têm 1.000 grátis por mês em cada número; depois, cerca de R$ 0,035 cada. Os lembretes custam cerca de R$ 0,035 e as promoções, cerca de R$ 0,32 (tabela da Meta de outubro de 2026). No Instagram, a Meta não cobra."],
  ["E sem IA?", `O tamanho Atendimento (${brl(BOT_SIZES.atendimento.priceBrl)}/mês) liga o WhatsApp, o Instagram e o chat do site só com a sua equipe respondendo.`],
];

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
            Atendimento automático para os clientes da sua agência, com a sua marca.
          </h1>
          <p className="max-w-[560px] text-lg leading-relaxed text-ink-2">
            Crie um chatbot treinado no site e nos documentos de cada cliente em minutos, coloque o seu logo e cobre o que quiser. Ele atende no site e, em breve, também no WhatsApp oficial e no Instagram Direct do cliente. Nós cuidamos da IA. Você cuida dos clientes.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/cadastro" className="btn-primary px-5 py-3.5 text-base">Criar conta grátis</Link>
            <a href="#como" className="btn-ghost px-4 py-3.5 text-base">Ver como funciona</a>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted"><span>Monte e teste grátis</span><span className="hidden sm:inline">·</span><span>Sem cartão</span><span className="hidden sm:inline">·</span><span>IA incluída</span><span className="hidden sm:inline">·</span><span>Sem fidelidade</span></div>
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
          <h2 className="text-3xl font-bold leading-[1.08] md:text-[44px]">Você paga a partir de {brl(BOT_SIZES.P.priceBrl)} por chatbot com IA. Seus clientes pagam você.</h2>
          <p className="max-w-[520px] text-[17px] leading-relaxed text-[#b9c2bd]">Um atendimento que responde 24 horas, agenda e qualifica leads tem valor para qualquer negócio local. Você define o preço do seu serviço. Seu cliente vê a sua marca no painel, no widget e no chat; só na conexão do WhatsApp e do Instagram as telas da Meta mostram a {brand} como fornecedora da tecnologia.</p>
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
            ["Coloque a sua marca", "Logo, cores, nome do assistente e tom de voz. No painel, no widget e no chat, o cliente vê a sua agência."],
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
          <h2 className="mt-2 text-3xl font-bold leading-[1.1] md:text-[40px]">Conta grátis. Cada chatbot no ar com um tamanho.</h2>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-2">Na conta grátis, você monta os chatbots, testa com até {TEST_ANSWERS_FREE} respostas da IA e gera demos para mandar aos clientes, sem cartão. Para atender no site, no WhatsApp e no Instagram, cada chatbot ganha um tamanho. A IA vem incluída: não precisa de chave nem de conta na OpenAI.</p>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">1 atendimento = 24 horas de conversa da IA com um contato, no site, no WhatsApp ou no Instagram, com até 40 respostas. Respostas da sua equipe não contam. Conectar WhatsApp, Instagram e o chat do site não custa nada a mais: vem com o tamanho do chatbot.</p>
          <p className="mt-2 text-[15px] leading-relaxed text-ink-2">No WhatsApp, a Meta cobra as mensagens direto na conta do seu cliente: as respostas têm 1.000 grátis por mês em cada número, e os lembretes e as promoções são cobrados à parte. As mensagens do Instagram não são cobradas pela Meta.</p>
        </div>
        <div className="grid gap-5 md:grid-cols-4">
          {Object.values(BOT_SIZES).filter((s) => s.atendimentos > 0).map((s) => {
            const featured = s.id === "M";
            return (
              <div key={s.id} className={featured ? "relative flex flex-col gap-4 rounded-2xl bg-brand p-7 text-ground" : "card flex flex-col gap-4 p-7"}>
                {featured && <span className="absolute -top-3 left-7 rounded-full bg-amber px-2.5 py-1 text-xs font-bold uppercase tracking-[0.06em] text-ink">Mais escolhido</span>}
                <div className="display text-xl font-bold">{s.id === "volume" ? "Volume" : `Chatbot ${s.name}`}</div>
                <div className="flex items-baseline gap-1.5">
                  <span className="display text-[40px] font-bold leading-none">{brl(s.priceBrl)}</span>
                  <span className={featured ? "text-sm text-[#c7d9d1]" : "text-sm text-muted"}>{s.id === "volume" ? "/pacote/mês" : "/mês"}</span>
                </div>
                <div className={featured ? "flex flex-col gap-2 text-[15px] text-[#dfe9e4]" : "flex flex-col gap-2 text-[15px] text-ink-2"}>
                  <span>{num(s.atendimentos)} atendimentos/mês{s.id === "volume" ? " por pacote" : ""}</span>
                  <span>{s.description}</span>
                  <span>Sua marca no widget e no painel</span>
                </div>
                <Link href="/cadastro" className={featured ? "btn mt-auto bg-ground text-brand hover:bg-white" : "btn-ghost mt-auto"}>Começar grátis</Link>
              </div>
            );
          })}
        </div>
        <p className="text-[15px] text-ink-2">
          Só a caixa de entrada da equipe, sem IA: tamanho Atendimento, {brl(BOT_SIZES.atendimento.priceBrl)}/mês por chatbot. Pacotes da conta: {Object.values(PACKS).map((p) => `${p.name} ${brl(p.priceBrl)}/mês`).join(" · ")}. Passou da cota? Ligue o excedente, pago com crédito: {brlCents(OVERAGE_PRICE_BRL)} por atendimento a mais.
        </p>
        <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
          {FAQ.map(([q, a]) => (
            <div key={q} className="flex flex-col gap-1.5">
              <div className="font-semibold">{q}</div>
              <p className="text-[15px] leading-relaxed text-ink-2">{a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 pb-20 lg:px-16 xl:px-24">
        <div id="nichos" className="card flex flex-col gap-4 p-7">
          <div className="display text-2xl font-bold">Material de venda pronto, por nicho</div>
          <p className="text-[15px] leading-relaxed text-ink-2">Uma página para cada tipo de cliente, com exemplos de conversa e argumentos. Use para vender.</p>
          <div className="flex flex-wrap gap-2">
            {NICHOS.map((n) => (
              <span key={n} className="rounded-full border border-line bg-ground px-3 py-1.5 text-sm font-medium">{n}</span>
            ))}
          </div>
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
