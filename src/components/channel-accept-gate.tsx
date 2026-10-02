import { createClient } from "@/lib/supabase/server";
import { connectBlock, getCompliance, hasAcceptance, type AcceptanceChannel } from "@/lib/acceptance";
import { acceptChannelTerms } from "@/app/painel/actions";
import { AcceptanceForm } from "@/components/acceptance-form";

/**
 * Tela única de aceite no painel: antes dos botões de conexão do WhatsApp ou do Instagram, o
 * negócio aceita os termos do canal (e responde as atividades, na primeira vez). Bloqueado ou
 * aguardando a revisão da IA como produto: mostra o motivo no lugar dos botões.
 * Com o canal já conectado (cliente antigo), `connected` mostra o mesmo aceite sem esconder nada.
 */
export async function ChannelAcceptGate({
  botId,
  clientId,
  clientName,
  agencyName,
  channel,
  connected = false,
  children,
}: {
  botId: string;
  clientId: string | null;
  clientName: string;
  agencyName: string;
  channel: AcceptanceChannel;
  connected?: boolean;
  children?: React.ReactNode;
}) {
  if (!clientId) return <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Ligue este chatbot a um cliente (aba Personalidade) antes de conectar.</p>;
  const supabase = await createClient();
  const [compliance, accepted] = await Promise.all([getCompliance(supabase, clientId), hasAcceptance(supabase, clientId, channel)]);
  const form = (
    <AcceptanceForm
      action={acceptChannelTerms.bind(null, botId, channel)}
      channel={channel}
      clientName={clientName}
      agencyName={agencyName}
      policyHref="/uso-aceitavel"
      askActivities={!compliance}
      askIdentity={false}
    />
  );

  if (connected) {
    if (accepted) return null;
    return (
      <details className="rounded-xl border border-[#efd9a9] bg-amber-soft p-4 text-sm">
        <summary className="cursor-pointer font-semibold text-amber-ink">Falta o aceite do negócio para este canal</summary>
        <p className="mt-2 text-ink-2">O canal continua funcionando. O aceite registra que {clientName} concorda com os termos do canal e a Política de Uso Aceitável; faça com o cliente do lado ou mande o link de conexão para ele.</p>
        <div className="mt-3 rounded-xl bg-panel p-4">{form}</div>
      </details>
    );
  }

  // bloqueado ou aguardando a revisão vem antes do aceite (aceitar não destrava)
  const hard = connectBlock({ channel, compliance, accepted: true });
  if (hard) return <p className={`rounded-lg px-3 py-2 text-sm ${compliance?.status === "bloqueado" ? "bg-danger-soft text-danger" : "bg-amber-soft text-amber-ink"}`}>{hard}</p>;
  if (!accepted) return <div className="rounded-xl border border-line p-4">{form}</div>;
  return <>{children}</>;
}
