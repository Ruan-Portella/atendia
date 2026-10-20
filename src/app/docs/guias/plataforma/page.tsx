import Link from "next/link";
import { DocPage, Example, H2, NextSteps, Note } from "@/components/docs/doc";

export const metadata = { title: "Guia para plataformas" };

/**
 * Guia rápido do perfil plataforma (D', parte 8): o caminho de uma plataforma com muitas lojas
 * (o piloto de delivery) — o modelo, as lojas pela API, os canais, a equipe, os eventos e o uso.
 */
export default function PlatformGuide() {
  return (
    <DocPage
      eyebrow="Documentação · Guias rápidos"
      title="Guia para plataformas"
      intro="Para quem tem muitas lojas ou clientes parecidos, como uma plataforma de delivery: um modelo com o que todas têm em comum, um chatbot por loja criado pelo seu sistema e cada loja com o próprio WhatsApp, Instagram e equipe."
    >
      <H2 id="pacotes">1. Os pacotes e a chave</H2>
      <ol>
        <li>
          Assine em Cobrança os pacotes <strong>Integrações</strong> (a API) e <strong>Plataforma</strong> (o modelo e as lojas pela API).
        </li>
        <li>
          Em <strong>Integrações</strong> → <strong>Chaves de API</strong>, crie uma chave com escopo de toda a conta e as permissões <code>provisioning</code> e <code>sources</code>. Marque <code>members</code> só se o seu sistema for convidar a equipe das lojas para o portal, e <code>billing</code> só se ele for escolher o tamanho de cada chatbot (subir cobra no cartão da assinatura).
        </li>
      </ol>

      <H2 id="modelo">2. O modelo</H2>
      <p>
        No painel, em <strong>Modelos</strong>, monte o que todas as lojas têm em comum: a personalidade, as instruções, os assuntos do negócio, as ações (por exemplo <code>buscar_cardapio</code> e <code>criar_pedido</code>, que recebem o <code>loja_id</code> do contexto), os roteiros e a base comum. Na aba <strong>Herança</strong>, escolha o que cada loja pode mudar (o nome do assistente, a saudação, a aparência, instruções extras) e copie o id do modelo para a API. Publique: cada publicação vira uma versão, e dá para voltar a uma anterior.
      </p>

      <H2 id="loja">3. Uma loja nova, pelo seu sistema</H2>
      <p>Quando um restaurante entra na sua plataforma, o seu sistema cria o cliente e o chatbot dele:</p>
      <Example page="provisionamento" id="cliente" />
      <Example page="provisionamento" id="chatbot" />
      <p>
        O <code>context</code> (o id da loja) vai em toda chamada de ação e escolhe as fontes da loja; o <code>display</code> (nome, horário, endereço) é o que a IA sabe dela. O <code>external_id</code> deixa repetir com segurança: o mesmo id devolve o que já existe. O <code>widget_key</code> vai no código do chat do site da loja.
      </p>
      <Note>
        Documentos de cada loja (o cardápio em PDF, as regras de entrega) vão como <Link href="/docs/api/fontes">fontes com o contexto</Link> da loja: só as conversas dela usam. A base do modelo fica só com o que vale para todas.
      </Note>

      <H2 id="canais">4. WhatsApp e Instagram de cada loja</H2>
      <p>
        Peça o <Link href="/docs/api/provisionamento#link">link de conexão</Link> e mostre no painel da loja (&quot;Conectar WhatsApp&quot;). Quem abre é o dono do restaurante, com a conta dele na Meta: o número continua dele, e ele paga a Meta direto. Antes de conectar, a loja faz o aceite (inclusive de que as conversas dela vão para a sua plataforma). O canal pede um tamanho no chatbot (Cobrança, ou <code>size</code> com a permissão <code>billing</code>).
      </p>

      <H2 id="equipe">5. A equipe da loja</H2>
      <p>
        A equipe do restaurante atende pelo portal do cliente, com a marca da sua conta: vê só as conversas da loja dela e assume quando a IA chama alguém. Convide pelo painel (página do cliente) ou pela API, com a permissão <code>members</code> (<Link href="/docs/api/provisionamento#equipe">equipe do portal</Link>).
      </p>

      <H2 id="eventos">6. Eventos, pausa e uso</H2>
      <ul>
        <li>
          <strong>Webhooks:</strong> pedido de atendente, lead, mensagens, canal conectado ou caído e conformidade chegam no seu sistema, com o <code>external_id</code> do cliente no envelope (<Link href="/docs/webhooks">Webhooks</Link>).
        </li>
        <li>
          <strong>Pausa:</strong> loja fechada, contrato suspenso ou inadimplência com a sua plataforma: <Link href="/docs/api/provisionamento#pausar">pause o chatbot</Link> (os canais seguem conectados; a equipe responde pelo portal) e retome depois.
        </li>
        <li>
          <strong>Uso:</strong> <Link href="/docs/api/provisionamento#uso">GET /v1/usage</Link> dá os atendimentos, as mensagens, os contatos em campanhas e o custo estimado da Meta por loja, para você cobrar o restaurante como quiser. O BoaVoz nunca cobra o restaurante.
        </li>
        <li>
          <strong>Saída de uma loja:</strong> pause ou desconecte o canal pela API; os dados dela só servem a ela, e a exclusão é no painel. Se o restaurante quiser levar a loja para outra conta do BoaVoz, ele pede ao suporte.
        </li>
      </ul>

      <NextSteps
        items={[
          { href: "/docs/api/provisionamento", title: "Lojas pela API", text: "Todas as rotas: clientes, chatbots, canais, pausa, equipe e uso." },
          { href: "/docs/acoes", title: "Ações", text: "O cardápio e o pedido no sistema da plataforma, com o contexto da loja." },
          { href: "/docs/apps", title: "Chat dentro de apps", text: "O chat da loja no seu app, numa webview." },
        ]}
      />
    </DocPage>
  );
}
