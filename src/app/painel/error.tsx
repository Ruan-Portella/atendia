"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertCircle } from "lucide-react";

/**
 * Qualquer erro inesperado numa página do painel cai aqui, dentro do layout (o menu continua
 * funcionando), em vez de derrubar a aplicação inteira.
 */
export default function PainelError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="card flex max-w-[560px] flex-col items-start gap-3 p-6">
      <span className="flex items-center gap-2 font-semibold text-danger"><AlertCircle size={18} />Algo deu errado ao carregar esta página.</span>
      <p className="text-sm text-muted">Pode ter sido uma falha passageira de conexão. Tente de novo; se continuar, volte para o início do painel.{error.digest ? ` (código ${error.digest})` : ""}</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => retry()} className="btn-primary">Tentar de novo</button>
        <Link href="/painel" className="btn-ghost">Ir para o painel</Link>
      </div>
    </div>
  );
}
