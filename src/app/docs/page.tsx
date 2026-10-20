import Link from "next/link";
import { DocPage, H2, Note, NextSteps, Table } from "@/components/docs/doc";

// o modelo de título do layout vale para as páginas filhas, não para esta (mesmo segmento)
export const metadata = { title: { absolute: "Documentação · BoaVoz" } };

/** Entrada da documentação: o que dá para integrar, em que pacote, e por onde começar. */
export default function DocsHome() {
  return (
    <DocPage
      title="Integrações do BoaVoz"
      intro="O assistente do BoaVoz responde no WhatsApp, no Instagram e no site. Com as Integrações, ele consulta e faz coisas no sistema do seu cliente durante a conversa, manda botões, listas e carrosséis, e avisa o seu sistema do que acontece."
    >
      <H2 id="guias">Por onde começar</H2>
      <NextSteps
        items={[
          { href: "/docs/guias/agencia", title: "Para agências", text: "Do cadastro ao chat no site e no WhatsApp do cliente, com a sua marca." },
          { href: "/docs/guias/negocio", title: "Para o seu negócio", text: "O assistente do seu negócio no site, no WhatsApp e no Instagram." },
          { href: "/docs/guias/dev", title: "Para devs", text: "A chave, a primeira mensagem pela API e os eventos no seu sistema." },
          { href: "/docs/guias/plataforma", title: "Para plataformas", text: "Um modelo e um chatbot por loja, criado pelo seu sistema." },
        ]}
      />

      <H2 id="o-que-da-para-fazer">O que dá para fazer</H2>
      <Table
        head={["Recurso", "Para quê"]}
        rows={[
          [<Link key="a" href="/docs/acoes">Ações</Link>, "Um endpoint seu que a IA chama na conversa: consultar pedido, agenda ou saldo; criar pedido ou agendar, com o Confirmar do contato."],
          [<Link key="r" href="/docs/roteiros">Roteiros</Link>, "Passos que a IA segue num assunto (segunda via, suporte): dado conferido, botões, a sua ação no passo, a identificação da pessoa e a foto pedida."],
          [<Link key="m" href="/docs/mensagens-ricas">Mensagens ricas</Link>, "Botões, lista, link e carrossel, num formato só, convertidos para cada canal. Um botão pode chamar uma ação direto, sem a IA."],
          [<Link key="w" href="/docs/webhooks">Webhooks</Link>, "Seu sistema fica sabendo na hora: mensagem recebida ou enviada, lead, pedido de atendente, aceite de novidades e mais."],
          [<Link key="api" href="/docs/api">API</Link>, "Enviar mensagens e campanhas, ler conversas, leads e contatos, pausar a IA numa conversa."],
          [<Link key="p" href="/docs/api/provisionamento">Lojas pela API</Link>, "Para plataformas: o cliente e o chatbot de cada loja a partir de um modelo, com o link de conexão, a equipe, a pausa e o uso."],
          [<Link key="ap" href="/docs/apps">Chat dentro de apps</Link>, "O chat do site numa webview do seu app, com a pessoa identificada."],
        ]}
      />

      <H2 id="pacotes">Em que pacote</H2>
      <p>
        Ações na conversa, webhooks, a API e a identificação de usuários são o pacote <strong>Integrações</strong> (R$ 49 por mês, por conta). Sem ele, dá para cadastrar ações e webhooks e conferir cada um pelo botão Testar; a IA não usa as ações, os webhooks não entregam e a API responde <code>403 plan_not_allowed</code>. O pacote <strong>Plataforma</strong> (R$ 199 por mês, exige o Integrações) libera o segredo de identidade para todas as lojas, o chatbot modelo e as lojas pela API.
      </p>

      <H2 id="onde-configurar">Onde configurar</H2>
      <ul>
        <li>
          <strong>Ações:</strong> no painel, abra o chatbot e vá na aba <strong>Ações</strong>. Quem cadastra é o dono ou o administrador da agência (com a verificação em duas etapas).
        </li>
        <li>
          <strong>Webhooks, chaves de API e logs:</strong> menu <strong>Integrações</strong> do painel.
        </li>
      </ul>
      <Note title="Antes de ligar no WhatsApp ou no Instagram">
        Nesses canais, o BoaVoz confere tudo o que sai para o contato pelas regras da Meta: itens proibidos não saem, e bebida alcoólica e remédio só aparecem para quem confirmou ter 18 anos. Isso vale também para o que a sua ação devolve. No site, essa trava não se aplica.
      </Note>

      <H2 id="comece">Comece por aqui</H2>
      <NextSteps
        items={[
          { href: "/docs/comeco-rapido", title: "Primeira ação", text: "Sua primeira ação funcionando em 5 minutos: consultar um pedido." },
          { href: "/docs/acoes", title: "Ações", text: "O que o BoaVoz manda, o que ele aceita de volta, assinatura, prazos e o Confirmar." },
          { href: "/docs/mensagens-ricas", title: "Mensagens ricas", text: "Botões, lista, link e carrossel, e como ficam em cada canal." },
          { href: "/docs/webhooks", title: "Webhooks", text: "Os eventos, o envelope, a assinatura e as novas tentativas." },
          { href: "/docs/api", title: "API", text: "Chave, convenções e erros, e uma página por assunto com exemplos em cURL e JavaScript." },
          { href: "/docs/seguranca", title: "Segurança", text: "Autorizar pelo contato verificado, segredos e LGPD." },
        ]}
      />
    </DocPage>
  );
}
