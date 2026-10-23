import Link from "next/link";
import { Archive, Building2, Clock, Compass, FileText, Globe, ImageIcon, MessageCircle } from "lucide-react";
import { requirePermission } from "@/lib/agency";
import { ACCOUNT_PROFILES } from "@/lib/first-access";
import { company } from "@/lib/company";
import { saveCustomDomain, undoAgencyRetention, updateAgency, updatePrivacy, verifyCustomDomain } from "@/app/painel/actions";
import { DEFAULT_RETENTION_MONTHS, RETENTION_MONTHS, dateBR } from "@/lib/retention";
import { displayPhone } from "@/lib/phone";
import { appUrl } from "@/lib/utils";
import { isApexDomain, recommendedDnsRecord, vercelDomainsEnabled } from "@/lib/domain";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { SettingGroup, SettingRow } from "@/components/ui/setting-row";
import { HowItWorks, StatusPill } from "@/components/ui/form-section";
import { ColorField, LogoField, RetentionField } from "@/components/brand-fields";
import { CopyButton } from "@/components/copy-button";
import { ProfileButton } from "@/components/profile-dialog";
import { createClient } from "@/lib/supabase/server";
import { businessMode } from "@/lib/business-mode";

export const metadata = { title: "Marca e domínio" };

/**
 * Marca e domínio (redesenho, etapa 5): a marca, o domínio próprio e a privacidade em linhas, cada uma
 * com o resumo do que está configurado e o modal para editar.
 */
export default async function MarcaPage() {
  const { agency, packs, role } = await requirePermission("brand");
  const domain = agency.custom_domain;
  const verified = Boolean(domain && agency.custom_domain_verified_at);
  const apex = domain ? isApexDomain(domain) : false;
  // só pergunta à Vercel enquanto falta configurar o DNS
  const record = domain && !verified ? await recommendedDnsRecord(domain) : null;
  const live = Boolean(domain && (verified || !record));
  const host = appUrl("").replace(/^https?:\/\//, "");
  const profile = agency.profile ? ACCOUNT_PROFILES[agency.profile] : null;
  const nameLabel = profile?.nameLabel ?? "Nome da agência";
  const pending = agency.retention_pending_months && agency.retention_effective_at ? { months: agency.retention_pending_months, at: dateBR(agency.retention_effective_at) } : null;
  const now = agency.retention_months ? `${agency.retention_months} meses` : "sem prazo";
  // o perfil do negócio (23/10/2026): os textos falam do seu negócio, sem portal nem demos
  const supabase = await createClient();
  const [{ count: clientCount }, business] = await Promise.all([supabase.from("clients").select("id", { count: "exact", head: true }).eq("agency_id", agency.id), businessMode(supabase, agency)]);
  const shows = business ? "no rodapé do chat e nos e-mails" : "no rodapé do chat, na demo, no portal e nos e-mails";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-normal sm:text-[28px]">Marca e domínio</h1>
        <p className="text-sm text-muted">{business ? "O que os seus clientes veem: no rodapé do chat e nos e-mails." : "O que seus clientes e prospects veem: no rodapé do chat, na página de demo, no portal e nos e-mails."}</p>
      </div>

      <SettingGroup title="Sua marca">
        <SettingRow icon={<Building2 size={18} />} title={nameLabel} summary={agency.name} description={business ? "Aparece para os seus clientes no chat e nos e-mails." : "Aparece para os clientes e prospects no portal, nas demos e nos e-mails."} action={updateAgency}>
          <div>
            <label htmlFor="name" className="label">
              {nameLabel}
            </label>
            <input id="name" name="name" defaultValue={agency.name} required minLength={2} maxLength={80} className="input" />
          </div>
        </SettingRow>
        <SettingRow
          icon={
            agency.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={agency.logo_url} alt="" className="h-7 w-7 object-contain" />
            ) : (
              <ImageIcon size={18} />
            )
          }
          title="Logo"
          summary={agency.logo_url ? shows.charAt(0).toUpperCase() + shows.slice(1) : "Sem logo: no lugar dele vai o nome"}
          description={`Aparece ${shows}.`}
          action={updateAgency}
        >
          <LogoField current={agency.logo_url} agencyId={agency.id} />
        </SettingRow>
        <SettingRow
          icon={<span className="h-5 w-5 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: agency.brand_color }} />}
          title="Cor dos chatbots novos"
          summary={`${agency.brand_color.toUpperCase()} · os chatbots novos começam com ela; cada um pode ter a sua`}
          description="A cor do botão e dos balões do chat nos chatbots que você criar daqui em diante. A dos chatbots que já existem muda na página de cada um (Rosto do chatbot)."
          action={updateAgency}
        >
          <ColorField name="brand_color" defaultValue={agency.brand_color} />
        </SettingRow>
        {/* o botão de falar com você na demo e no portal: no negócio, sem demo nem portal, não aparece */}
        {!business && (
          <SettingRow
            icon={<MessageCircle size={18} />}
            title="Seu WhatsApp"
            summary={agency.support_whatsapp ? `${displayPhone(agency.support_whatsapp)} · o botão de falar com você na demo e no portal` : "Sem número: a demo e o portal ficam sem o botão de falar com você"}
            summaryTone={agency.support_whatsapp ? undefined : "warn"}
            description="Quem vê a demo ou o portal fala com você por este número. Vazio, o botão não aparece."
            action={updateAgency}
          >
            <div>
              <label htmlFor="support_whatsapp" className="label">
                WhatsApp com o DDD
              </label>
              <input id="support_whatsapp" name="support_whatsapp" inputMode="tel" defaultValue={agency.support_whatsapp ? displayPhone(agency.support_whatsapp) : ""} maxLength={30} className="input" placeholder="41 99999-9999" />
            </div>
          </SettingRow>
        )}
        {role === "owner" && (
          <SettingRow
            icon={<Compass size={18} />}
            title={`Como você usa o ${company.brand}`}
            summary={profile ? `${profile.label} · ${business ? "o menu mostra Chatbots no lugar de Clientes" : "muda os primeiros passos"}` : "Ainda sem resposta · muda os primeiros passos"}
            trailing={<ProfileButton current={agency.profile ?? "agency"} className="btn-ghost shrink-0 py-1.5 text-xs" clientCount={clientCount ?? 0} />}
          />
        )}
      </SettingGroup>

      <div className="flex flex-col gap-2">
        <SettingGroup title="Domínio próprio">
          {!packs.includes("dominio") ? (
            <SettingRow
              icon={<Globe size={18} />}
              title="Domínio próprio"
              badge={<StatusPill>pacote</StatusPill>}
              summary={business ? `R$ 29 por mês: o chat do site no seu endereço, em vez de ${host}` : `R$ 29 por mês: as demos, o portal e o chat do site no seu endereço, em vez de ${host}`}
              trailing={
                <Link href="/painel/cobranca" className="btn-ghost shrink-0 py-1.5 text-xs">
                  Assinar
                </Link>
              }
            />
          ) : (
            <>
              <SettingRow
                icon={<Globe size={18} />}
                title="Domínio"
                badge={domain ? <StatusPill tone={live ? "ok" : "warn"}>{live ? "No ar" : "Falta o DNS"}</StatusPill> : undefined}
                summary={domain ? `https://${domain}` : `Nenhum: os links usam ${host}`}
                description={business ? `O código do chat do site passa a usar o seu endereço em vez de ${host}. Este painel continua em ${host}.` : `As demos, o portal do cliente e o código do chat do site passam a usar o seu endereço em vez de ${host}. Este painel continua em ${host}.`}
                action={saveCustomDomain}
                saveLabel="Salvar domínio"
              >
                <div>
                  <label htmlFor="custom_domain" className="label">
                    Domínio
                  </label>
                  <input id="custom_domain" name="custom_domain" defaultValue={domain ?? ""} maxLength={120} className="input" placeholder="chat.suaagencia.com.br" />
                  <p className="mt-1 text-xs text-muted">Um subdomínio, como chat.suaagencia.com.br, é o mais simples. Para voltar ao endereço padrão, apague e salve.</p>
                </div>
                {verified && <p className="rounded-[12px] bg-amber-soft px-3 py-2 text-xs text-amber-ink">Trocar ou apagar o domínio faz o chat parar nos sites onde o código foi instalado com o domínio atual: reinstale o código novo nesses sites.</p>}
              </SettingRow>
              {domain && !live && record && (
                <SettingRow icon={<Clock size={18} />} title="Apontar o DNS" summary="Crie o registro no painel do domínio e clique em Verificar" summaryTone="warn" description="No painel onde o domínio foi registrado (Registro.br, GoDaddy, Cloudflare, Hostinger…), crie este registro:" footer="close" size="lg">
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-[12px] border border-line bg-ground p-3 font-mono text-[13px]">
                    <span className="text-muted">Tipo</span>
                    <span>{record.type}</span>
                    <span className="text-muted">Nome</span>
                    <span>{record.name}</span>
                    <span className="text-muted">Valor</span>
                    <span className="flex items-center gap-2 break-all">
                      {record.value}
                      <CopyButton text={record.value} label="Copiar" className="btn-icon h-auto w-auto px-1.5 py-0.5 text-xs" icon={false} />
                    </span>
                  </div>
                  {apex && <p className="text-xs text-muted">Domínio raiz usa registro A. Se preferir, use um subdomínio (ex.: chat.{domain}) com CNAME; costuma ser mais simples.</p>}
                  {record.type === "CNAME" && <p className="text-xs text-muted">Na Cloudflare, deixe a nuvem cinza (“DNS only”).</p>}
                  {!vercelDomainsEnabled() && <p className="text-xs text-muted">Este servidor não tem a integração com a Vercel configurada: o domínio também precisa ser adicionado em Vercel → Project → Settings → Domains.</p>}
                  <p className="text-xs text-muted">O DNS pode levar de alguns minutos a algumas horas. Até verificar, os links continuam no endereço padrão.</p>
                  <ActionForm action={verifyCustomDomain} className="self-start">
                    <SubmitButton pendingLabel="Verificando…" className="btn-primary">
                      Verificar agora
                    </SubmitButton>
                  </ActionForm>
                </SettingRow>
              )}
            </>
          )}
        </SettingGroup>
        {!business && (
          <HowItWorks label="Para quem é o domínio próprio">
            <p>
              O domínio próprio é para os seus clientes: por ele, eles e os prospects acessam as demos, o portal com o relatório, a área do cliente e o chat do site. Este painel, onde você configura tudo, continua em {host}. Abrir o painel pelo seu
              domínio mostra só uma página com a sua marca.
            </p>
          </HowItWorks>
        )}
      </div>

      <SettingGroup title="Privacidade e LGPD">
        <SettingRow
          icon={<FileText size={18} />}
          title="Política de privacidade"
          summary={agency.privacy_url ?? "Sem link: o chat só avisa que a conversa fica registrada"}
          description="O chat avisa o visitante que a conversa fica registrada para o atendimento. Com o link, aparece também “Privacidade” embaixo do chat, em todos os seus chatbots."
          action={updatePrivacy}
        >
          <div>
            <label htmlFor="privacy_url" className="label">
              Link da política de privacidade
            </label>
            <input id="privacy_url" name="privacy_url" type="url" maxLength={400} defaultValue={agency.privacy_url ?? ""} className="input" placeholder="https://suaagencia.com.br/privacidade" />
            <p className="mt-1 text-xs text-muted">Opcional. Para tirar, apague e salve.</p>
          </div>
        </SettingRow>
        <SettingRow
          icon={<Archive size={18} />}
          title="Guardar conversas e contatos"
          summary={pending ? `Muda para ${pending.months} meses em ${pending.at}; até lá, ${now}` : agency.retention_months ? `Por ${now}; depois, apaga sozinho` : "Sem prazo: nada é apagado sozinho"}
          summaryTone={pending ? "warn" : undefined}
          trailing={
            pending && agency.retention_months ? (
              <ActionForm action={undoAgencyRetention}>
                <SubmitButton className="btn-ghost py-1.5 text-xs">Desfazer</SubmitButton>
              </ActionForm>
            ) : undefined
          }
          description="A LGPD pede guardar só pelo tempo necessário. Todo dia o BoaVoz apaga as conversas paradas há mais tempo que o prazo (com as mensagens), os leads, as perguntas sem resposta e as fichas de contato sem conversa. Os relatórios continuam com os números de todos os meses."
          action={updatePrivacy}
        >
          <RetentionField name="retention_months" value={pending?.months ?? agency.retention_months ?? DEFAULT_RETENTION_MONTHS} options={RETENTION_MONTHS} />
          <p className="text-xs text-muted">Diminuir o prazo vale em 30 dias (dá para desfazer até lá); aumentar vale na hora. Cada cliente pode ter um prazo próprio (Clientes → Dados do cliente), e o modo dados sensíveis de um chatbot vale antes dos dois.</p>
          {pending && (
            <p className="rounded-[12px] bg-amber-soft px-3 py-2 text-xs text-amber-ink">
              O prazo muda para {pending.months} meses em {pending.at}; até lá vale {agency.retention_months ? now : "o “Não apagar”"}.{" "}
              <a href="/api/leads/export" className="font-semibold underline">
                Exportar os leads
              </a>
            </p>
          )}
        </SettingRow>
      </SettingGroup>
    </div>
  );
}
