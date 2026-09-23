import { NEUTRAL_ICONS } from "@/lib/white-label";

// white-label: a aba mostra um ícone neutro, nunca o da plataforma
export const metadata = { icons: NEUTRAL_ICONS };

export default function WhiteLabelLayout({ children }: { children: React.ReactNode }) {
  return children;
}
