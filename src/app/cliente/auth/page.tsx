import { LogIn } from "lucide-react";
import { hostAgency } from "@/lib/domain-server";
import { initials } from "@/lib/utils";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { confirmAccess } from "../actions";

export const metadata = { title: { absolute: "Entrar na área do cliente" }, robots: { index: false, follow: false } };

/**
 * Destino do link do e-mail. Mostra um botão em vez de entrar direto: o token só é usado no
 * clique (ver confirmAccess), para os robôs que abrem links de e-mail não gastarem o acesso.
 */
export default async function MemberAuthPage({ searchParams }: PageProps<"/cliente/auth">) {
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const agency = await hostAgency();
  const name = agency?.name;
  return (
    <main className="flex flex-1 flex-col items-center justify-center bg-ground px-4 py-12">
      <div className="card flex w-full max-w-[400px] flex-col items-center gap-5 p-6 text-center sm:p-7">
        {agency?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={agency.logo_url} alt="" className="h-12 w-12 rounded-xl object-contain" />
        ) : name ? (
          <span className="display flex h-12 w-12 items-center justify-center rounded-xl font-bold text-white" style={{ background: agency?.brand_color ?? "#1f4e3d" }}>{initials(name)}</span>
        ) : null}
        <div>
          <h1 className="text-xl font-bold">Entrar na área do cliente</h1>
          <p className="text-sm text-muted">Clique no botão para concluir o acesso{name ? ` com ${name}` : ""}.</p>
        </div>
        <ActionForm action={confirmAccess.bind(null, str(sp.token_hash), str(sp.type), str(sp.next))} className="w-full">
          <SubmitButton pendingLabel="Entrando…" className="btn-primary w-full" style={agency?.brand_color ? { background: agency.brand_color } : undefined}>
            <LogIn size={15} />Entrar
          </SubmitButton>
        </ActionForm>
      </div>
    </main>
  );
}
