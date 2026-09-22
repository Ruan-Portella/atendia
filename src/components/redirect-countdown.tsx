"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** "Voltando em 5 s…" e depois leva para `href` (o visitante pode clicar antes). */
export function RedirectCountdown({ href, seconds = 6 }: { href: string; seconds?: number }) {
  const router = useRouter();
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    const t = window.setInterval(() => setLeft((n) => n - 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (left <= 0) router.replace(href);
  }, [left, href, router]);
  return <span className="tabular">{Math.max(0, left)}</span>;
}
