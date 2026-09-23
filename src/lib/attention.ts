"use client";

/**
 * Chamar a atenção de quem está no painel (agência ou área do cliente):
 *  - som curto (gerado na hora, sem arquivo);
 *  - contador no título da aba "(2) …" enquanto a aba está em segundo plano;
 *  - notificação do navegador, se a pessoa permitiu.
 * O contador zera quando a aba volta a ficar visível.
 */

let unseen = 0;
let listening = false;

const cleanTitle = () => document.title.replace(/^\(\d+\+?\) /, "");

function applyTitle() {
  const base = cleanTitle();
  document.title = unseen > 0 ? `(${unseen > 9 ? "9+" : unseen}) ${base}` : base;
}

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      unseen = 0;
      applyTitle();
    }
  });
}

let audio: AudioContext | null = null;

/** Dois bipes curtos. Navegadores só liberam som depois de algum clique na página; sem isso, fica mudo. */
export function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    audio ??= new Ctx();
    if (audio.state === "suspended") void audio.resume();
    const t = audio.currentTime;
    for (const [start, freq] of [[0, 880], [0.16, 1175]] as const) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, t + start);
      gain.gain.exponentialRampToValueAtTime(0.18, t + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + start + 0.14);
      osc.connect(gain).connect(audio.destination);
      osc.start(t + start);
      osc.stop(t + start + 0.15);
    }
  } catch {
    // sem áudio disponível: segue só com o visual
  }
}

export const browserNotificationsSupported = () => typeof window !== "undefined" && "Notification" in window;

export function signal(opts: { title: string; body?: string; href?: string; tag?: string; sound?: boolean }) {
  listen();
  if (opts.sound !== false) beep();
  if (!document.hidden) return;
  unseen++;
  applyTitle();
  if (browserNotificationsSupported() && Notification.permission === "granted") {
    try {
      const n = new Notification(opts.title, { body: opts.body, tag: opts.tag });
      n.onclick = () => {
        window.focus();
        if (opts.href) window.location.href = opts.href;
        n.close();
      };
    } catch {
      // alguns navegadores móveis só notificam via service worker: fica o título e o som
    }
  }
}
