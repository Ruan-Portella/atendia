import Link from "next/link";
import { Compass } from "lucide-react";

/** Dentro da área do cliente (menu e marca da agência continuam aí): neutro, sem a BoaVoz (white-label). */
export default function MemberAreaNotFound() {
  return (
    <div className="card mx-auto flex w-full max-w-[520px] flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[14px] bg-brand-soft text-brand">
        <Compass size={22} />
      </span>
      <h1 className="text-lg font-medium text-ink">Não encontramos isso</h1>
      <p className="max-w-[400px] text-sm text-muted">Pode ter sido removido, ou o seu acesso a esta parte foi alterado pela agência.</p>
      <Link href="/cliente" className="btn-primary mt-1">
        Voltar para o início
      </Link>
    </div>
  );
}
