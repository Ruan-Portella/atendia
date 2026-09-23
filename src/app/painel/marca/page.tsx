import Link from "next/link";
import { CheckCircle2, Clock, Info } from "lucide-react";
import { requireAgency } from "@/lib/agency";
import { saveCustomDomain, updateAgency, updatePrivacy, verifyCustomDomain } from "../actions";
import { LogoUpload } from "@/components/logo-upload";
import { appUrl } from "@/lib/utils";
import { isApexDomain, recommendedDnsRecord, vercelDomainsEnabled } from "@/lib/domain";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { CopyButton } from "@/components/copy-button";

export const metadata = { title: "Marca e domínio" };

export default async function MarcaPage() {
  const { agency, plan } = await requireAgency();
  const domain = agency.custom_domain;
  const verified = Boolean(domain && agency.custom_domain_verified_at);
  const apex = domain ? isApexDomain(domain) : false;
  // só pergunta à Vercel enquanto falta configurar o DNS
  const record = domain && !verified ? await recommendedDnsRecord(domain) : null;

  return (
    <div className="flex max-w-[640px] flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold sm:text-[28px]">Marca e domínio</h1>
        <p className="text-sm text-muted">O que seus clientes e prospects veem: no rodapé do chat, na página de demo, no portal e nos e-mails.</p>
      </div>
      <ActionForm key={[agency.name, agency.brand_color, agency.logo_url, agency.support_whatsapp].join("|")} action={updateAgency} className="card flex flex-col gap-4 p-6">
        <div><label htmlFor="name" className="label">Nome da agência</label><input id="name" name="name" defaultValue={agency.name} required minLength={2} maxLength={80} className="input" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="brand_color" className="label">Cor padrão dos novos chatbots</label><input id="brand_color" name="brand_color" type="color" defaultValue={agency.brand_color} className="input h-11 p-1" /></div>
          <div><label htmlFor="support_whatsapp" className="label">Seu WhatsApp (botão na demo e no portal)</label><input id="support_whatsapp" name="support_whatsapp" defaultValue={agency.support_whatsapp ?? ""} maxLength={30} className="input" placeholder="5541999999999" /></div>
        </div>
        <LogoUpload current={agency.logo_url} agencyId={agency.id} />
        <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
      </ActionForm>

      <section className="card flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-base font-bold">Domínio próprio</h2>
          <p className="text-sm text-muted">Demos, portal do cliente e o código do widget passam a usar o seu endereço (ex.: <code>chat.suaagencia.com.br</code>) em vez de {appUrl("").replace(/^https?:\/\//, "")}.</p>
        </div>
        <div className="flex gap-2.5 rounded-lg border border-line bg-ground px-3.5 py-3 text-sm text-ink-2">
          <Info size={16} className="mt-0.5 shrink-0 text-muted" />
          <p>
            <strong className="text-ink">O domínio próprio é para os seus clientes.</strong> Por ele, eles e os prospects acessam as demos, o portal com o relatório, a área do cliente e o chat do site. Este painel, onde você configura tudo, continua em{" "}
            <strong className="text-ink">{appUrl("").replace(/^https?:\/\//, "")}</strong>. Abrir o painel pelo seu domínio mostra só uma página com a sua marca.
          </p>
        </div>
        {!plan.customDomain ? (
          <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Disponível a partir do plano Agência. <Link href="/painel/cobranca" className="font-semibold underline">Ver planos</Link></p>
        ) : (
          <>
            <ActionForm key={domain ?? ""} action={saveCustomDomain} className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <label htmlFor="custom_domain" className="label">Domínio</label>
                <input id="custom_domain" name="custom_domain" defaultValue={domain ?? ""} maxLength={120} className="input" placeholder="chat.suaagencia.com.br" />
              </div>
              <SubmitButton className="btn-ghost">Salvar domínio</SubmitButton>
            </ActionForm>
            {verified && <p className="text-xs text-muted">Atenção: trocar ou apagar o domínio faz o widget parar nos sites onde foi instalado com o domínio atual. Reinstale o código novo nesses sites.</p>}

            {domain && (
              verified || !record ? (
                <p className="flex items-center gap-2 rounded-lg bg-brand-soft px-3 py-2 text-sm font-semibold text-brand"><CheckCircle2 size={16} />https://{domain} está no ar.</p>
              ) : (
                <div className="flex flex-col gap-3 rounded-xl border border-line bg-ground p-4 text-sm">
                  <p className="flex items-center gap-2 font-semibold"><Clock size={16} className="text-amber-ink" />Falta apontar o DNS</p>
                  <p className="text-ink-2">No painel onde o domínio foi registrado (Registro.br, GoDaddy, Cloudflare, Hostinger…), crie este registro:</p>
                  <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border border-line bg-panel p-3 font-mono text-[13px]">
                    <span className="text-muted">Tipo</span><span>{record.type}</span>
                    <span className="text-muted">Nome</span><span>{record.name}</span>
                    <span className="text-muted">Valor</span><span className="flex items-center gap-2 break-all">{record.value}<CopyButton text={record.value} label="Copiar" className="btn-icon h-auto w-auto px-1.5 py-0.5 text-xs" icon={false} /></span>
                  </div>
                  {apex && <p className="text-xs text-muted">Domínio raiz usa registro A. Se preferir, use um subdomínio (ex.: chat.{domain}) com CNAME; costuma ser mais simples.</p>}
                  {record.type === "CNAME" && <p className="text-xs text-muted">Na Cloudflare, deixe a nuvem cinza (“DNS only”).</p>}
                  {!vercelDomainsEnabled() && <p className="text-xs text-muted">Este servidor não tem a integração com a Vercel configurada: o domínio também precisa ser adicionado em Vercel → Project → Settings → Domains.</p>}
                  <ActionForm action={verifyCustomDomain} className="self-start">
                    <SubmitButton pendingLabel="Verificando…" className="btn-primary">Verificar agora</SubmitButton>
                  </ActionForm>
                  <p className="text-xs text-muted">O DNS pode levar de alguns minutos a algumas horas. Até verificar, os links continuam no endereço padrão.</p>
                </div>
              )
            )}
          </>
        )}
      </section>

      <section className="card flex flex-col gap-4 p-6">
        <div>
          <h2 className="text-base font-bold">Privacidade e LGPD</h2>
          <p className="text-sm text-muted">O chat avisa o visitante que a conversa fica registrada para o atendimento. Aqui você coloca o link da sua política de privacidade e decide por quanto tempo guardar os dados.</p>
        </div>
        <ActionForm key={`${agency.privacy_url ?? ""}|${agency.retention_months ?? ""}`} action={updatePrivacy} className="flex flex-col gap-4">
          <div>
            <label htmlFor="privacy_url" className="label">Link da política de privacidade (opcional)</label>
            <input id="privacy_url" name="privacy_url" type="url" maxLength={400} defaultValue={agency.privacy_url ?? ""} className="input" placeholder="https://suaagencia.com.br/privacidade" />
            <p className="mt-1 text-xs text-muted">Aparece como “Privacidade” embaixo do chat, em todos os seus chatbots.</p>
          </div>
          <div>
            <label htmlFor="retention_months" className="label">Apagar conversas e contatos automaticamente depois de</label>
            <select id="retention_months" name="retention_months" defaultValue={agency.retention_months ? String(agency.retention_months) : ""} className="input max-w-[260px]">
              <option value="">Não apagar</option>
              <option value="6">6 meses</option>
              <option value="12">12 meses</option>
              <option value="24">24 meses</option>
            </select>
            <p className="mt-1 text-xs text-muted">A LGPD pede guardar só pelo tempo necessário. Os relatórios de meses já apagados passam a mostrar zero.</p>
          </div>
          <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
        </ActionForm>
      </section>
    </div>
  );
}
