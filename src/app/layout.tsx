import type { Metadata } from "next";
import { Familjen_Grotesk, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const familjen = Familjen_Grotesk({ variable: "--font-familjen", subsets: ["latin"], weight: ["500", "600", "700"] });
const plex = IBM_Plex_Sans({ variable: "--font-plex", subsets: ["latin"], weight: ["400", "500", "600"] });

const brand = process.env.NEXT_PUBLIC_BRAND_NAME ?? "Atendia";

export const metadata: Metadata = {
  title: { default: `${brand} · chatbots de IA com a sua marca`, template: `%s · ${brand}` },
  description: "Crie chatbots de IA treinados no site de cada cliente, coloque a sua marca e cobre o que quiser. Feito para agências e freelancers.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={`${familjen.variable} ${plex.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
