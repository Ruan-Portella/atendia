import { NEUTRAL_ICONS } from "@/lib/white-label";

// white-label: a aba mostra um ícone neutro, nunca o da plataforma; o manifest deixa adicionar à
// tela de início (no iPhone, os avisos no celular só chegam assim; Memória e avisos, parte 2)
export const metadata = { icons: NEUTRAL_ICONS, manifest: "/manifest.webmanifest?area=cliente", appleWebApp: { capable: true } };

export default function WhiteLabelLayout({ children }: { children: React.ReactNode }) {
  return children;
}
