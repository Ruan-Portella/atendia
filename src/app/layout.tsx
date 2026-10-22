import type { Metadata } from "next";
import { Funnel_Display, Martian_Mono, Onest } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

// fontes do redesenho (22/10): Onest no texto, Funnel Display nos títulos, Martian Mono nos rótulos e números
const onest = Onest({ variable: "--font-onest", subsets: ["latin", "latin-ext"] });
const funnel = Funnel_Display({ variable: "--font-funnel", subsets: ["latin", "latin-ext"] });
const martian = Martian_Mono({ variable: "--font-martian", subsets: ["latin"] });

const brand = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Boavoz";

export const metadata: Metadata = {
  title: { default: `${brand} · atendimento ao cliente com a sua marca`, template: `%s · ${brand}` },
  description: "Atendimento ao cliente para empresas, com a marca da sua agência: um assistente treinado no site e nos documentos de cada negócio, no site, no WhatsApp e no Instagram. Feito para agências e freelancers.",
  // em public/ e declarados aqui (não como app/favicon.ico): assim as páginas white-label
  // trocam o ícone inteiro pelo neutro (ver lib/white-label.ts)
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "48x48" }, { url: "/icon.svg", type: "image/svg+xml" }],
    apple: "/apple-icon.png",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${onest.variable} ${funnel.variable} ${martian.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
