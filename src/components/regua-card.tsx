import { BellRing, Cake, CalendarClock, HeartHandshake, Hourglass, MessageCircleQuestion, Trash2 } from "lucide-react";
import type { CustomReguaPanelItem, ReguaPanelItem } from "@/lib/reguas";
import type { ReguaKind } from "@/lib/regua-kinds";
import { REGUA_CATEGORY, REGUA_DELAY, REGUA_DESCRIPTION, REGUA_EXAMPLES, REGUA_HAS_SEND_HOUR, REGUA_LABEL, REGUA_TRIGGER_LABEL, REGUA_VARIABLES, customTiming } from "@/lib/regua-kinds";
import { costText } from "@/lib/campaigns";
import type { ActionResult } from "@/lib/action-result";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { StatusPill } from "@/components/ui/form-section";
import { AutoSwitch, SettingRow } from "@/components/ui/setting-row";
import { TemplateField } from "@/components/template-field";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { ReguaCustomFields, templateVars } from "@/components/regua-custom-fields";

const CATEGORY_LABEL: Record<string, string> = { MARKETING: "marketing", UTILITY: "utilidade" };
const HOURS = Array.from({ length: 12 }, (_, i) => i + 8);
const ICON: Record<ReguaKind, React.ComponentType<{ size?: number }>> = { aniversario: Cake, sumido: Hourglass, pos_atendimento: HeartHandshake, lembrete: BellRing, sem_resposta: MessageCircleQuestion };
/** O nome de cada variável do modelo (as {{1}}, {{2}}… da Meta) na etiqueta do editor. */
const VAR_NAME = (v: string) => (v.startsWith("o primeiro nome") ? "Primeiro nome" : v.startsWith("a data") ? "Data" : v.startsWith("a hora") ? "Hora" : v);

type Act = (formData: FormData) => Promise<ActionResult>;

/** Quando a régua sai, numa frase curta: "48 horas depois", "no dia, às 9h". */
function timing(it: ReguaPanelItem): string {
  const d = REGUA_DELAY[it.kind];
  const n = it.delay ?? d?.default ?? 0;
  const at = REGUA_HAS_SEND_HOUR[it.kind] ? `, às ${it.sendHour}h` : "";
  if (it.kind === "aniversario") return `No dia${at}`;
  if (it.kind === "sumido") return `${n} dias sem vir${at}`;
  if (it.kind === "pos_atendimento") return `${n} horas depois`;
  if (it.kind === "lembrete") return `${n} horas antes`;
  return `${n} dias sem resposta${at}`;
}

/**
 * Uma régua na tela Réguas (leva Réguas, parte 4; redesenho, etapa 5: uma linha com a situação, quando
 * sai e a estimativa, a chave de ligar e desligar e o modal com o prazo, o modelo da Meta e os
 * números). O texto do modelo usa as etiquetas no lugar de {{1}}.
 */
export function ReguaCard({ item: it, actions }: { item: ReguaPanelItem; actions: { settings: Act; template: Act; on: Act; off: Act } }) {
  const delay = REGUA_DELAY[it.kind];
  const Icon = ICON[it.kind];
  const newTemplate = Boolean(it.inUse && it.regua?.template_name && it.inUse !== it.regua.template_name);
  const approved = it.template.status === "aprovado";
  const vars = Object.fromEntries(REGUA_VARIABLES[it.kind].map((_, i) => [String(i + 1), REGUA_EXAMPLES[it.kind][i] ?? ""]));
  const labels = Object.fromEntries(REGUA_VARIABLES[it.kind].map((v, i) => [String(i + 1), VAR_NAME(v)]));
  const summary =
    it.state === "pausada"
      ? `Parou${it.pauseReason ? `: ${it.pauseReason}` : ""}. Ligue de novo para retomar.`
      : !approved && it.state !== "ligada"
        ? `${timing(it)} · modelo da Meta: ${it.template.label}`
        : `${timing(it)} · até ${it.estimate.people} ${it.estimate.people === 1 ? "pessoa" : "pessoas"} em 30 dias`;

  return (
    <SettingRow
      icon={<Icon size={18} />}
      title={REGUA_LABEL[it.kind]}
      badge={<StatusPill tone={it.state === "ligada" ? "ok" : it.state === "pausada" ? "warn" : "muted"}>{it.state === "ligada" ? "Ligada" : it.state === "pausada" ? "Pausada" : "Desligada"}</StatusPill>}
      summary={summary}
      summaryTone={it.state === "pausada" ? "warn" : "muted"}
      trailing={<AutoSwitch checked={it.state === "ligada"} action={actions.on} offAction={actions.off} disabled={it.state !== "ligada" && !approved} label={`Régua ${REGUA_LABEL[it.kind]}`} />}
      description={REGUA_DESCRIPTION[it.kind]}
      size="lg"
      footer="close"
    >
      {it.state === "pausada" && <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">A régua parou{it.pauseReason ? `: ${it.pauseReason}` : ""}. Confira e ligue de novo pela chave da linha.</p>}
      {!approved && it.state !== "ligada" && <p className="rounded-lg bg-raised/60 px-3 py-2 text-sm text-ink-2">A chave libera depois que a Meta aprovar o modelo ({it.template.label}).</p>}

      {(delay || REGUA_HAS_SEND_HOUR[it.kind]) && (
        <section className="flex flex-col gap-2">
          <h3 className="kpi-label">Quando sai</h3>
          <ActionForm action={actions.settings} success="Régua salva." className="flex flex-wrap items-end gap-3">
            {delay && (
              <div>
                <label htmlFor={`regua-prazo-${it.kind}`} className="label">
                  {it.kind === "lembrete" ? "Quantas horas antes" : `Prazo (${delay.unit})`}
                </label>
                <input id={`regua-prazo-${it.kind}`} name="delay" type="number" min={delay.min} max={delay.max} defaultValue={it.delay ?? delay.default} className="input w-28" />
              </div>
            )}
            {REGUA_HAS_SEND_HOUR[it.kind] && (
              <div>
                <label htmlFor={`regua-hora-${it.kind}`} className="label">Hora do envio</label>
                <select id={`regua-hora-${it.kind}`} name="send_hour" defaultValue={it.sendHour} className="input w-28">
                  {HOURS.map((h) => (
                    <option key={h} value={h}>
                      {h}h
                    </option>
                  ))}
                </select>
              </div>
            )}
            <SubmitButton className="btn-ghost">Salvar</SubmitButton>
          </ActionForm>
          <p className="text-xs text-muted">Sai das 8h às 20h no fuso do cliente, uma régua por pessoa a cada 24 horas.</p>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="kpi-label">Modelo da Meta</h3>
          <span className="text-xs text-muted">
            {it.regua?.template_name ?? "ainda não criado"} · {it.template.label}
            {newTemplate ? ` (em uso: ${it.inUse})` : ""}
          </span>
        </div>
        {it.template.reclassified && it.template.category && <p className="text-xs text-amber-ink">A Meta classificou este modelo como {CATEGORY_LABEL[it.template.category] ?? it.template.category}: ligada, a régua só vai para quem aceitou novidades.</p>}
        <ActionForm action={actions.template} success="Modelo enviado para a Meta." className="flex flex-col gap-3">
          <TemplateField
            id={`regua-texto-${it.kind}`}
            name="body"
            label={it.template.status === "ausente" ? "Texto do modelo (ainda não criado)" : "Texto do modelo"}
            hint={`Categoria pedida à Meta: ${CATEGORY_LABEL[REGUA_CATEGORY[it.kind]]}${REGUA_CATEGORY[it.kind] === "MARKETING" ? ", com o botão “Parar promoções”" : ", sem oferta nem promoção (senão a Meta muda para marketing)"}. A análise costuma levar minutos.`}
            defaultValue={it.draft}
            fallback={it.draft}
            vars={vars}
            labels={labels}
            format="meta"
            multiline
            maxLength={1024}
          />
          <SubmitButton className="btn-ghost self-start" pendingLabel="Enviando…">
            {it.template.status === "ausente" ? "Criar o modelo na Meta" : "Enviar o texto novo para a Meta"}
          </SubmitButton>
        </ActionForm>
        {it.state === "ligada" && newTemplate && approved && (
          <ActionForm action={actions.on} success="A régua passou a usar o modelo novo.">
            <SubmitButton className="btn-primary self-start">Usar o modelo novo</SubmitButton>
          </ActionForm>
        )}
      </section>

      <section className="flex flex-col gap-1.5 text-sm text-ink-2">
        <h3 className="kpi-label">Números</h3>
        <p>
          Próximos 30 dias: até <strong>{it.estimate.people}</strong> {it.estimate.people === 1 ? "pessoa" : "pessoas"} ({costText(it.estimate.costBrl)} na Meta, antes do aceite, do SAIR e da regra de uma régua por dia).
        </p>
        {it.numbers && (
          <p className="text-xs text-muted">
            Até agora: {it.numbers.sent} enviadas · {it.numbers.delivered} entregues · {it.numbers.read} lidas · {it.numbers.replied} respostas · {it.numbers.optOuts} descadastros · {it.numbers.skipped} ficaram de fora · {it.numbers.pending} na fila
          </p>
        )}
      </section>
    </SettingRow>
  );
}

/**
 * Uma régua personalizada na tela Réguas (23/10/2026): a linha com a situação, quando sai e a
 * estimativa, a chave de ligar e o modal com o que ela faz (a data, a repetição e o tipo ficam;
 * o nome, quando sai, a hora e a etiqueta mudam), o modelo da Meta, os números e o Apagar.
 */
export function CustomReguaCard({ item: it, fields, tags, company, actions }: { item: CustomReguaPanelItem; fields: Array<{ id: string; key: string; label: string }>; tags: string[]; company: string; actions: { settings: Act; template: Act; on: Act; off: Act; remove: () => Promise<ActionResult> } }) {
  const c = it.config;
  const newTemplate = Boolean(it.inUse && it.regua.template_name && it.inUse !== it.regua.template_name);
  const approved = it.template.status === "aprovado";
  const { vars, labels } = templateVars(c.trigger, c.repeatYearly);
  const when = customTiming(c);
  const summary =
    it.state === "pausada"
      ? `Parou${it.pauseReason ? `: ${it.pauseReason}` : ""}. Ligue de novo para retomar.`
      : !approved && it.state !== "ligada"
        ? `${when} · modelo da Meta: ${it.template.label}`
        : `${when}${c.tag ? ` · etiqueta ${c.tag}` : ""} · até ${it.estimate.people} ${it.estimate.people === 1 ? "pessoa" : "pessoas"} em 30 dias`;
  const what = [c.trigger === "data" ? `${c.dateLabel ?? "data nova"}${it.dateKey ? ` (coluna ${it.dateKey})` : ""}` : REGUA_TRIGGER_LABEL[c.trigger], c.trigger === "data" ? (c.repeatYearly ? "todo ano" : "uma vez") : null, c.category === "MARKETING" ? "promoção" : "utilidade"].filter(Boolean).join(" · ");

  return (
    <SettingRow
      icon={<CalendarClock size={18} />}
      title={c.name}
      badge={<StatusPill tone={it.state === "ligada" ? "ok" : it.state === "pausada" ? "warn" : "muted"}>{it.state === "ligada" ? "Ligada" : it.state === "pausada" ? "Pausada" : "Desligada"}</StatusPill>}
      summary={summary}
      summaryTone={it.state === "pausada" ? "warn" : "muted"}
      trailing={<AutoSwitch checked={it.state === "ligada"} action={actions.on} offAction={actions.off} disabled={it.state !== "ligada" && !approved} label={`Régua ${c.name}`} />}
      description={`Sua régua: ${what}.`}
      size="lg"
      footer="close"
      footerStart={
        <ConfirmAction action={actions.remove} title={`Apagar a régua ${c.name}?`} description="O que estava na fila não sai mais e os números dela somem. O modelo continua na Meta. A data nova continua na ficha dos contatos." confirmLabel="Apagar" className="btn-ghost text-danger">
          <Trash2 size={14} />
          Apagar
        </ConfirmAction>
      }
    >
      {it.state === "pausada" && <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">A régua parou{it.pauseReason ? `: ${it.pauseReason}` : ""}. Confira e ligue de novo pela chave da linha.</p>}
      {!approved && it.state !== "ligada" && <p className="rounded-lg bg-raised/60 px-3 py-2 text-sm text-ink-2">A chave libera depois que a Meta aprovar o modelo ({it.template.label}).</p>}

      <section className="flex flex-col gap-2">
        <h3 className="kpi-label">O que ela faz</h3>
        <ActionForm action={actions.settings} success="Régua salva." className="flex flex-col gap-3">
          <ReguaCustomFields fields={fields} tags={tags} company={company} initial={c} idPrefix={`regua-${it.regua.id}`} />
          <p className="text-xs text-muted">A data que dispara, a repetição e o tipo de mensagem ficam como estão (o modelo aprovado depende deles): para mudar, crie outra régua.</p>
          <SubmitButton className="btn-ghost self-start">Salvar</SubmitButton>
        </ActionForm>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h3 className="kpi-label">Modelo da Meta</h3>
          <span className="text-xs text-muted">
            {it.regua.template_name ?? "ainda não criado"} · {it.template.label}
            {newTemplate ? ` (em uso: ${it.inUse})` : ""}
          </span>
        </div>
        {it.template.reclassified && it.template.category && <p className="text-xs text-amber-ink">A Meta classificou este modelo como {CATEGORY_LABEL[it.template.category] ?? it.template.category}: ligada, a régua só vai para quem aceitou novidades.</p>}
        <ActionForm action={actions.template} success="Modelo enviado para a Meta." className="flex flex-col gap-3">
          <TemplateField
            id={`regua-texto-${it.regua.id}`}
            name="body"
            label={it.template.status === "ausente" ? "Texto do modelo (ainda não criado)" : "Texto do modelo"}
            hint={`Tipo pedido à Meta: ${CATEGORY_LABEL[c.category]}${c.category === "MARKETING" ? ", com o botão “Parar promoções”" : ", sem oferta nem promoção (senão a Meta muda para marketing)"}. A análise costuma sair em minutos.`}
            defaultValue={it.draft}
            fallback={it.draft}
            vars={vars}
            labels={labels}
            required={Object.keys(vars)}
            format="meta"
            multiline
            maxLength={1024}
          />
          <SubmitButton className="btn-ghost self-start" pendingLabel="Enviando…">
            {it.template.status === "ausente" ? "Criar o modelo na Meta" : "Enviar o texto novo para a Meta"}
          </SubmitButton>
        </ActionForm>
        {it.state === "ligada" && newTemplate && approved && (
          <ActionForm action={actions.on} success="A régua passou a usar o modelo novo.">
            <SubmitButton className="btn-primary self-start">Usar o modelo novo</SubmitButton>
          </ActionForm>
        )}
      </section>

      <section className="flex flex-col gap-1.5 text-sm text-ink-2">
        <h3 className="kpi-label">Números</h3>
        <p>
          Próximos 30 dias: até <strong>{it.estimate.people}</strong> {it.estimate.people === 1 ? "pessoa" : "pessoas"} ({costText(it.estimate.costBrl)} na Meta, antes do aceite, do SAIR e da regra de uma régua por dia).
        </p>
        {it.numbers && (
          <p className="text-xs text-muted">
            Até agora: {it.numbers.sent} enviadas · {it.numbers.delivered} entregues · {it.numbers.read} lidas · {it.numbers.replied} respostas · {it.numbers.optOuts} descadastros · {it.numbers.skipped} ficaram de fora · {it.numbers.pending} na fila
          </p>
        )}
      </section>
    </SettingRow>
  );
}

