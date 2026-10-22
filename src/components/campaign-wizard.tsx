"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { campaignOptions, createMarketingCampaign, previewCampaign, type CampaignPreview, type CampaignTemplateOption, type PickContact } from "@/app/painel/campanhas/actions";
import { REGULATED_ADVICE, type VariableSpec } from "@/lib/campaign-text";
import { displayPhone } from "@/lib/phone";
import { CLIENT_TIMEZONES } from "@/lib/timezone";
import { ContactPicker } from "@/components/campaign-contact-picker";
import { Segmented, TemplateBody, greetingSlot, shortText, slotName } from "@/components/template-slots";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface BotOption {
  id: string;
  name: string;
  clientName: string;
}

const tzLabel = (tz: string) => CLIENT_TIMEZONES.find((t) => t.id === tz)?.label ?? "Brasília";

export function Step({ n, title, children, muted }: { n: number; title: string; children: React.ReactNode; muted?: boolean }) {
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
 * Nova campanha de marketing (leva B3, parte 4a): chatbot, modelo, público, estimativa e envio (o tipo
 * fica na página). A prévia
 * vem do servidor (público montado lá, com quem fica de fora e por quê); qualquer mudança depois da
 * prévia pede para calcular de novo antes de criar. Redesenho, etapa 5 (22/10): os campos do modelo
 * em etiquetas no texto, e o público pelas etiquetas e pelos contatos escolhidos (colar números fica
 * guardado em "Colar números").
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
  const [picked, setPicked] = useState<PickContact[]>([]);
  const [phones, setPhones] = useState("");
  const [active, setActive] = useState<number | null>(null);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [name, setName] = useState("");
  const [when, setWhen] = useState<"now" | "schedule">("now");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [night, setNight] = useState<{ hour: number; eightAt: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const template = options?.templates.find((t) => `${t.name}|${t.language}` === templateKey) ?? null;
  const autoRegulated = Boolean(template?.regulated.length);
  // os escolhidos vão como a lista de números (o servidor confere o aceite de cada um)
  const allPhones = [...picked.map((p) => p.phone), phones].filter(Boolean).join("\n");
  const input = () => ({ botId, templateName: template?.name ?? "", templateLanguage: template?.language ?? "", tags, phones: allPhones, variables, regulated: regulatedManual || autoRegulated });
  const slotLabel = (i: number) => {
    const v = variables[i];
    if (!v) return slotName(i, variables.length);
    if (v.mode === "name") return "Primeiro nome";
    return shortText(v.value) || slotName(i, variables.length);
  };
  const setSlot = (i: number, patch: Partial<VariableSpec>) => touched(setVariables)(variables.map((x, j) => (j === i ? { ...x, ...patch } : x)));
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
    setPicked([]);
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
    // "Olá {{1}}" já começa como o primeiro nome, com "cliente" para quem não tem nome
    const hello = t ? greetingSlot(t.body) : null;
    setVariables(Array.from({ length: t?.vars ?? 0 }, (_, i): VariableSpec => (i === hello ? { mode: "name", value: "cliente" } : { mode: "fixed", value: "" })));
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
                <TemplateBody body={template.body} label={slotLabel} active={active} />
                {template.prohibited.length > 0 && <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">Este modelo oferece {template.prohibited.join(", ")}, que não pode ser anunciado pelo WhatsApp. A campanha não sai com ele.</p>}
                {autoRegulated && (
                  <div className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">
                    O modelo fala de {template.regulated.join(" e ")}: a campanha vai só para quem confirmou ter 18 anos ou mais. {REGULATED_ADVICE}
                  </div>
                )}
                {!autoRegulated && (
                  <label className="flex items-center gap-2.5 text-sm">
                    <input type="checkbox" role="switch" className="switch" checked={regulatedManual} onChange={(e) => touched(setRegulatedManual)(e.target.checked)} />
                    Esta campanha oferece bebida alcoólica, remédio ou outro item só para maiores de 18
                  </label>
                )}
                {variables.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <span className="label mb-0">O que entra em cada campo</span>
                    {variables.map((v, i) => (
                      <div
                        key={i}
                        onFocus={() => setActive(i)}
                        onBlur={() => setActive(null)}
                        onMouseEnter={() => setActive(i)}
                        onMouseLeave={() => setActive(null)}
                        className={cn("flex flex-col gap-2 rounded-[12px] border p-3 transition-colors duration-[120ms]", active === i ? "border-brand/50" : "border-line")}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-ink">{slotName(i, variables.length)}</span>
                          <Segmented
                            label={`O que entra no ${slotName(i, variables.length).toLowerCase()}`}
                            value={v.mode}
                            options={[
                              ["name", "Primeiro nome do contato"],
                              ["fixed", "Texto fixo"],
                            ]}
                            onChange={(mode) => setSlot(i, { mode, value: mode === "name" && !v.value.trim() ? "cliente" : v.value })}
                          />
                        </div>
                        <input
                          className="input"
                          aria-label={v.mode === "name" ? `Para quem não tem nome (${slotName(i, variables.length)})` : `Texto do ${slotName(i, variables.length).toLowerCase()}`}
                          maxLength={200}
                          value={v.value}
                          placeholder={v.mode === "name" ? "cliente" : "O texto que vai no lugar"}
                          onChange={(e) => setSlot(i, { value: e.target.value })}
                        />
                        {v.mode === "name" && <p className="text-xs text-muted">Vai o primeiro nome do cadastro; quem não tem nome recebe este texto.</p>}
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Step>

      <Step n={4} title="Público" muted={!template}>
        {template && options && (
          <>
            <p className="text-sm text-ink-2">Só recebe quem aceitou novidades deste número. Cada pessoa entra uma vez, mesmo se vier pela etiqueta e pela escolha.</p>
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
                        className={cn("rounded-full border px-3 py-1 text-xs font-semibold", on ? "border-brand bg-brand text-on-brand" : "border-line bg-panel text-ink-2 hover:bg-ground")}
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
            <div className="flex flex-col gap-2">
              <span className="label mb-0">E/ou estes contatos</span>
              {picked.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {picked.map((p) => (
                    <span key={p.id} title={p.consent === "aceitou" ? undefined : "Fica de fora: não aceitou novidades ou saiu das promoções"} className={cn("inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs", p.consent === "aceitou" ? "border-line bg-panel text-ink" : "border-amber-ink/30 bg-amber-soft text-amber-ink")}>
                      {p.name || displayPhone(p.phone)}
                      <button type="button" aria-label={`Tirar ${p.name || displayPhone(p.phone)}`} onClick={() => touched(setPicked)(picked.filter((x) => x.id !== p.id))} className="rounded-full p-0.5 text-muted hover:bg-raised hover:text-ink">
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                  {picked.length > 1 && (
                    <button type="button" onClick={() => touched(setPicked)([])} className="text-xs font-semibold text-muted hover:text-ink">
                      Tirar todos
                    </button>
                  )}
                </div>
              )}
              <ContactPicker botId={botId} mode="marketing" chosen={new Set(picked.map((p) => p.id))} onAdd={(rows) => touched(setPicked)([...picked, ...rows])} />
            </div>
            <details className="text-sm">
              <summary className="cursor-pointer text-xs font-semibold text-muted hover:text-ink">Colar números</summary>
              <div className="mt-2 flex flex-col gap-1.5">
                <textarea id="campaign-phones" aria-label="Números colados, um por linha" className="input font-mono text-xs" rows={3} value={phones} onChange={(e) => touched(setPhones)(e.target.value)} placeholder={"21 99999-0000\n11 98888-0000"} />
                <p className="text-xs text-muted">Um por linha. Só recebe quem já é contato deste chatbot e aceitou novidades; número novo fica de fora e não vira contato nem lead.</p>
              </div>
            </details>
            <button type="button" className="btn-ghost self-start" disabled={pending || (!tags.length && !allPhones.trim()) || Boolean(template.prohibited.length)} onClick={calculate}>
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
