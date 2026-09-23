import type { Metadata } from "next";
import { Familjen_Grotesk, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

const familjen = Familjen_Grotesk({ variable: "--font-familjen", subsets: ["latin"], weight: ["500", "600", "700"] });
const plex = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500", "600"] });

const brand = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Boavoz";

export const metadata: Metadata = {
  title: { default: `${brand} · chatbots de IA com a sua marca`, template: `%s · ${brand}` },
  description: "Crie chatbots de IA treinados no site de cada cliente, coloque a sua marca e cobre o que quiser. Feito para agências e freelancers.",
  // em public/ e declarados aqui (não como app/favicon.ico): assim as páginas white-label
  // trocam o ícone inteiro pelo neutro (ver lib/white-label.ts)
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "48x48" }, { url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${familjen.variable} ${plex.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
