import { BarChart3, BookOpen, Clock, ExternalLink, Headset, Link2, Mail, Plus, Send, UserPlus } from "lucide-react";
import { initials, relativeTime } from "@/lib/utils";
import { currentPeriodBR, periodLabel, portalUrl, shiftPeriod } from "@/lib/report";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { ConfirmAction } from "@/components/ui/confirm-action";
import { CopyButton } from "@/components/copy-button";
import { AutoSwitch, DialogButton, SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { RowMenu } from "@/components/integrations/row-menu";
import { addClientMember, disablePortal, enablePortal, removeClientMember, resendClientInvite, saveReportEmail, sendReportNow, setClientMemberRoleTo, setClientPermissions } from "@/app/painel/actions";

interface ClientInfo {
  id: string;
  name: string;
  portal_token: string | null;
  report_email: string | null;
  report_last_period: string | null;
  allow_handoff: boolean;
  allow_knowledge: boolean;
  allow_hours: boolean;
  handoff_notify: string | null;
}

interface Member {
  id: string;
  email: string;
  role: string;
  display_name: string | null;
  last_login_at: string | null;
  invited_by_key: string | null;
}

const ROLE_LABEL: Record<string, string> = { manager: "Gestor", agent: "Atendente" };

/** O papel em cartões (convidar): o gestor vê tudo; o atendente, só as conversas. */
function RoleCards({ name = "role", defaultValue = "manager" }: { name?: string; defaultValue?: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="label">Papel</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {[
          ["manager", "Gestor", "Relatório, conversas, canais, privacidade e equipe."],
          ["agent", "Atendente", "Só as conversas e a Caixa de entrada."],
        ].map(([v, t, h]) => (
          <label key={v} className="flex cursor-pointer flex-col gap-0.5 rounded-[12px] border border-line p-3 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60">
            <span className="flex items-center gap-2 font-medium text-ink">
              <input type="radio" name={name} value={v} defaultChecked={defaultValue === v} className="accent-brand" />
              {t}
            </span>
            <span className="pl-6 text-xs text-muted">{h}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Cliente → Relatório e portal. Redesenho (23/10/2026): o link do cliente e o relatório mensal em
 * linhas; o e-mail num modal; trocar e desligar o link no modal do link, com confirmação.
 */
export function ClientReportTab({ client, base, memberEmails, business = false }: { client: ClientInfo; base: string; memberEmails: string[]; /** o perfil do negócio: sem o link do cliente (o portal é da agência) */ business?: boolean }) {
  const url = client.portal_token ? portalUrl(client.portal_token, base) : null;
  const lastMonth = periodLabel(shiftPeriod(currentPeriodBR(), -1));
  return (
    <div className="flex flex-col gap-5">
      {!business && <SettingGroup title="Link do cliente">
        {url ? (
          <SettingRow
            icon={<Link2 size={18} />}
            title="Link do cliente"
            summary={<span className="font-mono">{url.replace(/^https?:\/\//, "")}</span>}
            summaryTone="ok"
            description={`Uma página com a sua marca onde ${client.name} vê os números do mês. Sem login: quem tiver o link consegue abrir, por isso ela não mostra contatos nem conversas.`}
            footer="close"
            trailing={<CopyButton text={url} label="Copiar" className="btn-ghost py-1.5 text-xs" />}
            footerStart={
              <span className="flex flex-wrap gap-3">
                <ConfirmAction action={enablePortal.bind(null, client.id)} title="Trocar o link?" description="O link atual para de funcionar e um novo é gerado. Use se o link foi parar em quem não devia." confirmLabel="Trocar link" danger={false} className="text-sm font-medium text-ink-2 hover:underline">
                  Trocar link
                </ConfirmAction>
                <ConfirmAction action={disablePortal.bind(null, client.id)} title="Desligar o link?" description="Ninguém mais consegue abrir a página do cliente. O relatório por e-mail passa a levar para a entrada da área do cliente." confirmLabel="Desligar" className="text-sm font-medium text-danger hover:underline">
                  Desligar
                </ConfirmAction>
              </span>
            }
          >
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-[10px] border border-line bg-field px-3 py-2 font-mono text-xs">{url}</code>
              <CopyButton text={url} label="Copiar link" className="btn-ghost" />
              <a href={url} target="_blank" rel="noopener" className="btn-ghost">
                <ExternalLink size={15} />
                Abrir
              </a>
            </div>
            <p className="text-xs text-muted">Contatos e conversas ficam na área do cliente, com login pelo e-mail (aba Acesso do cliente).</p>
          </SettingRow>
        ) : (
          <SettingRow
            icon={<Link2 size={18} />}
            title="Link do cliente"
            summary="Desligado: crie o link para o cliente ver os números do mês sem login"
            summaryTone="warn"
            trailing={
              <ActionForm action={enablePortal.bind(null, client.id)}>
                <SubmitButton pendingLabel="Criando…" className="btn-primary py-1.5 text-xs">
                  <Plus size={14} />
                  Criar link
                </SubmitButton>
              </ActionForm>
            }
          />
        )}
      </SettingGroup>}

      <SettingGroup title="Relatório mensal por e-mail">
        <SettingRow
          icon={<Mail size={18} />}
          title="E-mail do cliente"
          summary={client.report_email ?? "Sem e-mail: o cliente não recebe o resumo do mês"}
          summaryTone={client.report_email ? "muted" : "warn"}
          description={`Todo dia 1º, ${client.name} recebe um resumo do mês anterior (pessoas atendidas, contatos, % resolvido sozinho) com a sua marca e o link do cliente. Só números, nunca contatos.`}
          action={saveReportEmail.bind(null, client.id)}
        >
          <div>
            <label htmlFor="report_email" className="label">
              E-mail
            </label>
            <input id="report_email" name="report_email" type="email" maxLength={200} defaultValue={client.report_email ?? ""} className="input" placeholder="dono@clinicasorriso.com.br" />
            <p className="mt-1 text-xs text-muted">Em branco, o relatório para de sair.</p>
          </div>
        </SettingRow>
        <SettingRow
          icon={<BarChart3 size={18} />}
          title="Último relatório"
          summary={client.report_last_period ? <span className="capitalize">{periodLabel(client.report_last_period)}</span> : "Nenhum enviado ainda"}
          trailing={
            <ConfirmAction
              action={sendReportNow.bind(null, client.id, undefined)}
              title={`Enviar o relatório de ${lastMonth}?`}
              description={<>Vai para <strong className="text-ink">{client.report_email ?? "o e-mail do cliente"}</strong> agora.</>}
              confirmLabel="Enviar agora"
              danger={false}
              disabled={!client.report_email}
              className="btn-ghost py-1.5 text-xs"
            >
              <Send size={14} />
              Enviar o de {lastMonth.split(" ")[0]}
            </ConfirmAction>
          }
        />
      </SettingGroup>

      {client.report_email && !memberEmails.includes(client.report_email) && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] bg-raised/70 px-4 py-3 text-sm">
          <span className="min-w-0 flex-1 text-ink-2">
            Para ver os contatos e as conversas, <strong className="text-ink">{client.report_email}</strong> precisa de acesso à área do cliente.
          </span>
          <ActionForm action={addClientMember.bind(null, client.id)}>
            <input type="hidden" name="email" value={client.report_email} />
            <SubmitButton pendingLabel="Enviando convite…" className="btn-ghost text-xs">
              Dar acesso e convidar
            </SubmitButton>
          </ActionForm>
        </div>
      )}
    </div>
  );
}

/**
 * Cliente → Acesso do cliente. Redesenho (23/10/2026, no molde da Equipe): o "Convidar pessoa" num
 * modal com o papel em cartões, cada pessoa numa linha com o "…" (mudar o papel, reenviar o link,
 * tirar o acesso) e o que o cliente pode fazer em chaves que salvam na hora.
 */
export function ClientAccessTab({ client, base, members }: { client: ClientInfo; base: string; members: Member[] }) {
  // as chaves salvam juntas (o setClientPermissions lê as três e o aviso): cada uma leva o valor atual das outras
  const others = (skip: string): Record<string, string> => {
    const f: Record<string, string> = { handoff_notify: client.handoff_notify === "client" ? "client" : "all" };
    if (skip !== "allow_handoff" && client.allow_handoff) f.allow_handoff = "on";
    if (skip !== "allow_knowledge" && client.allow_knowledge) f.allow_knowledge = "on";
    if (skip !== "allow_hours" && client.allow_hours) f.allow_hours = "on";
    return f;
  };
  const perms = setClientPermissions.bind(null, client.id);
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="max-w-[520px] text-sm text-muted">
          As pessoas de {client.name} entram na área do cliente (<code className="font-mono text-[12px]">{base.replace(/^https?:\/\//, "")}/cliente</code>) com um link no e-mail, sem senha.
        </p>
        <DialogButton label="Convidar pessoa" icon={<UserPlus size={15} />} className="btn-primary" title="Convidar para a área do cliente" description="Ela recebe um link de acesso no e-mail, sem senha." action={addClientMember.bind(null, client.id)} saveLabel="Adicionar e convidar">
          <div>
            <label htmlFor="member-email" className="label">
              E-mail
            </label>
            <input id="member-email" name="email" type="email" required maxLength={200} className="input" placeholder="recepcao@clinicasorriso.com.br" />
          </div>
          <RoleCards />
        </DialogButton>
      </div>

      <SettingGroup title={`Pessoas com acesso · ${members.length}`}>
        {members.length === 0 && <p className="px-4 py-5 text-sm text-muted">Ninguém ainda.</p>}
        {members.map((m) => (
          <div key={m.id} className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-semibold text-ink">{initials(m.display_name ?? m.email)}</span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-[15px] font-medium text-ink">{m.display_name ?? m.email}</span>
                <span className={`rounded-full px-2 py-px text-[11.5px] font-medium ${m.role === "manager" ? "bg-brand-soft text-brand" : "bg-raised text-ink-2"}`}>{ROLE_LABEL[m.role] ?? m.role}</span>
              </span>
              <span className="mt-0.5 block truncate text-[12.5px] text-muted">
                {m.display_name ? `${m.email} · ` : ""}
                {m.last_login_at ? `entrou ${relativeTime(m.last_login_at)}` : "ainda não entrou"}
                {m.invited_by_key ? " · convidada pela API" : ""}
              </span>
            </span>
            <RowMenu
              label={`Ações de ${m.email}`}
              items={[
                m.role === "manager"
                  ? { label: "Tornar atendente", hint: "Só as conversas", run: setClientMemberRoleTo.bind(null, client.id, m.id, "agent"), confirm: { title: "Tornar atendente?", description: `${m.email} passa a ver só as conversas e a Caixa de entrada.`, confirmLabel: "Tornar atendente" } }
                  : { label: "Tornar gestor", hint: "Vê tudo da área do cliente", run: setClientMemberRoleTo.bind(null, client.id, m.id, "manager"), confirm: { title: "Tornar gestor?", description: `${m.email} passa a ver o relatório, os canais, a privacidade e a equipe.`, confirmLabel: "Tornar gestor" } },
                { label: "Reenviar o link", run: resendClientInvite.bind(null, client.id, m.id), confirm: { title: "Reenviar o link?", description: `Um link novo de acesso vai para ${m.email}.`, confirmLabel: "Reenviar" } },
                { label: "Tirar o acesso", danger: true, run: removeClientMember.bind(null, client.id, m.id), confirm: { title: "Tirar o acesso?", description: `${m.email} não consegue mais entrar na área do cliente.`, confirmLabel: "Tirar acesso", danger: true } },
              ]}
            />
          </div>
        ))}
      </SettingGroup>

      <SettingGroup title={`O que ${client.name} pode fazer`}>
        <SettingRow
          icon={<Headset size={18} />}
          title="Atender conversas"
          summary="Assumir quando o visitante pede alguém, responder e devolver ao assistente"
          trailing={<AutoSwitch checked={client.allow_handoff} action={perms} name="allow_handoff" fields={others("allow_handoff")} label="Atender conversas" />}
        />
        <SettingRow
          icon={<Mail size={18} />}
          title="Quem recebe o e-mail de pedido de atendimento"
          summary={client.handoff_notify === "client" ? "Só as pessoas do cliente (você delegou o atendimento)" : "Você (agência) e as pessoas do cliente"}
          description="Se o cliente não puder atender ou não tiver ninguém cadastrado, o e-mail continua indo para você, para nenhum pedido ficar sem aviso."
          action={perms}
        >
          {client.allow_handoff && <input type="hidden" name="allow_handoff" value="on" />}
          {client.allow_knowledge && <input type="hidden" name="allow_knowledge" value="on" />}
          {client.allow_hours && <input type="hidden" name="allow_hours" value="on" />}
          <fieldset className="flex flex-col gap-2">
            <legend className="label">Recebem o e-mail</legend>
            {[
              ["all", "Você (agência) e as pessoas do cliente"],
              ["client", "Só as pessoas do cliente (você delegou o atendimento)"],
            ].map(([v, t]) => (
              <label key={v} className="flex cursor-pointer items-center gap-2.5 rounded-[12px] border border-line px-3 py-2.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/60">
                <input type="radio" name="handoff_notify" value={v} defaultChecked={(client.handoff_notify === "client" ? "client" : "all") === v} className="accent-brand" />
                {t}
              </label>
            ))}
          </fieldset>
        </SettingRow>
        <SettingRow
          icon={<BookOpen size={18} />}
          title="Ensinar o assistente"
          summary="Só o gestor: responder as perguntas sem resposta e cuidar dos textos e das perguntas e respostas"
          trailing={<AutoSwitch checked={client.allow_knowledge} action={perms} name="allow_knowledge" fields={others("allow_knowledge")} label="Ensinar o assistente" />}
        />
        <SettingRow
          icon={<Clock size={18} />}
          title="Editar o horário de atendimento"
          summary="Só o gestor: os dias e as horas em que a equipe atende, em cada assistente"
          trailing={<AutoSwitch checked={client.allow_hours} action={perms} name="allow_hours" fields={others("allow_hours")} label="Editar o horário de atendimento" />}
        />
      </SettingGroup>
    </div>
  );
}
