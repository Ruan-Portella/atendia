import { hostAgency } from "@/lib/domain-server";

/**
 * O manifest do painel e da área do cliente (Memória e avisos, parte 2): no iPhone, os avisos só
 * chegam com o site adicionado à tela de início, e é o manifest que deixa. A área do cliente
 * (?area=cliente) é white-label: no domínio da agência, o nome e o logo dela; no do app, um nome
 * neutro, sem o ícone da plataforma. O painel, no domínio do app, é o BoaVoz.
 */
export async function GET(req: Request) {
  const client = new URL(req.url).searchParams.get("area") === "cliente";
  const agency = await hostAgency();
  const name = agency?.name?.trim() || (client ? "Atendimento" : "BoaVoz");
  const icons = agency?.logo_url ? [{ src: agency.logo_url, sizes: "512x512", type: "image/png" }] : client || agency ? [] : [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }, { src: "/apple-icon.png", sizes: "180x180", type: "image/png" }];
  const body = {
    name,
    short_name: name.slice(0, 12),
    start_url: client || agency ? "/cliente" : "/painel",
    scope: "/",
    display: "standalone",
    background_color: "#f4f3ee",
    theme_color: /^#[0-9a-f]{6}$/i.test(agency?.brand_color ?? "") ? agency!.brand_color : "#1f4e3d",
    icons,
  };
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "public, max-age=3600" } });
}
