import { hostAgency } from "@/lib/domain-server";
import { initials } from "@/lib/utils";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { requestAccessLink } from "../actions";

export const metadata = { title: { absolute: "Área do cliente" }, robots: { index: false, follow: false } };

/** Entrada da área do cliente: só e-mail, o link chega na caixa de entrada. Neutra (white-label). */
export default async function MemberLoginPage({ searchParams }: PageProps<"/cliente/entrar">) {
  const sp = await searchParams;
  const agency = await hostAgency();
  const next = typeof sp.next === "string" ? sp.next : "/cliente";
  const name = agency?.name;
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-ground px-4 py-12">
      <div className="card flex w-full max-w-[400px] flex-col gap-5 p-6 sm:p-7">
        <div className="flex flex-col items-center gap-3 text-center">
          {agency?.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agency.logo_url} alt="" className="h-12 w-12 rounded-xl object-contain" />
          ) : name ? (
            <span className="display flex h-12 w-12 items-center justify-center rounded-xl font-bold text-white" style={{ background: agency?.brand_color ?? "#1f4e3d" }}>{initials(name)}</span>
          ) : null}
          <div>
            <h1 className="text-xl font-bold">Área do cliente</h1>
            <p className="text-sm text-muted">Acompanhe e atenda as conversas do seu assistente{name ? `, com ${name}` : ""}.</p>
          </div>
        </div>
        {sp.erro === "link" && <p className="rounded-lg bg-amber-soft px-3 py-2 text-sm text-amber-ink">Esse link expirou ou já foi usado. Peça um novo abaixo.</p>}
        <ActionForm action={requestAccessLink} className="flex flex-col gap-3">
          <input type="hidden" name="next" value={next} />
          <div>
            <label htmlFor="email" className="label">Seu e-mail</label>
            <input id="email" name="email" type="email" required autoComplete="email" className="input" placeholder="voce@empresa.com.br" />
          </div>
          <SubmitButton pendingLabel="Enviando…" className="btn-primary">Receber link de acesso</SubmitButton>
        </ActionForm>
        <p className="text-center text-xs text-muted">Sem senha: mandamos um link que vale por 1 hora. Se não chegar, confira o spam ou peça acesso para a agência.</p>
      </div>
    </main>
  );
}
