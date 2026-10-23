/** Os resumos das linhas da aparência do chat do site (aba Rosto e aparência, 23/10/2026). Puros. */

/** As perguntas sugeridas: quantas e as duas primeiras. */
export function suggestedSummary(list: string[]): string {
  if (!list.length) return "Nenhuma: o chat abre só com a saudação";
  const head = list.slice(0, 2).join(" · ");
  return `${list.length} ${list.length === 1 ? "pergunta" : "perguntas"}: ${head}${list.length > 2 ? " · …" : ""}`;
}

/** O balão: o canto e a distância da borda (0 a 200 px, 20 por padrão). */
export function widgetPositionSummary(position: string | undefined, offset: number | undefined): string {
  const px = Math.min(200, Math.max(0, Number(offset ?? 20) || 0));
  return `No canto ${position === "left" ? "esquerdo" : "direito"}, a ${px} px da borda`;
}
