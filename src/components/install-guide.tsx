"use client";

import { useState } from "react";
import { Check, CheckCircle2, Clock, Copy, ExternalLink } from "lucide-react";
import { cn, relativeTime } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

interface Props {
  widgetSrc: string; // https://dominio/widget.js
  publicKey: string;
  directLink: string; // https://dominio/w/KEY
  brand: string;
  isLive: boolean;
  installed: { host: string; at: string; lastSeen: string | null } | null;
}

type PlatformId = "html" | "nextjs" | "react" | "vue" | "angular" | "wordpress" | "webflow" | "framer" | "wix" | "shopify" | "gtm" | "link";

interface Snippet {
  label: string; // ex.: app/layout.tsx
  code: string;
}
interface Platform {
  id: PlatformId;
  name: string;
  group: "Código" | "Sites prontos" | "Sem site";
  intro: string;
  steps: React.ReactNode[];
  snippets: Snippet[];
  notes?: React.ReactNode[];
}

export function InstallGuide({ widgetSrc, publicKey, directLink, brand, isLive, installed }: Props) {
  const [platform, choose] = useState<PlatformId>("html");

  const tag = `<script src="${widgetSrc}" data-key="${publicKey}" async></script>`;
  const platforms = buildPlatforms({ tag, widgetSrc, publicKey, directLink });
  const current = platforms.find((p) => p.id === platform) ?? platforms[0];
  const groups = ["Sites prontos", "Código", "Sem site"] as const;

  return (
    <div className="flex flex-col gap-5">
      {/* status */}
      <InstallStatus installed={installed} isLive={isLive} />

      <div className="grid gap-5 lg:grid-cols-[210px_minmax(0,1fr)]">
        {/* plataformas */}
        <nav aria-label="Plataforma" className="flex flex-col gap-3">
          {groups.map((g) => (
            <div key={g}>
              <div className="kpi-label mb-1.5 px-2">{g}</div>
              <div className="flex flex-row flex-wrap gap-1 lg:flex-col">
                {platforms.filter((p) => p.group === g).map((p) => (
                  <button key={p.id} type="button" onClick={() => choose(p.id)} aria-pressed={p.id === current.id} className={cn("rounded-lg px-3 py-2 text-left text-sm transition-colors duration-[120ms]", p.id === current.id ? "bg-brand-soft font-semibold text-brand" : "font-medium text-ink-2 hover:bg-ground")}>
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* passo a passo */}
        <div className="flex min-w-0 flex-col gap-4">
          <div>
            <h3 className="display text-lg font-bold">{current.name}</h3>
            <p className="text-sm text-muted">{current.intro}</p>
          </div>
          <ol className="flex flex-col gap-2.5">
            {current.steps.map((s, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-ground">{i + 1}</span>
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ol>
          {current.snippets.map((sn) => (
            <CodeBlock key={sn.label} label={sn.label} code={sn.code} />
          ))}
          {current.notes && current.notes.length > 0 && (
            <div className="flex flex-col gap-1.5 rounded-xl bg-ground px-4 py-3 text-[13px] leading-relaxed text-ink-2">
              {current.notes.map((n, i) => (
                <p key={i}>{n}</p>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* opções e API */}
      <details className="card group px-5 py-4">
        <summary className="cursor-pointer text-sm font-semibold">Personalizar por site e abrir o chat por um botão seu</summary>
        <div className="mt-3 flex flex-col gap-3 text-sm leading-relaxed text-ink-2">
          <p>
            Cor, canto da tela e distância da borda se configuram na aba <strong className="text-ink">Aparência e marca</strong> e valem na hora em todos os sites onde o widget está instalado. Se um site específico precisar de algo diferente, os atributos <code className="rounded bg-ground px-1">data-color=&quot;#hex&quot;</code>, <code className="rounded bg-ground px-1">data-position=&quot;left&quot;</code> e <code className="rounded bg-ground px-1">data-offset=&quot;80&quot;</code> no <code className="rounded bg-ground px-1">&lt;script&gt;</code> têm prioridade sobre o painel. Depois que carrega, o script expõe <code className="rounded bg-ground px-1">window.ChatWidget</code> com <code className="rounded bg-ground px-1">open()</code>, <code className="rounded bg-ground px-1">close()</code> e <code className="rounded bg-ground px-1">toggle()</code>, então qualquer link ou botão do site pode abrir a conversa:
          </p>
          <CodeBlock label="HTML" code={`<a href="#" onclick="window.ChatWidget && ChatWidget.open(); return false;">Fale com a gente</a>`} />
          <CodeBlock label="React / Next.js" code={`<button type="button" onClick={() => window.ChatWidget?.open()}>\n  Fale com a gente\n</button>`} />
          <p className="text-xs text-muted">Em TypeScript, declare uma vez: <code className="rounded bg-ground px-1">declare global {"{"} interface Window {"{"} ChatWidget?: {"{"} open(): void; close(): void; toggle(): void {"}"} {"}"} {"}"}</code></p>
        </div>
      </details>

      {/* problemas comuns */}
      <details className="card px-5 py-4">
        <summary className="cursor-pointer text-sm font-semibold">Instalei e o balão não apareceu</summary>
        <div className="mt-3 flex flex-col gap-2 text-sm leading-relaxed text-ink-2">
          <p><strong className="text-ink">O chatbot está publicado?</strong> Em rascunho ou fora do ar o balão não aparece no site (a instalação ainda é detectada e aparece no cartão acima). Clique em “Publicar” no topo.</p>
          <p><strong className="text-ink">O site foi publicado depois de colar o código?</strong> Webflow, Framer, Wix e Shopify só aplicam o código quando você publica o site de novo. Teste em aba anônima para fugir do cache.</p>
          <p><strong className="text-ink">Bloqueador de anúncios.</strong> Alguns bloqueiam iframes de terceiros. Teste com o bloqueador desligado ou em outro navegador.</p>
          <p><strong className="text-ink">Content-Security-Policy.</strong> Se o site tem CSP, adicione o domínio <code className="rounded bg-ground px-1">{new URL(widgetSrc).origin}</code> em <code className="rounded bg-ground px-1">script-src</code>, <code className="rounded bg-ground px-1">frame-src</code> e <code className="rounded bg-ground px-1">connect-src</code>.</p>
          <p><strong className="text-ink">Console do navegador.</strong> Aperte F12 → Console. Um aviso <code className="rounded bg-ground px-1">[chat-widget]</code> explica o que faltou (normalmente a <code className="rounded bg-ground px-1">data-key</code>).</p>
          <p className="text-xs text-muted">Quando o widget carregar no site do cliente, o cartão no topo desta aba muda para “Instalado em …”. A {brand} não aparece em nenhum lugar para o visitante, nem no código: o script só usa nomes genéricos.</p>
        </div>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------------ */

function InstallStatus({ installed, isLive }: { installed: Props["installed"]; isLive: boolean }) {
  if (installed) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#cfe3d8] bg-brand-soft px-4 py-3 text-sm">
        <CheckCircle2 size={18} className="text-brand" />
        <span className="text-ink-2">
          <strong className="text-brand">Instalado em {installed.host}</strong> · detectado {relativeTime(installed.at)}
          {installed.lastSeen ? ` · último carregamento ${relativeTime(installed.lastSeen)}` : ""}
        </span>
        {!isLive && <span className="ml-auto rounded-full bg-amber-soft px-2 py-0.5 text-xs font-semibold text-amber-ink">ainda não publicado</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
      <Clock size={18} className="text-muted" />
      <span className="text-ink-2">
        <strong className="text-ink">Ainda não detectamos o widget em nenhum site.</strong> Escolha a plataforma abaixo, cole o código e abra o site do cliente: este cartão atualiza sozinho.
      </span>
    </div>
  );
}

function CodeBlock({ label, code }: { label: string; code: string }) {
  const [done, setDone] = useState(false);
  const toast = useToast();
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      toast.error("Não consegui copiar. Selecione o código e use Ctrl+C.");
    }
  }
  return (
    <div className="overflow-hidden rounded-xl bg-ink text-ground">
      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-2 text-xs">
        <span className="font-mono text-[#9aa39e]">{label}</span>
        <button type="button" onClick={copy} className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-semibold text-ground transition-colors duration-[120ms] hover:bg-white/10">
          {done ? <Check size={13} /> : <Copy size={13} />}
          {done ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre className="overflow-auto whitespace-pre-wrap break-words px-4 py-3 text-[12.5px] leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}

function Path({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-ground px-1 text-[12.5px] text-ink">{children}</code>;
}
function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="inline-flex items-center gap-0.5 font-semibold text-brand hover:underline">
      {children}
      <ExternalLink size={12} />
    </a>
  );
}

function buildPlatforms(v: { tag: string; widgetSrc: string; publicKey: string; directLink: string }): Platform[] {
  const { tag, widgetSrc, publicKey, directLink } = v;
  const scriptJsx = (indent: string) => `<Script\n${indent}  src="${widgetSrc}"\n${indent}  data-key="${publicKey}"\n${indent}  strategy="afterInteractive"\n${indent}/>`;

  return [
    /* ---------------- Sites prontos ---------------- */
    {
      id: "wordpress",
      name: "WordPress",
      group: "Sites prontos",
      intro: "Funciona com qualquer tema (Elementor, Divi, Astra…). O jeito mais seguro é um plugin de código; a alternativa é o functions.php do tema.",
      steps: [
        <>Instale e ative o plugin gratuito <Ext href="https://wordpress.org/plugins/insert-headers-and-footers/">WPCode</Ext> (antigo “Insert Headers and Footers”).</>,
        <>No menu do WordPress, vá em <Path>Code Snippets → Header &amp; Footer</Path>.</>,
        <>Cole o código abaixo na caixa <Path>Footer</Path> e clique em <Path>Save Changes</Path>. Pronto, vale para todas as páginas.</>,
        <>Usa Elementor Pro? Também dá em <Path>Elementor → Custom Code → Add New</Path>, local <Path>&lt;/body&gt; – End</Path>.</>,
      ],
      snippets: [
        { label: "Footer (WPCode)", code: tag },
        { label: "Alternativa sem plugin: functions.php do tema filho", code: `add_action('wp_footer', function () {\n  echo '${tag}';\n});` },
      ],
      notes: [<>Plugins de cache (WP Rocket, LiteSpeed) podem segurar a versão antiga da página: limpe o cache depois de salvar.</>],
    },
    {
      id: "webflow",
      name: "Webflow",
      group: "Sites prontos",
      intro: "Código personalizado no Webflow exige um plano de site pago (Basic ou superior). O código entra uma vez e vale para o site inteiro.",
      steps: [
        <>Abra o projeto e vá em <Path>Site settings → Custom code</Path>.</>,
        <>Cole o código na caixa <Path>Footer code</Path> (não no Head code).</>,
        <>Clique em <Path>Save changes</Path> e depois em <Path>Publish</Path>. Sem publicar, nada muda no site ao vivo.</>,
      ],
      snippets: [{ label: "Footer code", code: tag }],
    },
    {
      id: "framer",
      name: "Framer",
      group: "Sites prontos",
      intro: "No Framer o código vai nas configurações do site, e só aparece depois de publicar.",
      steps: [
        <>No projeto, clique na engrenagem <Path>Site Settings</Path> (canto superior direito) → aba <Path>General</Path>.</>,
        <>Role até <Path>Custom Code</Path> e cole o código em <Path>End of &lt;body&gt; tag</Path>.</>,
        <>Salve e clique em <Path>Publish</Path>.</>,
      ],
      snippets: [{ label: "End of <body> tag", code: tag }],
      notes: [<>Custom Code exige um plano de site pago no Framer (Mini ou superior).</>],
    },
    {
      id: "wix",
      name: "Wix",
      group: "Sites prontos",
      intro: "No Wix o código é adicionado pelo painel do site, com plano Premium e domínio conectado.",
      steps: [
        <>No painel do site, vá em <Path>Configurações → Código personalizado</Path> (em “Avançado”).</>,
        <>Clique em <Path>+ Adicionar código personalizado</Path>, cole o código e dê um nome (ex.: “Chat”).</>,
        <>Em “Adicionar código às páginas” escolha <Path>Todas as páginas</Path>; em “Colocar código em” escolha <Path>Body – fim</Path>. Clique em <Path>Aplicar</Path>.</>,
      ],
      snippets: [{ label: "Código personalizado", code: tag }],
    },
    {
      id: "shopify",
      name: "Shopify",
      group: "Sites prontos",
      intro: "Uma linha no arquivo principal do tema resolve para toda a loja.",
      steps: [
        <>No admin, vá em <Path>Loja virtual → Temas</Path>, clique nos três pontos do tema ativo → <Path>Editar código</Path>.</>,
        <>Abra <Path>layout/theme.liquid</Path>.</>,
        <>Cole o código logo antes de <Path>&lt;/body&gt;</Path> (fim do arquivo) e clique em <Path>Salvar</Path>.</>,
      ],
      snippets: [{ label: "layout/theme.liquid · antes de </body>", code: tag }],
      notes: [<>Se a loja usa checkout personalizado (Plus), o widget não aparece no checkout; isso é uma regra da Shopify.</>],
    },
    {
      id: "gtm",
      name: "Google Tag Manager",
      group: "Sites prontos",
      intro: "Se o site já tem o GTM, você instala sem mexer no código do site.",
      steps: [
        <>No GTM, vá em <Path>Tags → Nova</Path> e escolha o tipo <Path>HTML personalizado</Path>.</>,
        <>Cole o código, e em Acionamento escolha <Path>All Pages</Path>.</>,
        <>Salve e clique em <Path>Enviar → Publicar</Path>. Use o modo Visualizar antes, se quiser conferir.</>,
      ],
      snippets: [{ label: "Tag HTML personalizado", code: tag }],
    },

    /* ---------------- Código ---------------- */
    {
      id: "html",
      name: "HTML / site comum",
      group: "Código",
      intro: "Qualquer site que você edita direto no HTML: uma linha antes de fechar o body.",
      steps: [
        <>Abra o arquivo do template ou o <Path>index.html</Path> (e as outras páginas, se cada uma tiver o próprio HTML).</>,
        <>Cole o código logo antes de <Path>&lt;/body&gt;</Path>.</>,
        <>Salve, publique e abra o site: o balão aparece no canto inferior direito.</>,
      ],
      snippets: [{ label: "antes de </body>", code: tag }],
    },
    {
      id: "nextjs",
      name: "Next.js",
      group: "Código",
      intro: "No Next.js não se cola <script> direto no JSX: o lint reclama e o script pode não rodar. Use o componente Script, que carrega depois que a página fica interativa. A data-key passa como atributo normal.",
      steps: [
        <>Importe <Path>Script</Path> de <Path>next/script</Path> no layout raiz (App Router) ou no <Path>_app</Path> (Pages Router).</>,
        <>Coloque o componente dentro do <Path>&lt;body&gt;</Path>, depois de <Path>{"{children}"}</Path>. Assim ele vale para todas as rotas e não recarrega na navegação.</>,
        <>Rode o projeto e abra qualquer página. Em dev, o React Strict Mode monta duas vezes, mas o widget se protege e aparece só um.</>,
      ],
      snippets: [
        {
          label: "app/layout.tsx (App Router)",
          code: `import Script from "next/script";\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return (\n    <html lang="pt-BR">\n      <body>\n        {children}\n        ${scriptJsx("        ")}\n      </body>\n    </html>\n  );\n}`,
        },
        {
          label: "pages/_app.tsx (Pages Router)",
          code: `import type { AppProps } from "next/app";\nimport Script from "next/script";\n\nexport default function App({ Component, pageProps }: AppProps) {\n  return (\n    <>\n      <Component {...pageProps} />\n      ${scriptJsx("      ")}\n    </>\n  );\n}`,
        },
      ],
      notes: [
        <>Quer o chat só em algumas páginas? Coloque o <Path>&lt;Script&gt;</Path> na página em vez do layout. Ele carrega uma vez e continua nas navegações seguintes.</>,
        <>Se preferir não passar atributos, a chave também pode ir na URL: <Path>{`${widgetSrc}?key=${publicKey}`}</Path>.</>,
      ],
    },
    {
      id: "react",
      name: "React (Vite / CRA)",
      group: "Código",
      intro: "Em React puro o lugar certo é o index.html, fora do React. Se precisar controlar por código, há um hook logo abaixo.",
      steps: [
        <>Abra <Path>index.html</Path> na raiz do projeto (Vite) ou em <Path>public/index.html</Path> (Create React App).</>,
        <>Cole o código antes de <Path>&lt;/body&gt;</Path>, depois da <Path>&lt;div id=&quot;root&quot;&gt;</Path>.</>,
        <>Reinicie o servidor de desenvolvimento se ele não recarregar sozinho.</>,
      ],
      snippets: [
        { label: "index.html · antes de </body>", code: tag },
        {
          label: "Alternativa: carregar de um componente (ex.: só na área pública)",
          code: `import { useEffect } from "react";\n\nexport function ChatWidget() {\n  useEffect(() => {\n    const s = document.createElement("script");\n    s.src = "${widgetSrc}";\n    s.async = true;\n    s.dataset.key = "${publicKey}";\n    document.body.appendChild(s);\n  }, []);\n  return null;\n}`,
        },
      ],
    },
    {
      id: "vue",
      name: "Vue / Nuxt",
      group: "Código",
      intro: "Vue com Vite usa o index.html; no Nuxt o script entra pela configuração e vale para todas as páginas.",
      steps: [
        <>Vue (Vite): cole o código em <Path>index.html</Path>, antes de <Path>&lt;/body&gt;</Path>.</>,
        <>Nuxt 3: adicione o script em <Path>nuxt.config.ts</Path>, em <Path>app.head.script</Path>, com <Path>tagPosition: &quot;bodyClose&quot;</Path>.</>,
        <>Reinicie o <Path>nuxt dev</Path> para a configuração valer.</>,
      ],
      snippets: [
        { label: "index.html (Vue + Vite)", code: tag },
        {
          label: "nuxt.config.ts (Nuxt 3)",
          code: `export default defineNuxtConfig({\n  app: {\n    head: {\n      script: [\n        { src: "${widgetSrc}", async: true, "data-key": "${publicKey}", tagPosition: "bodyClose" },\n      ],\n    },\n  },\n});`,
        },
      ],
    },
    {
      id: "angular",
      name: "Angular",
      group: "Código",
      intro: "No Angular o index.html é servido em todas as rotas, então uma linha basta.",
      steps: [
        <>Abra <Path>src/index.html</Path>.</>,
        <>Cole o código antes de <Path>&lt;/body&gt;</Path>, depois de <Path>&lt;app-root&gt;</Path>.</>,
        <>Salve; o <Path>ng serve</Path> recarrega sozinho.</>,
      ],
      snippets: [{ label: "src/index.html · antes de </body>", code: tag }],
    },

    /* ---------------- Sem site ---------------- */
    {
      id: "link",
      name: "Link direto (sem site)",
      group: "Sem site",
      intro: "O chat também funciona como página própria, sem instalar nada: serve para bio do Instagram, mensagem automática do WhatsApp, QR code no balcão ou e-mail de assinatura.",
      steps: [
        <>Copie o link abaixo.</>,
        <>Cole na bio do Instagram (“Tire suas dúvidas”), no Linktree, na resposta automática do WhatsApp Business ou gere um QR code (qualquer gerador gratuito serve).</>,
        <>A página abre em tela cheia, com a marca do cliente, em qualquer celular.</>,
      ],
      snippets: [{ label: "Link do chat", code: directLink }],
    },
  ];
}
