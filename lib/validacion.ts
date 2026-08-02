/* Micro-helpers de saneo de formularios, compartidos por diálogos y actions. */

/* Texto recortado, o null si quedó vacío (el patrón `.trim() || null`). */
export function textoONulo(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t || null;
}

/* Texto de un input numérico a number|null (vacío o inválido = null).
   Quien necesite "vacío = 0" (p. ej. venta-dialog) usa `aNumero(x) ?? 0`. */
export function aNumero(texto: string): number | null {
  if (texto.trim() === "") return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}
