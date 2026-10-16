import Link from "next/link";
import { DocPage, H2, Note, NextSteps, Table } from "@/components/docs/doc";

// o modelo de título do layout vale para as páginas filhas, não para esta (mesmo segmento)
export const metadata = { title: { absolute: "Documentação · BoaVoz" } };

/** Entrada da documentação: o que dá para integrar, em que plano, e por onde começar. */
export default function DocsHome() {
  return (
    <DocPage
      title="Integrações do BoaVoz"
      intro="O assistente do BoaVoz responde no WhatsApp, no Instagram e no site. Com as Integrações, ele consulta e faz coisas no sistema do seu cliente durante a conversa, manda botões, listas e carrosséis, e avisa o seu sistema do que acontece."
    >
      <H2 id="o-que-da-para-fazer">O que dá para fazer</H2>
      <Table
        head={["Recurso", "Para quê"]}
        rows={[
          [<Link key="a" href="/docs/acoes">Ações</Link>, "Um endpoint seu que a IA chama na conversa: consultar pedido, agenda ou saldo; criar pedido ou agendar, com o Confirmar do contato."],
          [<Link key="m" href="/docs/mensagens-ricas">Mensagens ricas</Link>, "Botões, lista, link e carrossel, num formato só, convertidos para cada canal. Um botão pode chamar uma ação direto, sem a IA."],
          [<Link key="w" href="/docs/webhooks">Webhooks</Link>, "Seu sistema fica sabendo na hora: mensagem recebida ou enviada, lead, pedido de atendente, aceite de novidades e mais."],
          [<Link key="api" href="/docs/api">API</Link>, "Enviar mensagens e campanhas, ler conversas, leads e contatos, pausar a IA numa conversa."],
        ]}
      />

      <H2 id="planos">Em que plano</H2>
      <p>
        As Integrações estão nos planos <strong>Agência</strong> e <strong>Escala</strong>. O Freelancer não tem. No teste grátis, dá para cadastrar ações de consulta e criar chaves de API com as permissões de conversas, contatos e pareamento; enviar mensagens e campanhas pela API e as ações que criam, alteram ou cancelam ficam para depois da assinatura.
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
          { href: "/docs/comeco-rapido", title: "Começo rápido", text: "Sua primeira ação funcionando em 5 minutos: consultar um pedido." },
          { href: "/docs/acoes", title: "Ações", text: "O que o BoaVoz manda, o que ele aceita de volta, assinatura, prazos e o Confirmar." },
          { href: "/docs/mensagens-ricas", title: "Mensagens ricas", text: "Botões, lista, link e carrossel, e como ficam em cada canal." },
          { href: "/docs/webhooks", title: "Webhooks", text: "Os eventos, o envelope, a assinatura e as novas tentativas." },
          { href: "/docs/api", title: "Referência da API", text: "Rotas, permissões, erros, paginação e idempotência." },
          { href: "/docs/seguranca", title: "Segurança", text: "Autorizar pelo contato verificado, segredos e LGPD." },
        ]}
      />
    </DocPage>
  );
}
