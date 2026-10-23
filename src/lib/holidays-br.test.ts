import { describe, expect, it } from "vitest";
import { FIXED_NATIONAL_HOLIDAYS, easterSunday, nationalHolidays, nextGoodFriday } from "./holidays-br";

describe("feriados nacionais", () => {
  it("calcula a Páscoa", () => {
    expect(easterSunday(2024)).toEqual({ day: 31, month: 3 });
    expect(easterSunday(2025)).toEqual({ day: 20, month: 4 });
    expect(easterSunday(2026)).toEqual({ day: 5, month: 4 });
    expect(easterSunday(2027)).toEqual({ day: 28, month: 3 });
  });

  it("a Sexta-feira Santa é a deste ano até ela passar; depois, a do ano que vem", () => {
    expect(nextGoodFriday(new Date(2026, 0, 10)).date).toBe("03/04/2026");
    expect(nextGoodFriday(new Date(2026, 3, 3)).date).toBe("03/04/2026");
    expect(nextGoodFriday(new Date(2026, 9, 23)).date).toBe("26/03/2027");
  });

  it("sugere os fixos (todo ano) e a Sexta-feira Santa (com o ano)", () => {
    const list = nationalHolidays(new Date(2026, 9, 23));
    expect(list).toHaveLength(FIXED_NATIONAL_HOLIDAYS.length + 1);
    expect(list.map((h) => h.date)).toContain("20/11");
    expect(list.filter((h) => h.date.length === 5)).toHaveLength(9);
  });
});
