import Link from "next/link";
import { Code, DocPage, H2, H3, Note, NextSteps, Table } from "@/components/docs/doc";

export const metadata = { title: "Mensagens ricas" };

const BUTTONS = `
{
  "type": "buttons",
  "buttons": [
    { "title": "Pedir calabresa", "action": { "name": "adicionar_ao_carrinho", "params": { "item": "101" } } },
    { "title": "Ver cardápio", "id": "ver_cardapio" }
  ]
}
`;

const LIST = `
{
  "type": "list",
  "button": "Ver sabores",
  "items": [
    { "title": "Pizza Calabresa", "description": "R$ 49,90", "action": { "name": "adicionar_ao_carrinho", "params": { "item": "101" } } },
    { "title": "Pizza Marguerita", "description": "R$ 45,90", "action": { "name": "adicionar_ao_carrinho", "params": { "item": "102" } } },
    { "title": "Falar com a loja", "id": "falar_loja" }
  ]
}
`;

const LINK = `
{ "type": "link", "title": "Ver pedido", "url": "https://seu-sistema.com/pedidos/1234" }
`;

const CAROUSEL = `
{
  "type": "carousel",
  "cards": [
    {
      "image": "https://seu-sistema.com/fotos/calabresa.jpg",
      "title": "Pizza Calabresa",
      "text": "R$ 49,90. Calabresa, cebola e azeitona.",
      "buttons": [{ "title": "Pedir este", "action": { "name": "adicionar_ao_carrinho", "params": { "item": "101" } } }]
    },
    {
      "image": "https://seu-sistema.com/fotos/marguerita.jpg",
      "title": "Pizza Marguerita",
      "text": "R$ 45,90. Tomate, muçarela e manjericão.",
      "buttons": [{ "title": "Pedir este", "action": { "name": "adicionar_ao_carrinho", "params": { "item": "102" } } }]
    }
  ]
}
`;

const API = `
curl https://boavoz.com/api/v1/messages \\
  -H "Authorization: Bearer bv_live_…" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: 6f1d…" \\
  -d '{
    "bot_id": "bot_…",
    "to": "phone:5511999990000",
    "type": "text",
    "text": "Quer receber o cardápio do dia?",
    "components": {
      "type": "buttons",
      "buttons": [{ "title": "Sim, quero", "id": "quero_cardapio" }, { "title": "Agora não", "id": "agora_nao" }]
    }
  }'
`;

/** Botões, lista, link e carrossel (spec Peça 5). */
export default function RichMessagesDocs() {
  return (
    <DocPage
      title="Mensagens ricas"
      intro="Botões, lista, link e carrossel num formato só. O BoaVoz converte para o WhatsApp, o Instagram e o chat do site, e cai para texto numerado onde o canal não mostra o recurso."
    >
      <H2 id="quem-usa">Quem usa</H2>
      <ul>
        <li>
          <strong>A IA</strong>, sozinha, em todo chatbot com IA: mostra opções quando a pessoa precisa escolher e um botão de link quando a resposta é abrir uma página da base.
        </li>
        <li>
          <strong>As suas ações</strong>, no campo <code>components</code> do retorno (veja <Link href="/docs/acoes">Ações</Link>).
        </li>
        <li>
          <strong>A API</strong>, no <code>POST /v1/messages</code>, junto de um texto.
        </li>
      </ul>
      <p>Um componente por mensagem.</p>

      <H2 id="formatos">Formatos</H2>
      <H3 id="buttons">buttons</H3>
      <p>De 1 a 3 botões, título até 20 caracteres.</p>
      <Code lang="json" code={BUTTONS} />
      <H3 id="list">list</H3>
      <p>
        De 1 a 10 itens: título até 24 caracteres e <code>description</code> opcional até 72. <code>button</code> (opcional, até 20) é o rótulo do botão que abre a lista no WhatsApp.
      </p>
      <Code lang="json" code={LIST} />
      <H3 id="link">link</H3>
      <p>Título até 20 caracteres e um endereço HTTPS (link de WhatsApp ou de DM não vale: a conversa já é por ali).</p>
      <Code lang="json" code={LINK} />
      <H3 id="carousel">carousel</H3>
      <p>
        De 1 a 10 cards. Cada card tem <code>image</code> ou <code>video</code> (HTTPS), <code>title</code> (até 80) e/ou <code>text</code> (até 300), e os botões: <code>buttons</code> com 1 ou 2 de resposta, ou <code>link</code> com um botão de link (<code>{`{title, url}`}</code>). Todos os cards precisam ter o mesmo tipo e a mesma quantidade de botões: é regra do WhatsApp.
      </p>
      <Code lang="json" code={CAROUSEL} />

      <H2 id="canais">Como fica em cada canal</H2>
      <Table
        head={["", "WhatsApp", "Instagram", "Site"]}
        rows={[
          ["buttons", "Botões de resposta", "Respostas rápidas e o resumo numerado", "Botões"],
          ["list", "Lista que abre pelo botão", "Respostas rápidas (até 13) e o resumo numerado", "Botões"],
          ["link", "Botão que abre o link", "O link no texto", "Botão"],
          ["carousel", "Carrossel de mídia; com 1 card, mensagem com a imagem em cima", "Cards com foto (só no app) e o resumo numerado", "Cards que rolam para o lado"],
        ]}
      />
      <ul>
        <li>
          <strong>WhatsApp, carrossel:</strong> o texto do card leva o título no começo e é cortado em 160 caracteres (no fim de uma palavra), com até 2 quebras de linha.
        </li>
        <li>
          <strong>Instagram pelo computador:</strong> respostas rápidas e cards não aparecem no instagram.com. Por isso o resumo numerado das opções vai sempre numa mensagem própria, e a pessoa pode responder com o número.
        </li>
        <li>
          <strong>Site:</strong> só a última mensagem aceita toque, e o primeiro toque desativa os botões dela.
        </li>
      </ul>

      <H2 id="clique">O que acontece no toque</H2>
      <Table
        head={["Botão", "Efeito"]}
        rows={[
          [
            "Sem action",
            <>O toque volta para a IA como mensagem do contato, com o título do botão (no carrossel, com o nome do card: “Pedir este: Pizza Calabresa”). O seu <code key="i">id</code> volta no webhook <code key="w">message.received</code>, em <code key="x">interactive.id</code>.</>,
          ],
          [
            "Com action",
            "Chama a ação direto, sem passar pela IA, com os parâmetros fixos do botão. O toque vale como confirmação, mesmo numa executa. Os parâmetros ficam guardados no BoaVoz e o canal recebe só uma referência, que ninguém consegue forjar.",
          ],
        ]}
      />
      <ul>
        <li>Botão com ação vale por 24 horas. Uso único só nas ações executa ou de pedido: assim o segundo toque em “adicionar” coloca a segunda pizza.</li>
        <li>A ação precisa existir no chatbot, estar ativa e receber parâmetros válidos para o schema dela.</li>
      </ul>
      <Note title="Pedido só em buttons">
        Ação que cria pedido, reserva ou cobrança só vai em <code>buttons</code> (até 3, numa mensagem com texto). Em <code>list</code> e <code>carousel</code>, ela é recusada. O caminho é o card ou o item chamar uma ação que adiciona ao carrinho, e o <code>reply</code> dela trazer o resumo com o botão “Finalizar pedido”.
      </Note>

      <H2 id="portao">WhatsApp e Instagram: o portão</H2>
      <ul>
        <li>Opção, item ou card com produto proibido pela Meta sai.</li>
        <li>Com bebida alcoólica ou remédio, sai para quem não confirmou 18 anos, e entra o botão “Ver opções 18+” (no carrossel, numa mensagem logo depois).</li>
        <li>Pela API, o BoaVoz nunca edita: o envio é recusado com 422 <code>prohibited_content</code>, apontando o campo.</li>
      </ul>

      <H2 id="api">Pela API</H2>
      <p>
        No <code>POST /v1/messages</code>, <code>components</code> vai com <code>{`"type": "text"`}</code> e o texto até 1.024 caracteres. Formato fora das regras: 400 <code>invalid_request</code>, com o <code>field</code> do problema (por exemplo, <code>components.cards[1].buttons</code>).
      </p>
      <Code lang="bash" code={API} />
      <Note title="Janela de 24 horas">
        No WhatsApp e no Instagram, mensagem com componentes só vai dentro de 24 horas da última mensagem da pessoa. Fora disso, só modelo aprovado pela Meta.
      </Note>

      <NextSteps
        items={[
          { href: "/docs/acoes", title: "Ações", text: "O retorno das ações, com components, reply e arquivos." },
          { href: "/docs/comeco-rapido", title: "Primeira ação", text: "Sua primeira ação em 5 minutos." },
        ]}
      />
    </DocPage>
  );
}
