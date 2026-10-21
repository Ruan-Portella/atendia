import Link from "next/link";
import { Access, DocPage, Example, H2, NextSteps, Note, Route, Table } from "@/components/docs/doc";

export const metadata = { title: "Fontes · API" };

const E = "fontes";

/** /docs/api/fontes: fontes de conhecimento pela API, com o contexto (código em src/lib/api-sources.ts). */
export default function SourcesApiDocs() {
  return (
    <DocPage
      eyebrow="Documentação · API"
      title="Fontes"
      intro="Mande para o chatbot o que ele precisa saber: texto, perguntas frequentes, uma página ou um PDF. Com o contexto, cada documento vale só para quem é dele, como o regulamento de um condomínio para os moradores daquele condomínio."
    >
      <Access permission="sources" />
      <Table
        head={["Rota", "O que faz"]}
        rows={[
          [<Link key="1" href="#criar"><code>POST /v1/bots/{"{id}"}/sources</code></Link>, "Grava a fonte e lê na hora: a resposta já diz quantos trechos entraram."],
          [<Link key="2" href="#listar"><code>GET /v1/bots/{"{id}"}/sources</code></Link>, "As fontes do chatbot, as mais novas primeiro, com o filtro pelo contexto."],
          [<Link key="3" href="#apagar"><code>DELETE /v1/bots/{"{id}"}/sources/{"{source}"}</code></Link>, "Tira a fonte e os trechos dela."],
          [<Link key="4" href="#aviso"><code>PUT /v1/bots/{"{id}"}/notice</code></Link>, "Põe o aviso do momento: um texto com prazo (uma queda, uma manutenção) que a IA usa quando perguntam."],
        ]}
      />

      <H2 id="contexto">Fontes por contexto</H2>
      <p>
        Uma fonte com <code>context</code> (por exemplo <code>{'{"workspace_id": "ws_abc"}'}</code>) vale só nas conversas em que o contexto ativo tem todos esses pares, com o mesmo valor e o mesmo tipo (<code>&quot;42&quot;</code> e <code>42</code> são diferentes). A fonte sem <code>context</code> vale em todas as conversas do chatbot.
      </p>
      <p>
        O contexto ativo vem do <Link href="/docs/identificar-usuarios">token do widget ou do pareamento</Link>, ou do contexto fixo do chatbot (painel, aba Ações), que vai por cima dos outros. Sem nenhum deles, a conversa só usa as fontes gerais. É assim que um SaaS com um chatbot só manda os documentos de cada cliente dele: cada um com o próprio contexto.
      </p>
      <Note>
        A fonte com contexto passa pelo portão de itens proibidos e regulamentados, como as outras, mas não refaz a análise do chatbot (ela é sobre o negócio do chatbot, não sobre os documentos de cada cliente). No painel, a base mostra só a contagem dessas fontes.
      </Note>

      <Route id="criar" method="POST" path="/v1/bots/{id}/sources" />
      <Example page={E} id="texto" />
      <Example page={E} id="pdf" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">kind</code>, <><code>text</code>, <code>faq</code>, <code>page</code> (uma página) ou <code>pdf</code> (por URL). O site inteiro e os posts do Instagram ficam no painel (na lista, aparecem como <code>site</code> e <code>instagram</code>).</>, <>400 <code>kind</code></>],
          [<code key="2">title</code>, "Opcional (até 120 caracteres). Sem ele: Texto, Perguntas frequentes, o domínio da página ou o nome do arquivo.", <>400 <code>title</code></>],
          [<code key="3">content</code>, <>Em <code>text</code> e <code>faq</code>: de 20 a 30 mil caracteres (o corpo vai até 32 KB). Para mais, um PDF por URL.</>, <>400 <code>content</code></>],
          [<code key="4">url</code>, <>Em <code>page</code> e <code>pdf</code>: http ou https. O PDF vai até 15 MB e precisa ter texto (PDF só de imagem não é lido).</>, <>400 <code>url</code>; 422 <code>source_unreadable</code> ou <code>source_too_large</code></>],
          [<code key="5">context</code>, "Opcional: até 5 pares, com chaves de letras, números, _, . e - e valores texto (até 200), número ou verdadeiro/falso.", <>400 <code>context</code></>],
        ]}
      />
      <p>
        Falhou a leitura (a página não abriu, o PDF não tem texto): <code>422 source_unreadable</code>, com o motivo, e a fonte não fica gravada. Até 300 fontes novas por hora com a mesma chave (<code>429 rate_limited</code>). Aceita <Link href="/docs/api#convencoes">Idempotency-Key</Link>.
      </p>

      <Route id="listar" method="GET" path="/v1/bots/{id}/sources" />
      <p>
        <code>context</code> (o JSON da etiqueta) traz só as fontes com essa etiqueta; <code>tagged=false</code>, só as gerais; <code>tagged=true</code>, só as com contexto. Paginação com <code>cursor</code> e <code>limit</code> (até 100), como nas outras listas.
      </p>
      <Example page={E} id="listar" />

      <Route id="apagar" method="DELETE" path="/v1/bots/{id}/sources/{source}" />
      <p>
        Responde 204. Fonte que não é do chatbot, ou id que não é <code>src_…</code>: 404. Quando um cliente sai do seu sistema, apague as fontes do contexto dele.
      </p>
      <Example page={E} id="apagar" />

      <H2 id="aviso">Aviso do momento</H2>
      <p>
        O mesmo aviso do painel (aba Base de conhecimento): um texto com prazo, como &quot;Instabilidade na fibra no bairro Centro; previsão de volta às 18h.&quot;. A IA usa quando o contato pergunta ou quando o assunto tem a ver, nunca como instrução; vencido, some sozinho. Um aviso por chatbot: o novo troca o anterior. Bom para o seu sistema avisar uma queda sem ninguém entrar no painel. Vale também com a permissão <code>provisioning</code>.
      </p>
      <Route id="aviso-por" method="PUT" path="/v1/bots/{id}/notice" />
      <Example page={E} id="aviso" />
      <Table
        head={["Campo", "Regra", "Erro"]}
        rows={[
          [<code key="1">text</code>, "De 5 a 500 caracteres.", <>400 <code>text</code></>],
          [<code key="2">until</code>, <>Data e hora em ISO 8601 com o fuso (<code>2026-10-22T18:00:00-03:00</code> ou com <code>Z</code>), de 10 minutos a 30 dias à frente.</>, <>400 <code>until</code></>],
        ]}
      />
      <Route id="aviso-ler" method="GET" path="/v1/bots/{id}/notice" />
      <p>
        O aviso que vale agora, ou <code>notice: null</code> (sem aviso ou vencido). <code>set_by</code> diz quem pôs: o nome da chave, a agência ou o e-mail de quem é do cliente.
      </p>
      <Example page={E} id="aviso-ler" />
      <Route id="aviso-tirar" method="DELETE" path="/v1/bots/{id}/notice" />
      <Example page={E} id="aviso-tirar" />

      <NextSteps
        items={[
          { href: "/docs/identificar-usuarios", title: "Identificar usuários", text: "O token e o pareamento, que dão o contexto da conversa." },
          { href: "/docs/acoes", title: "Ações", text: "O que as ações recebem do contexto." },
        ]}
      />
    </DocPage>
  );
}
