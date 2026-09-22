import { requireAgency } from "@/lib/agency";
import { updateAgency } from "../actions";
import { LogoUpload } from "@/components/logo-upload";
import { appUrl } from "@/lib/utils";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";

export const metadata = { title: "Marca e domínio" };

export default async function MarcaPage() {
  const { agency, plan } = await requireAgency();
  return (
    <div className="max-w-[640px]">
      <h1 className="text-[28px] font-bold">Marca e domínio</h1>
      <p className="text-sm text-muted">O que seus clientes e prospects veem: no rodapé do chat, na página de demo e nos e-mails de lead.</p>
      <ActionForm action={updateAgency} className="card mt-6 flex flex-col gap-4 p-6">
        <div><label htmlFor="name" className="label">Nome da agência</label><input id="name" name="name" defaultValue={agency.name} required className="input" /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label htmlFor="brand_color" className="label">Cor padrão dos novos chatbots</label><input id="brand_color" name="brand_color" type="color" defaultValue={agency.brand_color} className="input h-11 p-1" /></div>
          <div><label htmlFor="support_whatsapp" className="label">Seu WhatsApp (botão na página de demo)</label><input id="support_whatsapp" name="support_whatsapp" defaultValue={agency.support_whatsapp ?? ""} className="input" placeholder="5541999999999" /></div>
        </div>
        <LogoUpload current={agency.logo_url} agencyId={agency.id} />
        <div>
          <label htmlFor="custom_domain" className="label">Domínio próprio para demos e widget {plan.customDomain ? "" : "(plano Agência ou superior)"}</label>
          <input id="custom_domain" name="custom_domain" defaultValue={agency.custom_domain ?? ""} disabled={!plan.customDomain} className="input" placeholder="chat.suaagencia.com.br" />
          <p className="mt-1 text-xs text-muted">Aponte um CNAME para {appUrl("").replace(/^https?:\/\//, "")} e adicione o domínio no projeto da Vercel. Enquanto isso, as demos usam {appUrl("/demo/…")}.</p>
        </div>
        <SubmitButton className="btn-primary self-start">Salvar</SubmitButton>
      </ActionForm>
    </div>
  );
}
