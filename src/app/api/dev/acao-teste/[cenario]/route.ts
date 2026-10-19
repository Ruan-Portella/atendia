import { createHash } from "node:crypto";
import { Webhook } from "standardwebhooks";
import { createAdminClient } from "@/lib/supabase/admin";
import { botActionSecrets } from "@/lib/actions";

/*
 * Endpoint de exemplo para testar as ações na dev (C pública, parte 5a): faz o papel do sistema do
 * cliente. Não existe em produção (404). Só responde a chamada assinada com o segredo de ações do
 * chatbot (como um endpoint de verdade faria) e segue o contrato de repetição: o mesmo call_id
 * devolve o mesmo corpo. Cenários (o último pedaço da URL):
 *   cardapio        consulta: itens com id e nome (inclui uma cerveja, para o portão de pedidos)
 *   cardapio-botoes consulta: os mesmos itens e uma lista com "adicionar" em cada um (botão com ação
 *                   adicionar_ao_carrinho, params {item})
 *   carrossel       consulta: os mesmos itens em carrossel (foto, preço e o botão "Pedir este", com ação
 *                   adicionar_ao_carrinho); a cerveja testa o portão card a card
 *   carrossel-links consulta: o carrossel com um botão de link em cada card ("Ver no site")
 *   carrinho        consulta (adicionar_ao_carrinho): reply com o item e os botões "Finalizar pedido"
 *                   (botão com ação criar_pedido) e "Ver cardápio" (sem ação: volta para a IA)
 *   pdf             consulta: data e um anexo PDF (cardapio.pdf)
 *   foto            consulta: reply e um anexo PNG (sai como imagem)
 *   anexos-varios   consulta: PDF (documento), XML (link de 7 dias), "promocao-cerveja.pdf" (barrado no
 *                   WhatsApp e no Instagram sem 18+) e uma URL quebrada ("Não consegui anexar")
 *   ok              executa: {data: {pedido, status}}; na prévia, confirmation {summary, items, total_cents}
 *   reply           executa: {reply} (texto exato, sem IA)
 *   vazio           executa: 200 sem corpo (sucesso)
 *   nao-encontrado  404 {"error": "item esgotado"}
 *   erro            500
 *   lento           a primeira tentativa demora 25 s (o BoaVoz desiste em 20 s: incerto); "Tentar de novo" responde ok
 *   em-andamento    409 {"error": "in_progress"} na primeira; depois, ok
 *   segunda-via     consulta do roteiro (B2', parte 2b), com o parâmetro documento (o BoaVoz preenche
 *                   com o CPF do roteiro, só os números): 529.982.247-25 tem um boleto em aberto (data e
 *                   o PDF); 111.444.777-35 não tem nada em aberto (outcome sem_debito); outro CPF, 404
 *   identificar     consulta do roteiro que identifica a pessoa (B2', parte 2c), com o parâmetro
 *                   documento: 529.982.247-25 é "Cliente Teste" com 2 contas (identity com accounts);
 *                   111.444.777-35 é "Pessoa Teste" com 1 conta; outro CPF, 404
 *   fatura          consulta que usa a conta da conversa (context.data.uc, do identity acima): a
 *                   fatura da conta; sem conta identificada, 404
 *   chamado         consulta do roteiro com passo de foto (B2', parte 2d), com o parâmetro
 *                   foto_roteador (o BoaVoz preenche com a descrição da foto): abre um chamado de teste
 *                   e devolve o que recebeu da foto; sem a descrição, 404
 */

export const maxDuration = 60;

const CARDAPIO = [
  { id: "101", nome: "Pizza Calabresa", preco: "R$ 49,90" },
  { id: "102", nome: "Pizza Marguerita", preco: "R$ 45,90" },
  { id: "201", nome: "Coca-Cola 2L", preco: "R$ 12,00" },
  { id: "202", nome: "Cerveja Heineken 600ml", preco: "R$ 14,00" },
];

// contas de teste da identificação pelo roteiro (B2', parte 2c)
const CONTAS = [
  { cliente: "cli_teste_1", uc: "1001", endereco: "Rua das Flores, 10", valor: "R$ 132,40" },
  { cliente: "cli_teste_1", uc: "1002", endereco: "Av. Brasil, 200", valor: "R$ 87,15" },
  { cliente: "cli_teste_2", uc: "2001", endereco: "Rua do Sol, 5", valor: "R$ 45,00" },
];

const json = (status: number, body: unknown) => Response.json(body, { status });

// arquivos públicos de teste (os mesmos da coleção do Postman)
const PDF = "https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf";
const PNG = "https://placehold.co/600x400.png";
const XML = "https://www.w3.org/2001/xml.xsd";

export async function POST(req: Request, { params }: { params: Promise<{ cenario: string }> }) {
  if (process.env.VERCEL_ENV === "production") return new Response("Not found", { status: 404 });
  const { cenario } = await params;
  const raw = await req.text();
  let body: { call_id?: string; mode?: string; params?: Record<string, unknown>; bot?: { id?: string } };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return json(400, { error: "corpo não é JSON" });
  }

  // a assinatura, como no endpoint de um cliente (segredo de ações do chatbot, até 5 minutos)
  const db = createAdminClient();
  const botId = String(body.bot?.id ?? "").replace(/^bot_/, "");
  const secrets = /^[0-9a-f-]{36}$/.test(botId) ? await botActionSecrets(db, botId) : [];
  const headers = Object.fromEntries(req.headers.entries());
  const signed = secrets.some((s) => {
    try {
      new Webhook(s).verify(raw, headers);
      return true;
    } catch {
      return false;
    }
  });
  if (!signed) return json(401, { error: "assinatura inválida ou fora do prazo de 5 minutos" });

  const callId = String(body.call_id ?? "");
  const order = `T-${createHash("sha256").update(callId).digest("hex").slice(0, 6).toUpperCase()}`;
  const items = (Array.isArray(body.params?.itens) ? body.params.itens : []).map((id) => CARDAPIO.find((c) => c.id === String(id))?.nome ?? `item ${String(id)}`);
  // já houve tentativa com este call_id (incerta): o "Tentar de novo" responde na hora
  const repeated = async () => Boolean((await db.from("action_calls").select("id").eq("call_id", callId).limit(1)).data?.length);

  if (cenario === "cardapio") return json(200, { data: { itens: CARDAPIO } });
  if (cenario === "identificar") {
    const doc = String(body.params?.documento ?? "");
    if (doc === "52998224725")
      return json(200, {
        data: { cliente: "Cliente Teste", contas: 2 },
        identity: { external_id: "cli_teste_1", name: "Cliente Teste", accounts: CONTAS.filter((c) => c.cliente === "cli_teste_1").map((c) => ({ label: c.endereco, context: { uc: c.uc } })) },
      });
    if (doc === "11144477735")
      return json(200, {
        data: { cliente: "Pessoa Teste", contas: 1 },
        identity: { external_id: "cli_teste_2", name: "Pessoa Teste", accounts: CONTAS.filter((c) => c.cliente === "cli_teste_2").map((c) => ({ label: c.endereco, context: { uc: c.uc } })) },
      });
    return json(404, { error: "documento não encontrado" });
  }
  if (cenario === "chamado") {
    const foto = String(body.params?.foto_roteador ?? "").trim();
    if (!foto) return json(404, { error: "sem a descrição da foto" });
    return json(200, { data: { protocolo: `CH-${createHash("sha256").update(callId).digest("hex").slice(0, 6).toUpperCase()}`, foto_recebida: foto.slice(0, 200), previsao: "um técnico liga em até 4 horas" } });
  }
  if (cenario === "fatura") {
    const uc = String((body as { context?: { data?: { uc?: unknown } } | null }).context?.data?.uc ?? "");
    const conta = CONTAS.find((c) => c.uc === uc);
    if (!conta) return json(404, { error: "sem conta identificada" });
    return json(200, { data: { uc: conta.uc, endereco: conta.endereco, vencimento: "25/10/2026", valor: conta.valor } });
  }
  if (cenario === "segunda-via") {
    const doc = String(body.params?.documento ?? "");
    if (doc === "52998224725") return json(200, { data: { vencimento: "25/10/2026", valor: "R$ 189,90", linha_digitavel: "34191.79001 01043.510047 91020.150008 1 10010000018990" }, attachments: [{ url: PDF, filename: "segunda-via.pdf" }] });
    if (doc === "11144477735") return json(200, { data: { mensagem: "Nenhuma conta em aberto para este documento." }, outcome: "sem_debito" });
    return json(404, { error: "documento não encontrado" });
  }
  if (cenario === "pdf") return json(200, { data: { mensagem: "O cardápio completo vai em PDF." }, attachments: [{ url: PDF, filename: "cardapio.pdf" }] });
  if (cenario === "foto") return json(200, { reply: "Olha a calabresa saindo do forno!", attachments: [{ url: PNG, filename: "calabresa.png" }] });
  if (cenario === "anexos-varios")
    return json(200, {
      data: { mensagem: "Seguem os arquivos." },
      attachments: [
        { url: PDF, filename: "cardapio.pdf" },
        { url: XML, filename: "tabela.xml" },
        { url: PDF, filename: "promocao-cerveja.pdf" },
        { url: "https://www.w3.org/arquivo-que-nao-existe.pdf", filename: "quebrado.pdf" },
      ],
    });
  if (cenario === "cardapio-botoes")
    return json(200, {
      data: { itens: CARDAPIO },
      components: { type: "list", button: "Ver sabores", items: CARDAPIO.map((c) => ({ title: c.nome.slice(0, 24), description: c.preco, action: { name: "adicionar_ao_carrinho", params: { item: c.id } } })) },
    });
  if (cenario === "carrossel" || cenario === "carrossel-links")
    return json(200, {
      data: { itens: CARDAPIO },
      components: {
        type: "carousel",
        cards: CARDAPIO.map((c) => ({
          image: `https://placehold.co/800x600.png?text=${encodeURIComponent(c.nome)}`,
          title: c.nome,
          text: `${c.preco}. Item de teste do cardápio de exemplo.`,
          ...(cenario === "carrossel" ? { buttons: [{ title: "Pedir este", action: { name: "adicionar_ao_carrinho", params: { item: c.id } } }] } : { link: { title: "Ver no site", url: `https://bardoze.com.br/cardapio#${c.id}` } }),
        })),
      },
    });
  if (cenario === "carrinho") {
    const item = String(body.params?.item ?? "");
    const nome = CARDAPIO.find((c) => c.id === item)?.nome ?? `item ${item}`;
    return json(200, {
      reply: `Coloquei 1x ${nome} no carrinho. Quer finalizar?`,
      components: {
        type: "buttons",
        buttons: [
          { title: "Finalizar pedido", action: { name: "criar_pedido", params: { itens: [item], endereco: "Retirada na loja" } } },
          { title: "Ver cardápio", id: "ver_cardapio" },
        ],
      },
    });
  }
  if (body.mode === "preview") return json(200, { confirmation: { summary: "Pedido de teste (prévia, nada foi criado)", items: items.length ? items : ["1x Pizza Calabresa"], total_cents: 4990 } });
  if (cenario === "reply") return json(200, { reply: `Pedido ${order} registrado! Chega em uns 40 minutos.` });
  if (cenario === "vazio") return new Response(null, { status: 200 });
  if (cenario === "nao-encontrado") return json(404, { error: "item esgotado" });
  if (cenario === "erro") return json(500, { error: "falha interna de teste" });
  if (cenario === "lento" && !(await repeated())) await new Promise((r) => setTimeout(r, 25_000));
  if (cenario === "em-andamento" && !(await repeated())) return json(409, { error: "in_progress" });
  return json(200, { data: { pedido: order, status: "registrado", itens: items } });
}
