import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { closeChannel, openChannel, setAgencyFeatures } from "@/app/admin/(protegido)/acoes";
import { FEATURES, type Feature } from "@/lib/features";
import type { PlatformFlags } from "@/lib/backoffice";
import { relativeTime } from "@/lib/utils";

const OPENING: Record<Feature, { who: string; effect: string }> = {
  whatsapp: {
    who: "os planos pagos",
    effect: "Toda agência paga passa a conectar números do WhatsApp sem liberação. O teste grátis continua na liberação manual, agência por agência.",
  },
  instagram: { who: "todos", effect: "Toda agência, inclusive no teste grátis, passa a conectar contas do Instagram sem liberação." },
};

/** Liberação geral dos canais da Meta (a abertura da L1, quando a Meta aprovar). */
export function ChannelOpeningControls({ flags }: { flags: PlatformFlags }) {
  const openAt: Record<Feature, string | null> = { whatsapp: flags.whatsappOpenAt, instagram: flags.instagramOpenAt };
  return (
    <details className="group rounded-xl border border-line bg-panel px-4 py-3 text-sm">
      <summary className="cursor-pointer list-none font-semibold [&::-webkit-details-marker]:hidden">
        Abertura dos canais{" "}
        <span className="font-normal text-muted">
          · {(Object.keys(FEATURES) as Feature[]).map((c) => `${FEATURES[c].label} ${openAt[c] ? "aberto" : "só liberados"}`).join(" · ")}
        </span>
      </summary>
      <div className="mt-3 flex flex-col gap-4">
        {(Object.keys(FEATURES) as Feature[]).map((c) =>
          openAt[c] ? (
            <div key={c} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-brand-soft px-3 py-2.5">
              <span>
                <strong>{FEATURES[c].label} aberto para {OPENING[c].who}</strong> desde {relativeTime(openAt[c]!)}.
              </span>
              <ConfirmAction
                action={closeChannel.bind(null, c)}
                title={`Fechar a abertura do ${FEATURES[c].label}?`}
                description="Só as agências liberadas uma a uma conseguem conectar. Nada do que já está conectado cai."
                confirmLabel="Fechar"
                className="btn-ghost"
              >
                Fechar a abertura
              </ConfirmAction>
            </div>
          ) : (
            <ActionForm key={c} action={openChannel.bind(null, c)} className="flex flex-col gap-2 border-t border-line-2 pt-3 first:border-0 first:pt-0">
              <span className="font-semibold">Abrir o {FEATURES[c].label} para {OPENING[c].who}</span>
              <p className="text-muted">{OPENING[c].effect} Hoje só conectam as agências liberadas na página de cada uma.</p>
              <label className="flex items-start gap-2">
                <input type="checkbox" name="confirm" required className="mt-1" /> A Meta já aprovou o que este canal precisa.
              </label>
              <SubmitButton className="btn-primary self-start" pendingLabel="Abrindo…">Abrir o {FEATURES[c].label}</SubmitButton>
            </ActionForm>
          ),
        )}
      </div>
    </details>
  );
}

/** Recursos liberados para uma agência, sem deploy (WhatsApp no beta e no teste grátis, Instagram). */
export function AgencyFeatures({ agencyId, plan, features }: { agencyId: string; plan: string; features: string[] }) {
  return (
    <section className="card flex flex-col gap-3 p-5">
      <div>
        <h2 className="text-lg font-bold">Liberação</h2>
        <p className="text-sm text-muted">
          Recursos ligados só para esta agência, sem deploy. Liberar avisa o dono por e-mail; tirar não desconecta o que já está ligado.
          {plan === "trial" && " No teste grátis, o WhatsApp só conecta com pelo menos 1 fonte pronta e as instruções escritas."}
        </p>
      </div>
      <ActionForm action={setAgencyFeatures.bind(null, agencyId)} className="flex flex-col gap-2 text-sm">
        {(Object.keys(FEATURES) as Feature[]).map((f) => (
          <label key={f} className="flex items-start gap-2">
            <input type="checkbox" name={f} defaultChecked={features.includes(f)} className="mt-1" />
            <span>
              <strong>{FEATURES[f].label}</strong>
              <span className="block text-xs text-muted">{FEATURES[f].description}</span>
            </span>
          </label>
        ))}
        <SubmitButton className="btn-primary mt-1 self-start" pendingLabel="Salvando…">Salvar liberação</SubmitButton>
      </ActionForm>
    </section>
  );
}
