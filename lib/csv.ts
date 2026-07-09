/* ============================================================================
   lib/csv.ts  —  Generación de CSV (Fresafit CRM)
   ----------------------------------------------------------------------------
   Convierte filas a texto CSV listo para abrir en Excel. Incluye el BOM UTF-8
   al inicio: sin él, Excel muestra mal los acentos y las eñes.
   ============================================================================ */

type Celda = string | number | boolean | null | undefined;

/* Escapa una celda: si trae coma, comillas o salto de línea, va entre comillas
   (las comillas internas se duplican, según RFC 4180). */
function escapar(celda: Celda): string {
  if (celda === null || celda === undefined) return "";
  const texto = String(celda);
  return /[",\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

/* Arma el CSV completo (encabezados + filas) con BOM UTF-8 (U+FEFF). */
export function aCSV(encabezados: string[], filas: Celda[][]): string {
  const BOM = String.fromCharCode(0xfeff);
  const lineas = [encabezados, ...filas].map((fila) => fila.map(escapar).join(","));
  return BOM + lineas.join("\r\n");
}
