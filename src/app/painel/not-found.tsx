import Link from "next/link";
import { Compass } from "lucide-react";
import { RedirectCountdown } from "@/components/redirect-countdown";

/** Dentro do painel (menu continua aí): cliente, chatbot ou conversa que não existe mais. */
export default function PainelNotFound() {
  // redesenho (23/10/2026): no estilo dos estados vazios do painel
  return (
    <div className="card mx-auto flex w-full max-w-[520px] flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-brand-soft text-brand">
        <Compass size={22} />
      </span>
      <h1 className="text-lg font-medium text-ink">Não encontramos isso no seu painel</h1>
      <p className="max-w-[400px] text-sm text-muted">
        Pode ter sido excluído, ou o link está incompleto. Voltando para Clientes em <RedirectCountdown href="/painel/clientes" /> s.
      </p>
      <Link href="/painel/clientes" className="btn-primary mt-1">
        Ir para Clientes
      </Link>
    </div>
  );
}
