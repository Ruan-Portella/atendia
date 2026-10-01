import Link from "next/link";
import { LegalPage, Section } from "@/components/legal-page";
import { createAdminClient } from "@/lib/supabase/admin";
import { company } from "@/lib/company";

export const metadata = { title: "Status da exclusão de dados", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Página que a Meta mostra a quem pediu a exclusão dos dados (link devolvido pelo callback).
 * Só o andamento do pedido pelo código de confirmação, sem nenhum dado pessoal.
 */
export default async function DeletionStatusPage({ searchParams }: PageProps<"/exclusao-de-dados/status">) {
  const sp = await searchParams;
  const code = typeof sp.codigo === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(sp.codigo) ? sp.codigo : null;
  const { data: req } = code ? await createAdminClient().from("deletion_requests").select("status, created_at, completed_at").eq("code", code).maybeSingle() : { data: null };
  const date = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long", timeStyle: "short" });

  return (
    <LegalPage title="Status da exclusão de dados" intro={`Acompanhamento do pedido de exclusão feito pelas configurações da Meta (Instagram ou Facebook) para a ${company.brand}.`}>
      <Section title={code ? `Pedido ${code}` : "Pedido não informado"}>
        {!req ? (
          <p>Não encontramos um pedido com esse código. Confira o link recebido ou escreva para <a href={`mailto:${company.email}`}>{company.email}</a>.</p>
        ) : req.status === "completed" ? (
          <p>
            <strong>Concluído</strong> em {date(req.completed_at as string)}. A conexão da conta e os dados recebidos por ela foram apagados. Cópias de segurança expiram sozinhas e, se alguma for restaurada, a exclusão é aplicada de novo.
          </p>
        ) : (
          <p>
            <strong>Recebido</strong> em {date(req.created_at as string)} e em andamento. Concluímos em até 15 dias.
          </p>
        )}
      </Section>
      <p className="text-sm">
        Mais detalhes em <Link href="/exclusao-de-dados">Exclusão de dados</Link>.
      </p>
    </LegalPage>
  );
}
