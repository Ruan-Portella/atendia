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

  // redesenho (23/10/2026): no estilo dos estados vazios do painel
  return (
    <div className="card mx-auto flex w-full max-w-[520px] flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-danger-soft text-danger">
        <AlertCircle size={22} />
      </span>
      <h1 className="text-lg font-medium text-ink">Algo deu errado ao carregar esta página</h1>
      <p className="max-w-[400px] text-sm text-muted">Pode ter sido uma falha passageira de conexão. Tente de novo; se continuar, volte para o início do painel.{error.digest ? ` (código ${error.digest})` : ""}</p>
      <div className="mt-1 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={() => retry()} className="btn-primary">
          Tentar de novo
        </button>
        <Link href="/painel/clientes" className="btn-ghost">
          Ir para o painel
        </Link>
      </div>
    </div>
  );
}
