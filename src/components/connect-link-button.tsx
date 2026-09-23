"use client";

import { useState, useTransition } from "react";
import { Link2, MessageCircle } from "lucide-react";
import { CopyButton } from "@/components/copy-button";
import { useToast } from "@/components/ui/toast";

/**
 * "Enviar link ao cliente": gera o link de conexão do WhatsApp (vale 7 dias, uma conexão) para o
 * próprio cliente conectar o número com o Facebook dele, sem a agência precisar desse acesso.
 */
export function ConnectLinkButton({ action, clientName }: { action: () => Promise<{ ok: true; url: string } | { ok: false; message: string }>; clientName: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();

  const generate = () =>
    start(async () => {
      try {
        const r = await action();
        if (r.ok) setUrl(r.url);
        else toast.error(r.message);
      } catch {
        toast.error("Não foi possível criar o link. Verifique a conexão e tente de novo.");
      }
    });

  if (!url) {
    return (
      <button type="button" onClick={generate} disabled={pending} className="btn-ghost self-start">
        <Link2 size={15} />
        {pending ? "Gerando link…" : "Gerar link para o cliente conectar"}
      </button>
    );
  }

  const message = `Oi! Para o assistente de ${clientName} responder no WhatsApp, falta conectar o seu número. Leva uns 5 minutos, com o login do seu Facebook: ${url}`;
  return (
    <div className="flex flex-col gap-2">
      <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="input font-mono text-xs" aria-label="Link de conexão" />
      <div className="flex flex-wrap gap-2">
        <CopyButton text={url} label="Copiar link" />
        <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener" className="btn-ghost">
          <MessageCircle size={15} />
          Mandar pelo WhatsApp
        </a>
        <button type="button" onClick={generate} disabled={pending} className="text-xs font-semibold text-muted hover:underline">Gerar outro</button>
      </div>
      <p className="text-xs text-muted">Vale 7 dias e para uma conexão. Gerar outro invalida este. Quando o cliente conectar, você recebe um e-mail e esta aba mostra o número.</p>
    </div>
  );
}
