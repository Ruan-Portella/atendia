import { CheckCircle2, CreditCard, MessageCircle } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { NEUTRAL_ICONS } from "@/lib/white-label";
import { LINK_DAYS, resolveConnectLink } from "@/lib/whatsapp-connect-link";
import { WHATSAPP_BILLING_URL, embeddedSignupConfig, hasPaymentMethod } from "@/lib/whatsapp";
import { instagramConfigured } from "@/lib/instagram";
import { AgencyHeader, brandColor } from "@/components/report-view";
import { WhatsAppConnect } from "@/components/whatsapp-connect";
import { completeLinkSignup } from "../actions";

// só a marca da agência: título, ícone e textos neutros (a plataforma não aparece)
export const metadata = { title: { absolute: "Conectar WhatsApp" }, robots: { index: false, follow: false }, icons: NEUTRAL_ICONS };

/**
 * Link de conexão do WhatsApp que a agência manda ao cliente: sem conta e sem login, ele entra
 * com o Facebook dele e conecta o próprio número. Depois, o passo do cartão (a Meta cobra as
 * mensagens direto dele) fica em destaque até ser feito.
 */
export default async function ConnectWhatsAppPage({ params, searchParams }: PageProps<"/conectar/[token]">) {
  const [{ token }, sp] = await Promise.all([params, searchParams]);
  const admin = createAdminClient();
  const link = await resolveConnectLink(admin, token);
  const signup = embeddedSignupConfig();
  const ready = link?.channel === "instagram" ? instagramConfigured() : Boolean(signup);

  if (!link || link.state === "expired" || !ready) {
    return (
      <Shell agency={link?.agency}>
        <div className="card flex flex-col gap-2 p-6 text-center">
          <h1 className="text-xl font-bold">Este link não vale mais</h1>
          <p className="text-sm text-muted">Links de conexão valem por {LINK_DAYS} dias e para uma conexão só. Peça um novo a {link?.agency.name || "quem te enviou"}.</p>
        </div>
      </Shell>
    );
  }

  const color = brandColor(link.agency.brand_color);
  const { bot } = link;

  if (link.channel === "instagram") {
    const error = typeof sp.ig_erro === "string" ? sp.ig_erro : null;
    if (link.state === "used") {
      const { data: ch } = await admin.from("instagram_channels").select("username").eq("bot_id", link.botId).maybeSingle();
      return (
        <Shell agency={link.agency}>
          <div className="flex flex-col items-center gap-2 text-center">
            <CheckCircle2 size={40} style={{ color }} />
            <h1 className="text-2xl font-bold">Instagram conectado!</h1>
            <p className="text-[15px] text-ink-2">{ch?.username ? `A conta @${ch.username}` : "A sua conta"} já está ligada ao assistente {bot.name}. Ele responde as mensagens diretas a qualquer hora. Pode fechar esta página.</p>
          </div>
        </Shell>
      );
    }
    return (
      <Shell agency={link.agency}>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold uppercase tracking-[0.06em] text-muted">{bot.client_name}</p>
          <h1 className="text-2xl font-bold sm:text-[28px]">Conecte o seu Instagram ao assistente {bot.name}</h1>
          <p className="text-[15px] text-ink-2">{link.agency.name} preparou um assistente que responde as mensagens diretas do seu Instagram, a qualquer hora. Falta só você conectar a conta: leva 2 minutos, com o login do seu Instagram. As mensagens do Instagram não têm custo.</p>
        </div>
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</p>}
        <section className="card flex flex-col gap-3 p-5">
          <h2 className="text-lg font-bold">Antes de conectar, confira no app do Instagram</h2>
          <ol className="ml-5 list-decimal space-y-1.5 text-sm text-ink-2">
            <li>A conta precisa ser <strong className="text-ink">profissional</strong> (Empresa ou Criador). Em Configurações → Tipo de conta e ferramentas.</li>
            <li>Ligue <strong className="text-ink">“Permitir acesso às mensagens”</strong>: Configurações → Mensagens e respostas a stories → Ferramentas conectadas.</li>
          </ol>
          <a href={`/api/instagram/connect?link=${encodeURIComponent(token)}`} className="btn-primary self-start" style={{ background: color }}>
            <MessageCircle size={16} />
            Conectar meu Instagram
          </a>
          <p className="text-xs text-muted">Abre a tela de login do Instagram, onde você autoriza o acesso às mensagens. Ela pode mostrar o nome do aplicativo usado na conexão: é normal e seguro.</p>
        </section>
      </Shell>
    );
  }

  // daqui para baixo é o link do WhatsApp (o "ready" acima já garantiu a configuração)
  if (!signup) return null;

  if (link.state === "used") {
    const { data: ch } = await admin.from("whatsapp_channels").select("phone_number_id, waba_id, access_token_enc, display_phone").eq("bot_id", link.botId).maybeSingle();
    let funded = false;
    if (ch?.waba_id) funded = await hasPaymentMethod({ ...ch, waba_id: ch.waba_id }).catch(() => false);
    return (
      <Shell agency={link.agency}>
        <div className="flex flex-col items-center gap-2 text-center">
          <CheckCircle2 size={40} style={{ color }} />
          <h1 className="text-2xl font-bold">WhatsApp conectado!</h1>
          <p className="text-[15px] text-ink-2">{ch?.display_phone ? `O número ${ch.display_phone}` : "O seu número"} já está ligado ao assistente {bot.name}. Ele responde seus clientes a qualquer hora.</p>
        </div>
        {funded ? (
          <div className="card flex items-center gap-3 p-5 text-sm">
            <CheckCircle2 size={20} className="shrink-0" style={{ color }} />
            <span><strong>Cartão cadastrado na Meta.</strong> Está tudo pronto, pode fechar esta página.</span>
          </div>
        ) : (
          <CardStep color={color} done />
        )}
      </Shell>
    );
  }

  const action = completeLinkSignup.bind(null, token);
  return (
    <Shell agency={link.agency}>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-semibold uppercase tracking-[0.06em] text-muted">{bot.client_name}</p>
        <h1 className="text-2xl font-bold sm:text-[28px]">Conecte o seu WhatsApp ao assistente {bot.name}</h1>
        <p className="text-[15px] text-ink-2">{link.agency.name} preparou um assistente que responde os seus clientes no WhatsApp, a qualquer hora. Falta só você conectar o número: leva uns 5 minutos, com o login do seu Facebook.</p>
      </div>

      <CardStep color={color} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-bold">Como você quer conectar?</h2>
        <div className="card flex flex-col gap-2.5 p-5">
          <div className="font-semibold">Já atendo pelo WhatsApp Business no celular</div>
          <p className="text-sm text-ink-2">O número continua funcionando no app do celular, como hoje. O assistente responde as mensagens; quando você ou sua equipe responde pelo celular, ele fica quieto naquela conversa por 1 hora.</p>
          <WhatsAppConnect appId={signup.appId} configId={signup.configId} graphVersion={signup.graphVersion} action={action} coexistence label="Conectar meu WhatsApp Business" />
          <p className="text-xs text-muted">Use o WhatsApp Business atualizado e, quando a janela pedir, aceite compartilhar os contatos e o histórico.</p>
        </div>
        <div className="card flex flex-col gap-2.5 p-5">
          <div className="font-semibold">Quero usar um número novo, só para o atendimento</div>
          <p className="text-sm text-ink-2">Um número que ainda não está em nenhum WhatsApp. Ele passa a funcionar só pelo assistente, sem app no celular. Tenha o chip por perto para receber o código por SMS ou ligação.</p>
          <WhatsAppConnect appId={signup.appId} configId={signup.configId} graphVersion={signup.graphVersion} action={action} label="Conectar número novo" primary={false} />
        </div>
      </section>

      <section className="flex flex-col gap-2 text-sm text-ink-2">
        <h2 className="text-base font-bold text-ink">O que acontece na janela do Facebook</h2>
        <ol className="ml-5 list-decimal space-y-1">
          <li>Você entra com o seu Facebook (o da pessoa responsável pela empresa).</li>
          <li>Escolhe ou cria a conta da empresa e a conta do WhatsApp Business.</li>
          <li>Escolhe o número e confirma com o código que chega nele.</li>
        </ol>
        <p className="text-xs text-muted">A janela é da Meta, dona do WhatsApp. Ela pode mostrar o nome do aplicativo usado na conexão: é normal e seguro.</p>
      </section>
    </Shell>
  );
}

/**
 * O passo do cartão, sem letra miúda: as mensagens são cobradas pela Meta direto no cartão do
 * cliente. Antes de conectar vem como aviso; depois, como a tarefa que falta.
 */
function CardStep({ color, done = false }: { color: string; done?: boolean }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border-2 border-[#efd9a9] bg-amber-soft p-5">
      <div className="flex items-center gap-2.5">
        <CreditCard size={22} className="shrink-0 text-amber-ink" />
        <h2 className="text-lg font-bold text-amber-ink">{done ? "Último passo: cadastre um cartão na Meta" : "Importante: o WhatsApp cobra pelas mensagens"}</h2>
      </div>
      <p className="text-sm text-ink">
        As mensagens do WhatsApp são cobradas <strong>pela Meta (dona do WhatsApp), direto no seu cartão de crédito</strong>, por mensagem enviada, conforme a tabela de preços da Meta. São centavos por mensagem, e esse valor não passa pela agência.
      </p>
      <p className="text-sm text-ink">
        <strong>Sem cartão cadastrado, a Meta recusa as mensagens cobradas e o assistente para de responder.</strong>
      </p>
      {done ? (
        <ol className="ml-5 list-decimal space-y-1 text-sm text-ink">
          <li>Abra o <a href={WHATSAPP_BILLING_URL} target="_blank" rel="noopener" className="font-semibold underline">Gerenciador do WhatsApp</a> com o mesmo Facebook que você usou para conectar.</li>
          <li>Vá em <strong>Configurações de pagamento</strong> e adicione um cartão de crédito.</li>
          <li>Volte a esta página: quando o cartão estiver cadastrado, aparece “tudo pronto”.</li>
        </ol>
      ) : (
        <p className="text-sm text-ink">Logo depois de conectar, esta página mostra como cadastrar o cartão. Tenha um cartão de crédito da empresa em mãos.</p>
      )}
      {done && (
        <a href={WHATSAPP_BILLING_URL} target="_blank" rel="noopener" className="btn-primary self-start" style={{ background: color }}>
          <CreditCard size={15} />
          Cadastrar cartão na Meta
        </a>
      )}
    </section>
  );
}

function Shell({ agency, children }: { agency?: Parameters<typeof AgencyHeader>[0]["agency"]; children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-ground">
      {agency && <AgencyHeader agency={agency} />}
      <main className="mx-auto flex max-w-[680px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
