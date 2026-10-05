import { redirect } from "next/navigation";
import { memberHasMfa, requireMember, safeMemberNext } from "@/lib/member";
import { MfaForm } from "@/components/mfa-form";
import { recordMemberMfa } from "../../actions";

export const metadata = { title: { absolute: "Verificação em duas etapas" }, robots: { index: false, follow: false } };

/**
 * Segundo fator no portal (leva B1'): conversas de assistente em modo dados sensíveis e confirmar
 * pedido do titular. Na primeira vez, cadastra o app autenticador aqui mesmo.
 */
export default async function MemberVerifyPage({ params, searchParams }: PageProps<"/cliente/[id]/verificar">) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { member } = await requireMember(id);
  const next = safeMemberNext(id, typeof sp.next === "string" ? sp.next : null);
  if (await memberHasMfa()) redirect(next);
  return (
    <div className="flex justify-center py-6">
      <div className="card flex w-full max-w-[420px] flex-col gap-4 p-6">
        <div>
          <h1 className="text-xl font-bold">Verificação em duas etapas</h1>
          <p className="text-sm text-muted">Conversas com dados sensíveis e a confirmação de pedidos de exclusão pedem o código do app autenticador. O resto da área do cliente continua sem o código.</p>
        </div>
        <MfaForm friendlyName={`Área do cliente ${member.clientName}`.slice(0, 60)} next={next} submitLabel="Continuar" onResult={recordMemberMfa.bind(null, id)} />
      </div>
    </div>
  );
}
