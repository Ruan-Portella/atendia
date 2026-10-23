/** A cor da marca da agência, se for um hexadecimal de 6 dígitos; senão, o verde do BoaVoz. Pura. */
export const brandColor = (c: string) => (/^#[0-9a-f]{6}$/i.test(c) ? c : "#1f4e3d");
