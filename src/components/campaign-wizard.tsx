"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { campaignOptions, createMarketingCampaign, previewCampaign, type CampaignPreview, type CampaignTemplateOption } from "@/app/painel/campanhas/actions";
import { REGULATED_ADVICE, type VariableSpec } from "@/lib/campaign-text";
import { CLIENT_TIMEZONES } from "@/lib/timezone";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface BotOption {
  id: string;
  name: string;
  clientName: string;
}

const tzLabel = (tz: string) => CLIENT_TIMEZONES.find((t) => t.id === tz)?.label ?? "Brasília";

function Step({ n, title, children, muted }: { n: number; title: string; children: React.ReactNode; muted?: boolean }) {
  return (
    <section className={cn("card flex flex-col gap-3 p-5", muted && "opacity-60")}>
      <h2 className="flex items-center gap-2.5 font-semibold">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Nova campanha (leva B3, parte 4a): tipo, chatbot, modelo, público, estimativa e envio. A prévia
 * vem do servidor (público montado lá, com quem fica de fora e por quê); qualquer mudança depois da
 * prévia pede para calcular de novo antes de criar.
 */
export function CampaignWizard({ bots }: { bots: BotOption[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [botId, setBotId] = useState("");
  const [options, setOptions] = useState<{ templates: CampaignTemplateOption[]; tags: string[]; timezone: string } | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [templateKey, setTemplateKey] = useState("");
  const [variables, setVariables] = useState<VariableSpec[]>([]);
  const [regulatedManual, setRegulatedManual] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [phones, setPhones] = useState("");
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [name, setName] = useState("");
  const [when, setWhen] = useState<"now" | "schedule">("now");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [night, setNight] = useState<{ hour: number; eightAt: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const template = options?.templates.find((t) => `${t.name}|${t.language}` === templateKey) ?? null;
  const autoRegulated = Boolean(template?.regulated.length);
  const input = () => ({ botId, templateName: template?.name ?? "", templateLanguage: template?.language ?? "", tags, phones, variables, regulated: regulatedManual || autoRegulated });
  // qualquer mudança depois da prévia: calcular de novo
  const touched = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPreview(null);
    setNight(null);
    setProblem(null);
  };

  function chooseBot(id: string) {
    setBotId(id);
    setOptions(null);
    setOptionsError(null);
    setTemplateKey("");
    setVariables([]);
    setTags([]);
    setPreview(null);
    setNight(null);
    if (!id) return;
    start(async () => {
      try {
        const r = await campaignOptions(id);
        if (r.ok) setOptions({ templates: r.templates, tags: r.tags, timezone: r.timezone });
        else setOptionsError(r.message);
      } catch {
        setOptionsError("Não foi possível carregar os modelos agora. Tente de novo.");
      }
    });
  }

  function chooseTemplate(key: string) {
    const t = options?.templates.find((x) => `${x.name}|${x.language}` === key);
    setTemplateKey(key);
    setVariables(Array.from({ length: t?.vars ?? 0 }, (): VariableSpec => ({ mode: "fixed", value: "" })));
    setPreview(null);
    setNight(null);
  }

  function calculate() {
    setProblem(null);
    start(async () => {
      try {
        setPreview(await previewCampaign(input()));
      } catch {
        setPreview({ ok: false, message: "Não foi possível calcular agora. Tente de novo." });
      }
    });
  }

  function create(extra: { confirmNight?: boolean; when?: "now" | "schedule" | "eight" } = {}) {
    setProblem(null);
    start(async () => {
      try {
        const r = await createMarketingCampaign({ ...input(), name, when: extra.when ?? when, scheduledLocal, confirmNight: extra.confirmNight });
        if (r.ok) {
          toast.success(r.message);
          router.push(`/painel/campanhas/${r.id}`);
          return;
        }
        if (r.night) setNight(r.night);
        else setProblem(r.message);
      } catch {
        setProblem("Não foi possível criar a campanha agora. Tente de novo.");
      }
    });
  }

  const ready = preview?.ok && preview.included > 0 && (when === "now" || Boolean(scheduledLocal));

  return (
    <div className="flex flex-col gap-4">
      <Step n={1} title="Tipo">
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-brand bg-brand-soft/40 p-3 text-sm">
            <input type="radio" name="kind" defaultChecked className="mt-1" />
            <span>
              <span className="font-semibold">Marketing</span>
              <span className="block text-xs text-muted">Promoções e novidades, só para quem aceitou receber.</span>
            </span>
          </label>
          <label className="flex items-start gap-2.5 rounded-lg border border-line p-3 text-sm opacity-60">
            <input type="radio" name="kind" disabled className="mt-1" />
            <span>
              <span className="font-semibold">Lembrete de utilidade</span>
              <span className="block text-xs text-muted">Consulta, vencimento, revisão, por planilha. Chega em breve.</span>
            </span>
          </label>
        </div>
      </Step>

      <Step n={2} title="Chatbot">
        {bots.length ? (
          <select className="input" value={botId} onChange={(e) => chooseBot(e.target.value)} aria-label="Chatbot">
            <option value="">Escolha o chatbot…</option>
            {bots.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} · {b.clientName}
              </option>
            ))}
          </select>
        ) : (
          <p className="text-sm text-muted">Nenhum chatbot com o WhatsApp conectado. Campanhas saem só pelo WhatsApp (não há campanhas no Instagram).</p>
        )}
        {optionsError && <p className="text-sm text-danger">{optionsError}</p>}
      </Step>

      <Step n={3} title="Modelo" muted={!options}>
        {options && !options.templates.length && (
          <p className="text-sm text-muted">
            Este chatbot ainda não tem modelo de marketing aprovado. Crie um na aba WhatsApp do chatbot (categoria Marketing); a Meta analisa em minutos.
          </p>
        )}
        {options && options.templates.length > 0 && (
          <>
            <select className="input" value={templateKey} onChange={(e) => chooseTemplate(e.target.value)} aria-label="Modelo">
              <option value="">Escolha o modelo…</option>
              {options.templates.map((t) => (
                <option key={`${t.name}|${t.language}`} value={`${t.name}|${t.language}`}>
                  {t.name} ({t.language})
                </option>
              ))}
            </select>
            {template && (
              <>
                <p className="whitespace-pre-line rounded-lg bg-ground p-3 text-sm text-ink-2">{template.body}</p>
                {template.prohibited.length > 0 && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Este modelo oferece {template.prohibited.join(", ")}, que não pode ser anunciado pelo WhatsApp. A campanha não sai com ele.</p>}
                {autoRegulated && (
                  <div className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
                    O modelo fala de {template.regulated.join(" e ")}: a campanha vai só para quem confirmou ter 18 anos ou mais. {REGULATED_ADVICE}
                  </div>
                )}
                {!autoRegulated && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={regulatedManual} onChange={(e) => touched(setRegulatedManual)(e.target.checked)} />
                    Esta campanha oferece bebida alcoólica, remédio ou outro item só para maiores de 18
                  </label>
                )}
                {variables.map((v, i) => (
                  <div key={i} className="grid gap-2 sm:grid-cols-[200px_1fr]">
                    <select
                      className="input"
                      aria-label={`Variável ${i + 1}`}
                      value={v.mode}
                      onChange={(e) => touched(setVariables)(variables.map((x, j) => (j === i ? { ...x, mode: e.target.value as VariableSpec["mode"] } : x)))}
                    >
                      <option value="fixed">{`{{${i + 1}}}`}: texto fixo</option>
                      <option value="name">{`{{${i + 1}}}`}: primeiro nome do contato</option>
                    </select>
                    <input
                      className="input"
                      aria-label={`Valor da variável ${i + 1}`}
                      maxLength={200}
                      value={v.value}
                      placeholder={v.mode === "name" ? "Para quem não tem nome (ex.: cliente)" : "Texto que vai no lugar da variável"}
                      onChange={(e) => touched(setVariables)(variables.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                    />
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </Step>

      <Step n={4} title="Público" muted={!template}>
        {template && options && (
          <>
            <p className="text-sm text-ink-2">Só recebe quem aceitou novidades deste número. Cada pessoa entra uma vez, mesmo se vier por etiqueta e pela lista.</p>
            <div>
              <span className="label">Contatos com estas etiquetas (qualquer uma)</span>
              {options.tags.length ? (
                <div className="flex flex-wrap gap-2">
                  {options.tags.map((t) => {
                    const on = tags.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        aria-pressed={on}
                        onClick={() => touched(setTags)(on ? tags.filter((x) => x !== t) : [...tags, t])}
                        className={cn("rounded-full border px-3 py-1 text-xs font-semibold", on ? "border-brand bg-brand text-ground" : "border-line bg-panel text-ink-2 hover:bg-ground")}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted">Os contatos deste chatbot ainda não têm etiquetas (dá para pôr na aba Contatos do cliente ou pela planilha).</p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="campaign-phones">E/ou esta lista de WhatsApps, um por linha</label>
              <textarea id="campaign-phones" className="input font-mono text-xs" rows={3} value={phones} onChange={(e) => touched(setPhones)(e.target.value)} placeholder={"21 99999-0000\n11 98888-0000"} />
            </div>
            <button type="button" className="btn-ghost self-start" disabled={pending || (!tags.length && !phones.trim()) || Boolean(template.prohibited.length)} onClick={calculate}>
              {pending && !preview ? "Calculando…" : "Calcular público"}
            </button>
          </>
        )}
      </Step>

      <Step n={5} title="Estimativa" muted={!preview?.ok}>
        {preview && !preview.ok && <p className="text-sm text-danger">{preview.message}</p>}
        {preview?.ok && (
          <>
            <p className="text-lg font-bold">
              {preview.included.toLocaleString("pt-BR")} contato{preview.included === 1 ? "" : "s"} vão receber
            </p>
            {preview.excluded.length > 0 && (
              <ul className="flex flex-col gap-0.5 text-sm text-ink-2">
                {preview.excluded.map((x) => (
                  <li key={x.reason}>
                    {x.count.toLocaleString("pt-BR")} fora: {x.label}
                  </li>
                ))}
              </ul>
            )}
            {preview.truncated && <p className="text-xs text-amber-ink">O público passou de 10.000 contatos: só os primeiros 10.000 entram. Divida por etiquetas.</p>}
            {preview.regulated && <p className="text-xs text-muted">Campanha de item só para maiores de 18: vai só para quem confirmou a idade.</p>}
            <p className="text-sm">
              Custo estimado na Meta: <strong>{preview.cost}</strong>, cobrado direto da conta do WhatsApp do cliente.
            </p>
            {preview.days > 1 && (
              <p className="text-sm text-amber-ink">
                Este envio leva {preview.days} dias: a conta do WhatsApp pode falar com {preview.limit.toLocaleString("pt-BR")} pessoas por 24 h (somando campanhas e lembretes).
              </p>
            )}
            {preview.sample && (
              <div>
                <span className="label">Como chega para o primeiro contato</span>
                <p className="max-w-[440px] whitespace-pre-line rounded-lg bg-ground px-3 py-2 text-sm">{preview.sample}</p>
              </div>
            )}
          </>
        )}
      </Step>

      <Step n={6} title="Enviar" muted={!ready}>
        {preview?.ok && preview.included > 0 && (
          <>
            <div>
              <label className="label" htmlFor="campaign-name">Nome da campanha (só para a equipe)</label>
              <input id="campaign-name" className="input" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} placeholder="Promoção de sexta" />
            </div>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="when" checked={when === "now"} onChange={() => setWhen("now")} /> Enviar agora
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="when" checked={when === "schedule"} onChange={() => setWhen("schedule")} /> Agendar
              </label>
            </div>
            {when === "schedule" && (
              <div>
                <label className="label" htmlFor="campaign-when">Data e hora no fuso do cliente ({tzLabel(preview.timezone)})</label>
                <input id="campaign-when" type="datetime-local" className="input w-auto" value={scheduledLocal} onChange={(e) => setScheduledLocal(e.target.value)} />
              </div>
            )}
            {night ? (
              <div className="flex flex-col gap-3 rounded-lg bg-amber-soft p-3 text-sm text-amber-ink">
                <p>
                  São {night.hour}h para os contatos deste cliente. Enviar agora ou agendar para as 8h ({night.eightAt})?
                </p>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-ghost" disabled={pending} onClick={() => create({ confirmNight: true })}>
                    Enviar agora
                  </button>
                  <button type="button" className="btn-primary" disabled={pending} onClick={() => create({ when: "eight" })}>
                    Agendar para 8h
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn-primary self-start" disabled={pending || !ready} onClick={() => create()}>
                {pending ? "Criando…" : when === "now" ? "Criar e enviar" : "Criar e agendar"}
              </button>
            )}
            {problem && <p className="text-sm text-danger">{problem}</p>}
          </>
        )}
      </Step>
    </div>
  );
}
