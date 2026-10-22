import { cookies } from "next/headers";
import { TEMA_COOKIE, temaOf } from "@/lib/theme";
import { ThemeMark } from "@/components/theme";

/** Põe a página no tema escolhido pela pessoa (escuro por padrão). Vai nos layouts logados. */
export async function AppTheme() {
  const tema = temaOf((await cookies()).get(TEMA_COOKIE)?.value);
  return <ThemeMark tema={tema} />;
}
