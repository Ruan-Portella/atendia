import Link from "next/link";
import { DocPage, H2, Note, NextSteps, Table } from "@/components/docs/doc";

export const metadata = { title: "Conceitos" };

/** Conceitos (spec "Modelo central"): identidade, contexto, ferramentas, eventos e API; janela de 24 h. */
export default function ConceptsDocs() {
  return (
    <DocPage
      title="Conceitos"
      intro="Cinco ideias explicam as Integrações: quem é o contato, em que conta ele está, o que a IA pode fazer, o que o seu sistema fica sabendo e o que ele pode pedir."
    >
      <H2 id="estrutura">Agência, cliente e chatbot</H2>
      <p>
        A agência atende vários <strong>clientes</strong> (os negócios). Cada cliente tem um ou mais <strong>chatbots</strong>, e cada chatbot responde em até três canais: o chat do site, o WhatsApp e o Instagram. Ações são cadastradas por chatbot; webhooks e chaves de API são da agência, com escopo (todos os chatbots, os de um cliente ou alguns).
      </p>

      <H2 id="identidade">Identidade: quem é o contato</H2>
      <Table
        head={["Nível", "Como o BoaVoz sabe", "Exemplo de uso"]}
        rows={[
          [<strong key="a">anônimo</strong>, "Ninguém garante: o visitante do site.", "Cardápio, horários, preços."],
          [<strong key="c">canal</strong>, "A Meta garante o número no WhatsApp e a conta no Instagram.", "Status do pedido do telefone que está falando."],
          [<strong key="u">usuário</strong>, "A empresa identificou a pessoa: token assinado no site ou no app, ou pareamento no WhatsApp ou no Instagram.", "Saldo, segunda via, dados da conta."],
        ]}
      />
      <p>
        Cada ação tem um nível mínimo: abaixo dele, a IA nem vê a ação. O que a pessoa digita (nome, CPF, número de pedido) nunca sobe o nível.
      </p>

      <H2 id="contexto">Contexto: em que conta ele está</H2>
      <p>
        Uma pessoa pode ter várias contas no seu sistema (duas lojas, um workspace da família e um da empresa). O <strong>contexto</strong> é a conta ativa da conversa, assinado pela empresa (no token ou no pareamento). Ele vai para as ações no campo <code>context</code> e nunca para a IA, que vê só o nome de exibição. Trocar de contexto abre um trecho novo da conversa: a IA só lê o que veio depois.
      </p>

      <H2 id="ferramentas">Ferramentas: o que a IA pode fazer</H2>
      <p>A IA de todo chatbot tem ferramentas próprias do BoaVoz:</p>
      <ul>
        <li>registrar o contato de quem quer comprar, agendar ou orçar (lead, um por contato);</li>
        <li>chamar alguém da equipe (com prioridade em risco à vida);</li>
        <li>registrar a pergunta que a base não respondeu, para a equipe completar;</li>
        <li>mostrar opções e botão de link;</li>
        <li>pedir a confirmação de 18 anos no WhatsApp e no Instagram.</li>
      </ul>
      <p>
        As suas <Link href="/docs/acoes">ações</Link> entram ao lado delas. Os nomes das ferramentas do BoaVoz e o prefixo <code>boavoz_</code> são reservados, então uma ação nunca substitui o caminho para a equipe.
      </p>

      <H2 id="eventos">Eventos: o que o seu sistema fica sabendo</H2>
      <p>
        Os <Link href="/docs/webhooks">webhooks</Link> avisam na hora: mensagens, leads, pedidos de atendente, aceite de novidades, vínculos, canal, modelos, campanhas e conformidade.
      </p>

      <H2 id="api">API: o que o seu sistema pode pedir</H2>
      <p>
        A <Link href="/docs/api">API</Link> envia mensagens e campanhas, lê conversas, contatos e leads, pausa a IA numa conversa para o seu sistema responder e liga contatos às contas do seu sistema.
      </p>

      <H2 id="janela">A janela de 24 horas</H2>
      <p>
        No WhatsApp e no Instagram, mensagem livre (texto, botões, carrossel, arquivo) só sai até 24 horas depois da última mensagem do contato. Fora da janela:
      </p>
      <ul>
        <li>no WhatsApp, só modelo aprovado pela Meta (é o que as campanhas e os lembretes usam);</li>
        <li>no Instagram, a equipe ainda pode responder pelo painel por até 7 dias (tag de atendimento humano da Meta); a IA e a API não.</li>
      </ul>
      <p>
        No WhatsApp, a resposta dentro da janela é uma mensagem de serviço: desde 01/10/2026, a Meta dá 1.000 por mês em cada número e cobra as seguintes (cerca de R$ 0,035 cada no Brasil), direto na conta do negócio. No Instagram, a Meta não cobra.
      </p>
      <p>No chat do site, não há janela.</p>

      <H2 id="regras-meta">As regras da Meta</H2>
      <p>
        No WhatsApp e no Instagram, o BoaVoz confere tudo o que sai, venha da IA, das ações ou da API: produtos proibidos pela Meta não saem; bebida alcoólica e remédio só aparecem para quem confirmou ter 18 anos, e a venda deles nunca fecha no chat (vai para o site, o app ou o telefone do negócio). No site, essa trava não se aplica.
      </p>
      <Note title="Aceite do negócio">
        Antes de conectar o WhatsApp ou o Instagram, o negócio aceita os termos de uso daquele canal. Sem o aceite, o conteúdo das conversas desses canais não sai pela API nem pelos webhooks.
      </Note>

      <NextSteps
        items={[
          { href: "/docs/comeco-rapido", title: "Primeira ação", text: "Sua primeira ação em 5 minutos." },
          { href: "/docs/seguranca", title: "Segurança", text: "Como autorizar pelo contato verificado." },
        ]}
      />
    </DocPage>
  );
}
