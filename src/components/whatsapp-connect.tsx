"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageCircle } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { useToast } from "@/components/ui/toast";

interface SessionInfo {
  /** Não vem na coexistência (a Meta só informa a conta). */
  phoneNumberId?: string | null;
  wabaId: string;
  businessId?: string | null;
}

/** Eventos de fim do cadastro: número novo (FINISH) ou o app do celular (coexistência). */
const FINISH_EVENTS = new Set(["FINISH", "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"]);

interface FacebookSdk {
  init(opts: { appId: string; autoLogAppEvents: boolean; xfbml: boolean; version: string; fedCM?: boolean }): void;
  login(cb: (res: { authResponse?: { code?: string } | null }) => void, opts: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_ID = "facebook-jssdk";

/** Carrega o SDK do Facebook uma vez por página e resolve quando o FB.init já rodou. */
function loadSdk(appId: string, version: string): Promise<FacebookSdk> {
  if (window.FB) return Promise.resolve(window.FB);
  return new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      // sem FedCM: no Chrome o SDK abriria um login comum (response_type=token) que ignora o config_id
      window.FB!.init({ appId, autoLogAppEvents: true, xfbml: true, version, fedCM: false });
      resolve(window.FB!);
    };
    if (document.getElementById(SDK_ID)) return;
    const s = document.createElement("script");
    s.id = SDK_ID;
    s.src = "https://connect.facebook.net/pt_BR/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("sdk"));
    document.body.appendChild(s);
  });
}

/**
 * Botão do cadastro incorporado da Meta: o cliente entra com o Facebook, escolhe (ou cria) a
 * conta do WhatsApp e o número, e a Meta devolve um código (FB.login) e os IDs (postMessage).
 * Com os dois em mãos, a server action termina a conexão.
 */
export function WhatsAppConnect({ appId, configId, graphVersion, action, coexistence = false, label = "Conectar WhatsApp", primary = true }: {
  appId: string;
  configId: string;
  graphVersion: string;
  action: (input: SessionInfo & { code: string; coexistence?: boolean }) => Promise<ActionResult>;
  /** Conectar o WhatsApp Business que o cliente já usa no celular, sem tirar o número do app. */
  coexistence?: boolean;
  label?: string;
  primary?: boolean;
}) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const session = useRef<SessionInfo | null>(null);

  useEffect(() => {
    loadSdk(appId, graphVersion).catch(() => {});
    const onMessage = (event: MessageEvent) => {
      if (!event.origin.endsWith("facebook.com")) return;
      let data: { type?: string; event?: string; data?: { phone_number_id?: string; waba_id?: string; business_id?: string } };
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (FINISH_EVENTS.has(data.event ?? "") && data.data?.waba_id) {
        session.current = { phoneNumberId: data.data.phone_number_id ?? null, wabaId: data.data.waba_id, businessId: data.data.business_id ?? null };
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [appId, graphVersion]);

  async function finish(code: string) {
    // os IDs chegam por postMessage, às vezes um instante depois do código
    for (let i = 0; i < 20 && !session.current; i++) await new Promise((r) => setTimeout(r, 250));
    const info = session.current;
    if (!info) {
      toast.error("A Meta não informou qual número foi escolhido. Tente conectar de novo.");
      return setBusy(false);
    }
    try {
      const r = await action({ code, ...info, coexistence });
      if (r.ok) {
        toast.success(r.message ?? "WhatsApp conectado.");
        router.refresh();
      } else toast.error(r.message);
    } catch {
      toast.error("Não foi possível concluir agora. Verifique a conexão e tente de novo.");
    }
    setBusy(false);
  }

  async function start() {
    setBusy(true);
    session.current = null;
    let fb: FacebookSdk;
    try {
      fb = await loadSdk(appId, graphVersion);
    } catch {
      toast.error("Não deu para abrir a janela da Meta. Desative o bloqueador de anúncios nesta página e tente de novo.");
      return setBusy(false);
    }
    // o SDK não aceita callback async: o trabalho assíncrono fica em finish()
    fb.login(
      (res) => {
        const code = res.authResponse?.code;
        if (code) void finish(code);
        else {
          toast.toast("Conexão cancelada.");
          setBusy(false);
        }
      },
      // sessionInfoVersion 3: formato do postMessage lido acima (o mesmo do link hospedado da Meta)
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, version: "v4", sessionInfoVersion: "3", ...(coexistence ? { featureType: "whatsapp_business_app_onboarding" } : {}) },
      },
    );
  }

  return (
    <button type="button" onClick={start} disabled={busy} className={primary ? "btn-primary self-start" : "btn-ghost self-start"}>
      <MessageCircle size={16} />
      {busy ? "Conectando…" : label}
    </button>
  );
}
