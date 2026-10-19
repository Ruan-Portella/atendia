import Link from "next/link";
import { DocPage, Example, H2, NextSteps, Note } from "@/components/docs/doc";

export const metadata = { title: "Guia para devs" };

/** Guia rápido do perfil dev (Entrada e docs, parte 2): a chave, a primeira mensagem pela API e os eventos no seu sistema. */
export default function DevGuide() {
  return (
    <DocPage eyebrow="Documentação · Guias rápidos" title="Guia para devs" intro="A primeira mensagem pela API e os eventos chegando no seu sistema, em poucos minutos.">
      <H2 id="chave">1. A chave da API</H2>
      <ol>
        <li>
          No primeiro acesso, escolha <strong>Para integrar pela API</strong>. Crie um chatbot e conecte o WhatsApp dele (ou use o chat do site para testar).
        </li>
        <li>
          Assine o pacote <strong>Integrações</strong> em Cobrança: sem ele, a API responde <code>403 plan_not_allowed</code>.
        </li>
        <li>
          Em <strong>Integrações</strong> → <strong>Chaves de API</strong>, crie uma chave com o chatbot e a permissão <code>messages</code>. Ela aparece uma vez só: guarde na variável de ambiente <code>BOAVOZ_API_KEY</code>.
        </li>
      </ol>
      <Note>Nunca use a chave no navegador ou num app: ela vale para tudo o que o escopo dela alcança.</Note>

      <H2 id="primeira">2. A primeira mensagem</H2>
      <p>
        Mande um “oi” do seu celular para o número do chatbot (isso abre a janela de 24 horas do WhatsApp) e rode:
      </p>
      <Example page="mensagens" id="texto" />
      <p>
        Troque o <code>bot_id</code> pelo do seu chatbot (<code>bot_</code> seguido do id que aparece no endereço dele no painel, depois de <code>/painel/bots/</code>) e o número pelo seu, com 55 e DDD. Fora da janela de 24 horas, só sai <Link href="/docs/api/mensagens#enviar">modelo aprovado</Link>.
      </p>

      <H2 id="eventos">3. Os eventos no seu sistema</H2>
      <p>
        Em <strong>Integrações</strong> → <strong>Webhooks</strong>, cadastre a URL do seu sistema e escolha os eventos (mensagem recebida, lead, pedido de atendente…). Cada entrega vem assinada: confira a assinatura antes de usar o corpo. O botão <strong>Testar</strong> manda um evento de exemplo.
      </p>

      <H2 id="postman">4. Teste tudo no Postman</H2>
      <p>
        <a href="/docs/postman/boavoz-api.postman_collection.json">Baixe a coleção</a> e <a href="/docs/postman/boavoz.postman_environment.json">o ambiente</a>, importe os dois no Postman e preencha <code>api_key</code>, <code>bot_id</code> e <code>phone</code>. Cada requisição confere a resposta sozinha; os exemplos desta documentação saem da mesma fonte.
      </p>

      <NextSteps
        items={[
          { href: "/docs/api", title: "API", text: "Chave, convenções, erros e uma página por assunto." },
          { href: "/docs/webhooks", title: "Webhooks", text: "Os eventos, o envelope, a assinatura e as novas tentativas." },
          { href: "/docs/acoes", title: "Ações", text: "A IA chama o seu sistema no meio da conversa." },
          { href: "/docs/comeco-rapido", title: "Primeira ação", text: "Uma ação de consulta funcionando em 5 minutos." },
        ]}
      />
    </DocPage>
  );
}
