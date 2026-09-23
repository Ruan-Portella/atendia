/**
 * Redes sociais que só mostram o conteúdo para quem está logado: o leitor de páginas
 * consegue no máximo a bio (meta description), nunca posts ou legendas.
 */
const NETWORKS: Array<{ name: string; hosts: RegExp }> = [
  { name: "Instagram", hosts: /(^|\.)(instagram\.com|instagr\.am)$/i },
  { name: "Facebook", hosts: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i },
  { name: "TikTok", hosts: /(^|\.)tiktok\.com$/i },
  { name: "LinkedIn", hosts: /(^|\.)linkedin\.com$/i },
  { name: "X (Twitter)", hosts: /(^|\.)(x\.com|twitter\.com)$/i },
  { name: "Threads", hosts: /(^|\.)threads\.(net|com)$/i },
];

/** Nome da rede social da URL (aceita sem https://), ou null se não for uma. */
export function socialNetworkOf(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).hostname;
    return NETWORKS.find((n) => n.hosts.test(host))?.name ?? null;
  } catch {
    return null;
  }
}
