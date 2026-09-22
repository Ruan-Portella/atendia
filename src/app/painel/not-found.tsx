import Link from "next/link";
import { Compass } from "lucide-react";
import { RedirectCountdown } from "@/components/redirect-countdown";

/** Dentro do painel (menu continua aí): cliente, chatbot ou conversa que não existe mais. */
export default function PainelNotFound() {
  return (
    <div className="card flex max-w-[560px] flex-col items-start gap-3 p-6">
      <span className="flex items-center gap-2 font-semibold"><Compass size={18} className="text-brand" />Não encontramos isso no seu painel</span>
      <p className="text-sm text-muted">Pode ter sido excluído, ou o link está incompleto. Voltando para Clientes em <RedirectCountdown href="/painel/clientes" /> s.</p>
      <Link href="/painel/clientes" className="btn-primary">Ir para Clientes</Link>
    </div>
  );
}
