"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { ACTIVITIES, AI_PRODUCT, REVIEW_BUSINESS_DAYS, type AcceptanceChannel } from "@/lib/acceptance";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";

const META_TERMS: Record<AcceptanceChannel, { label: string; href: string }> = {
  whatsapp: { label: "Termos do WhatsApp Business", href: "https://www.whatsapp.com/legal/business-terms" },
  instagram: { label: "Termos da Plataforma Meta", href: "https://developers.facebook.com/terms/" },
};

const ANSWERS: Array<[string, string]> = [
  ["nao", "Não"],
  ["sim", "Sim"],
  ["nao_sei", "Não sei"],
];

/**
 * Tela única de aceite, igual no painel e no link de conexão: termos do canal, Política de Uso
 * Aceitável e, na primeira vez do negócio, "Seu negócio faz alguma destas atividades?". O "sim"
 * em vender IA como produto pede confirmação contra toque errado.
 */
export function AcceptanceForm({
  action,
  channel,
  clientName,
  agencyName,
  policyHref,
  askActivities,
  askIdentity,
  neutral = false,
  color,
}: {
  action: (fd: FormData) => Promise<ActionResult>;
  channel: AcceptanceChannel;
  clientName: string;
  agencyName: string;
  policyHref: string;
  /** A pergunta de atividades (só na primeira vez do negócio). */
  askActivities: boolean;
  /** Pelo link, sem login: nome e e-mail de quem aceita. */
  askIdentity: boolean;
  /** Link do cliente (white-label): sem o nome da plataforma. */
  neutral?: boolean;
  color?: string;
}) {
  const toast = useToast();
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [confirmAi, setConfirmAi] = useState(false);
  const channelName = channel === "whatsapp" ? "WhatsApp" : "Instagram";
  const terms = META_TERMS[channel];
  const reviewer = neutral ? "da revisão" : "da revisão da BoaVoz";

  function send(fd: FormData) {
    start(async () => {
      let r: ActionResult;
      try {
        r = await action(fd);
      } catch {
        toast.error("Não foi possível concluir agora. Verifique a conexão e tente de novo.");
        return;
      }
      if (!r.ok) return void toast.error(r.message);
      setConfirmAi(false);
      if (r.message) toast.success(r.message);
      router.refresh();
    });
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    // "sim" em vender IA: confirma antes de gravar (a resposta não se repete)
    if (askActivities && fd.get(`atividade_${AI_PRODUCT}`) === "sim" && !confirmAi) return setConfirmAi(true);
    send(fd);
  }

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5">
        <ShieldCheck size={20} className="mt-0.5 shrink-0" style={color ? { color } : undefined} />
        <div>
          <h3 className="text-base font-bold">Antes de conectar: termos do {channelName}</h3>
          <p className="text-sm text-ink-2">Quem aceita é o próprio negócio ({clientName}), uma vez por canal.</p>
        </div>
      </div>

      <ul className="ml-5 list-disc space-y-1.5 text-sm text-ink-2">
        {channel === "whatsapp" ? (
          <li>A conta do WhatsApp Business e o número continuam sendo do seu negócio, no portfólio dele na Meta. <strong className="text-ink">A Meta cobra as mensagens direto no cartão do negócio</strong>; esse valor não passa pela {neutral ? "agência" : `${agencyName} nem pela BoaVoz`}.</li>
        ) : (
          <li>A conta do Instagram continua sendo do seu negócio. As mensagens do Instagram não têm custo.</li>
        )}
        <li>{agencyName} acessa as conversas deste canal só para operar o atendimento do seu negócio (assistente, painel e relatórios), em nome dele.</li>
        <li>
          Os dados passam por suboperadores contratados para operar o serviço, com autorização genérica.{" "}
          <details className="inline">
            <summary className="inline cursor-pointer font-medium underline">Ver a lista</summary>
            <span className="mt-1 block text-xs text-muted">Supabase (banco de dados), Vercel (hospedagem), OpenAI, Anthropic e Google (IA: respostas, leitura da base e áudios), Resend (e-mail), Sentry (erros técnicos, sem conteúdo de conversas) e a própria Meta ({channelName}).</span>
          </details>
        </li>
        <li>
          O negócio segue os <a href={terms.href} target="_blank" rel="noopener" className="font-medium underline">{terms.label}</a>, as políticas da Meta e a{" "}
          <a href={policyHref} target="_blank" rel="noopener" className="font-medium underline">Política de Uso Aceitável</a>: o assistente atende o negócio (não é IA de uso geral) e não vende itens proibidos pela Meta.
        </li>
      </ul>

      {askIdentity && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ac-name" className="label">Seu nome</label>
            <input id="ac-name" name="name" required minLength={2} maxLength={120} autoComplete="name" className="input" />
          </div>
          <div>
            <label htmlFor="ac-email" className="label">Seu e-mail</label>
            <input id="ac-email" name="email" type="email" required maxLength={160} autoComplete="email" className="input" />
            <p className="mt-1 text-xs text-muted">Recebe uma cópia do aceite.</p>
          </div>
        </div>
      )}

      {askActivities && (
        <fieldset className="flex flex-col gap-2 rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Seu negócio faz alguma destas atividades?</legend>
          <p className="text-xs text-muted">Responda uma vez; fica gravado para o negócio. &ldquo;Sim&rdquo; ou &ldquo;Não sei&rdquo; não impede de conectar: abre uma revisão, com resposta em até {REVIEW_BUSINESS_DAYS} dias úteis. Só a venda de IA como produto segura o WhatsApp até a revisão.</p>
          <ul className="flex flex-col divide-y divide-line-2">
            {ACTIVITIES.map((a) => (
              <li key={a.id} className="flex flex-col gap-1.5 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <span className="text-sm">{a.label}</span>
                <span className="flex shrink-0 gap-1.5" role="radiogroup" aria-label={a.label}>
                  {ANSWERS.map(([value, label], i) => (
                    <label key={value} className="cursor-pointer">
                      <input type="radio" name={`atividade_${a.id}`} value={value} required={i === 0} className="peer sr-only" />
                      <span className="inline-block rounded-full border border-line px-3 py-1 text-xs font-medium peer-checked:border-ink peer-checked:bg-ink peer-checked:text-ground peer-focus-visible:ring-2 peer-focus-visible:ring-brand">{label}</span>
                    </label>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="aceite" required className="mt-1" />
        <span>Aceito os termos do canal e a Política de Uso Aceitável.</span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="poderes" required className="mt-1" />
        <span>Declaro que tenho poderes para aceitar em nome de {clientName}.</span>
      </label>

      <button type="submit" disabled={pending} className="btn-primary self-start" style={color ? { background: color } : undefined}>
        {pending ? "Registrando…" : "Aceitar e continuar"}
      </button>

      <Modal open={confirmAi} onClose={() => setConfirmAi(false)} title="Confirma a resposta?">
        <div className="flex flex-col gap-4 text-sm">
          <p>
            Você marcou <strong>&ldquo;{ACTIVITIES.find((a) => a.id === AI_PRODUCT)!.label}&rdquo;</strong>. O WhatsApp só ativa depois {reviewer}, em até {REVIEW_BUSINESS_DAYS} dias úteis.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmAi(false)} className="btn-ghost">Corrigir</button>
            <button type="button" disabled={pending} onClick={() => form.current && send(new FormData(form.current))} className="btn-dark">
              {pending ? "Registrando…" : "Confirmar"}
            </button>
          </div>
        </div>
      </Modal>
    </form>
  );
}
