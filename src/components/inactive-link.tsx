import { Link2Off } from "lucide-react";

/**
 * Link público (portal do cliente, demo) que não vale mais. Neutro de propósito: quem abre
 * é o cliente da agência, então nada de marca da plataforma nem redirecionar para a landing.
 */
export function InactiveLink({ title, text }: { title: string; text: string }) {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 bg-ground px-6 py-16 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-line-2 text-muted"><Link2Off size={24} /></span>
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="max-w-sm text-sm text-muted">{text}</p>
    </main>
  );
}
