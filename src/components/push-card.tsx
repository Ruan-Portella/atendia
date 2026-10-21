"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing } from "lucide-react";
import type { ActionResult } from "@/lib/action-result";
import { ActionForm } from "@/components/ui/action-form";
import { SubmitButton } from "@/components/ui/submit-button";
import { useToast } from "@/components/ui/toast";

const dateBr = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(iso));
const dateTimeBr = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** A chave pública VAPID (base64url) no formato que o navegador pede. */
function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const k = sub.options.applicationServerKey;
  if (!k) return false;
  const a = new Uint8Array(k);
  return a.length === key.length && a.every((v, i) => v === key[i]);
}

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

type Local = "checking" | "unsupported" | "ios-install" | "denied" | "off" | "on";

interface Device {
  id: string;
  label: string | null;
  created_at: string;
  last_sent_at: string | null;
  endpoint: string;
}

interface Props {
  publicKey: string;
  devices: Device[];
  kinds: Array<{ kind: string; label: string }>;
  prefs: Record<string, boolean> | null;
  subscribe: (json: string) => Promise<ActionResult>;
  unsubscribe: (endpoint: string) => Promise<ActionResult>;
  remove: (formData: FormData) => Promise<ActionResult>;
  savePrefs: (formData: FormData) => Promise<ActionResult>;
  test: (formData: FormData) => Promise<ActionResult>;
}

/**
 * Avisos no celular e no computador (Memória e avisos, parte 2): ativa neste aparelho (a permissão
 * do navegador e o endereço do aviso), mostra os aparelhos ativos e quais tipos de aviso chegam. No
 * iPhone, só com o site adicionado à tela de início (o Safari só deixa assim). Painel e área do cliente.
 */
export function PushCard({ publicKey, devices, kinds, prefs, subscribe, unsubscribe, remove, savePrefs, test }: Props) {
  const toast = useToast();
  const router = useRouter();
  const [local, setLocal] = useState<Local>("checking");
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const mine = devices.map((d) => d.endpoint).join("\n");

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return isIos() && !standalone() ? "ios-install" : "unsupported";
      if (Notification.permission === "denied") return "denied";
      const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
      if (alive) setEndpoint(sub?.endpoint ?? null);
      // o aparelho tem um endereço, mas ele é de outra pessoa (ou saiu): ativar passa para você
      return sub && mine.split("\n").includes(sub.endpoint) ? "on" : "off";
    })()
      .then((s: Local) => alive && setLocal(s))
      .catch(() => alive && setLocal("unsupported"));
    return () => {
      alive = false;
    };
  }, [mine]);

  const activate = () =>
    start(async () => {
      try {
        // a permissão sai no toque (o Safari só pergunta assim)
        const perm = await Notification.requestPermission();
        if (perm !== "granted") {
          setLocal(perm === "denied" ? "denied" : "off");
          toast.error("Sem a permissão do navegador, os avisos não chegam neste aparelho.");
          return;
        }
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        const key = keyBytes(publicKey);
        let sub = await reg.pushManager.getSubscription();
        if (sub && !sameKey(sub, key)) {
          await sub.unsubscribe();
          sub = null;
        }
        sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const r = await subscribe(JSON.stringify(sub.toJSON()));
        if (!r.ok) return toast.error(r.message);
        setEndpoint(sub.endpoint);
        setLocal("on");
        toast.success(r.message ?? "Avisos ativados neste aparelho.");
        router.refresh();
      } catch {
        toast.error("Não foi possível ativar neste aparelho. Tente de novo.");
      }
    });

  const deactivate = () =>
    start(async () => {
      try {
        const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
        if (sub) {
          await unsubscribe(sub.endpoint);
          await sub.unsubscribe().catch(() => false);
        }
        setLocal("off");
        toast.success("Pronto: este aparelho não recebe mais os avisos.");
        router.refresh();
      } catch {
        toast.error("Não foi possível desativar agora. Tente de novo.");
      }
    });

  return (
    <section className="card flex flex-col gap-4 p-6">
      <div className="flex items-start gap-2.5">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
        <div>
          <h2 className="text-base font-bold">Avisos no celular e no computador</h2>
          <p className="text-sm text-muted">
            O aviso aparece na tela, mesmo com o painel fechado: pedido de atendente, conversa transferida para você, lead novo. Ative em cada aparelho que você usa.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-line-2 p-3 text-sm">
        {local === "checking" && <p className="text-muted">Conferindo este aparelho…</p>}
        {local === "unsupported" && <p className="text-muted">Este navegador não recebe avisos. No computador, use o Chrome, o Edge, o Firefox ou o Safari; no celular, o Chrome (Android) ou o Safari (iPhone).</p>}
        {local === "ios-install" && (
          <div className="flex flex-col gap-1">
            <p className="font-semibold">No iPhone, os avisos só chegam com o site na tela de início</p>
            <ol className="list-decimal pl-5 text-muted">
              <li>No Safari, toque em Compartilhar (o quadrado com a seta).</li>
              <li>Toque em Adicionar à Tela de Início.</li>
              <li>Abra pelo ícone novo, entre em Meu perfil e toque em Ativar neste aparelho.</li>
            </ol>
          </div>
        )}
        {local === "denied" && <p className="text-muted">As notificações estão bloqueadas para este site no navegador. Libere nas configurações do site (o cadeado ao lado do endereço) e volte aqui.</p>}
        {local === "off" && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>Este aparelho ainda não recebe os avisos.</p>
            <button type="button" className="btn-primary" onClick={activate} disabled={pending}>
              {pending ? "Ativando…" : "Ativar neste aparelho"}
            </button>
          </div>
        )}
        {local === "on" && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p>
              <span className="font-semibold text-brand">Ativo neste aparelho.</span> <span className="text-muted">Os avisos chegam aqui.</span>
            </p>
            <div className="flex flex-wrap gap-2">
              <ActionForm action={test} success="Mandamos o teste.">
                <SubmitButton className="btn-ghost py-1.5 text-xs" pendingLabel="Mandando…">
                  Enviar um teste
                </SubmitButton>
              </ActionForm>
              <button type="button" className="btn-ghost py-1.5 text-xs" onClick={deactivate} disabled={pending}>
                {pending ? "Desativando…" : "Desativar neste aparelho"}
              </button>
            </div>
          </div>
        )}
      </div>

      {devices.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-semibold">Aparelhos que recebem</p>
          <ul className="flex flex-col divide-y divide-line-2 rounded-lg border border-line-2 text-sm">
            {devices.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {d.label ?? "Aparelho"}
                    {d.endpoint === endpoint && local === "on" && <span className="font-normal text-muted"> · este aparelho</span>}
                  </p>
                  <p className="text-xs text-muted">
                    Ativado em {dateBr(d.created_at)}
                    {d.last_sent_at ? ` · último aviso em ${dateTimeBr(d.last_sent_at)}` : " · nenhum aviso ainda"}
                  </p>
                </div>
                <ActionForm action={remove} success="Aparelho removido.">
                  <input type="hidden" name="device" value={d.id} />
                  <SubmitButton className="text-xs font-semibold text-danger hover:underline" pendingLabel="Removendo…">
                    Remover
                  </SubmitButton>
                </ActionForm>
              </li>
            ))}
          </ul>
        </div>
      )}

      {devices.length > 0 && (
        <ActionForm action={savePrefs} success="Avisos salvos." className="flex flex-col gap-2 rounded-lg border border-line-2 p-3">
          <p className="text-xs font-semibold">Quais avisos chegam nos aparelhos</p>
          {kinds.map((k) => (
            <label key={k.kind} className="flex items-center gap-2 text-sm">
              <input type="checkbox" name={`push_${k.kind}`} defaultChecked={prefs?.[k.kind] !== false} className="h-4 w-4 accent-brand" />
              {k.label}
            </label>
          ))}
          <p className="text-[11px] text-muted">Só o que aconteceu e o link para a conversa: o conteúdo das mensagens nunca vai no aviso.</p>
          <SubmitButton className="btn-ghost self-start py-1.5 text-xs">Salvar os avisos</SubmitButton>
        </ActionForm>
      )}
    </section>
  );
}
