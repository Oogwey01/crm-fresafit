/* ============================================================================
   lib/finanzas/sugerencias.ts — Lo que ya se ha capturado antes
   ----------------------------------------------------------------------------
   Los gastos de Fresafit se repiten mes con mes (Google Workspace, Astroselling,
   nóminas, IMSS…). En vez de volver a escribirlos, el diálogo los sugiere
   ordenados por cuántas veces se han usado.

   El agrupado NO distingue mayúsculas ni acentos: «Etiquetas térmicas» y
   «etiquetas termicas» son el mismo gasto de siempre y deben contar juntos. La
   forma que se muestra (y los datos que la acompañan) sale del uso más reciente.
   ========================================================================== */

import type { CategoriaGastoId } from "@/lib/types";

/* Lo mínimo que hace falta de cada gasto ya capturado. */
export type GastoPrevio = {
  fecha: string; // "AAAA-MM-DD"
  concepto: string;
  categoria: CategoriaGastoId;
  proveedor: string | null;
  metodo_pago: string | null;
};

export type Sugerencia = {
  texto: string; // como se escribió la última vez
  usos: number;
  ultima: string; // fecha del uso más reciente
  /* Lo que acompañó a ese último uso: sirve para rellenar el resto del alta.
     Solo se llena en las sugerencias de concepto. */
  categoria: CategoriaGastoId | null;
  proveedor: string | null;
  metodoPago: string | null;
};

export type SugerenciasGasto = {
  conceptos: Sugerencia[];
  proveedores: Sugerencia[];
  metodosPago: Sugerencia[];
};

export const SUGERENCIAS_VACIAS: SugerenciasGasto = {
  conceptos: [],
  proveedores: [],
  metodosPago: [],
};

/* Minúsculas y sin acentos, pero SIN tocar los espacios: así el texto conserva
   su longitud y se puede comparar posición a posición (lo usa el completado). */
function sinAcentos(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/* Clave de agrupado: lo anterior más los espacios de sobra ya comidos. También
   es con lo que se filtra al escribir. */
export function normalizar(texto: string): string {
  return sinAcentos(texto).trim().replace(/\s+/g, " ");
}

/* La forma en que se guarda y se muestra: sin espacios de sobra, para que la
   lista no enseñe «Etiquetas   térmicas» tal cual se tecleó un mal día. */
function limpiar(texto: string): string {
  return texto.trim().replace(/\s+/g, " ");
}

/* Más usado primero; a igualdad de usos, lo más reciente. */
function comparar(a: Sugerencia, b: Sugerencia): number {
  return b.usos - a.usos || b.ultima.localeCompare(a.ultima) || a.texto.localeCompare(b.texto);
}

function agrupar(
  gastos: GastoPrevio[],
  campo: (g: GastoPrevio) => string | null,
  conContexto: boolean,
): Sugerencia[] {
  const mapa = new Map<string, Sugerencia>();

  for (const g of gastos) {
    const texto = limpiar(campo(g) ?? "");
    const clave = normalizar(texto);
    if (!clave) continue;

    const previa = mapa.get(clave);
    if (!previa) {
      mapa.set(clave, {
        texto,
        usos: 1,
        ultima: g.fecha,
        categoria: conContexto ? g.categoria : null,
        proveedor: conContexto ? (g.proveedor?.trim() || null) : null,
        metodoPago: conContexto ? (g.metodo_pago?.trim() || null) : null,
      });
      continue;
    }

    previa.usos += 1;
    /* Solo el uso más reciente manda sobre cómo se escribe y qué lo acompaña. */
    if (g.fecha > previa.ultima) {
      previa.ultima = g.fecha;
      previa.texto = texto;
      if (conContexto) {
        previa.categoria = g.categoria;
        previa.proveedor = g.proveedor?.trim() || null;
        previa.metodoPago = g.metodo_pago?.trim() || null;
      }
    }
  }

  return [...mapa.values()].sort(comparar);
}

/* Las tres listas de un tirón, desde los gastos ya capturados. */
export function construirSugerencias(gastos: GastoPrevio[]): SugerenciasGasto {
  return {
    conceptos: agrupar(gastos, (g) => g.concepto, true),
    proveedores: agrupar(gastos, (g) => g.proveedor, false),
    metodosPago: agrupar(gastos, (g) => g.metodo_pago, false),
  };
}

/* Lo que se muestra bajo el campo. Sin nada escrito: los más usados. Con algo
   escrito: lo que contiene ese texto, pero poniendo delante lo que EMPIEZA por
   él (que es lo que se está tecleando). */
export function filtrarSugerencias(
  lista: Sugerencia[],
  consulta: string,
  limite = 8,
): Sugerencia[] {
  const q = normalizar(consulta);
  if (!q) return lista.slice(0, limite);

  return lista
    .filter((s) => normalizar(s.texto).includes(q))
    .sort((a, b) => {
      const pa = normalizar(a.texto).startsWith(q) ? 0 : 1;
      const pb = normalizar(b.texto).startsWith(q) ? 0 : 1;
      return pa - pb || comparar(a, b);
    })
    .slice(0, limite);
}

/* El completado que se escribe solo en el campo: devuelve el texto ya completo
   (lo tecleado tal cual + el resto de la sugerencia más usada que empieza por
   ello), o null si no hay ninguna o ya está escrita entera.

   La comparación es posición a posición sobre el texto sin acentos, nunca sobre
   el normalizado: si no, «Etiquetas  » con dos espacios cortaría mal el resto. */
export function completarInline(lista: Sugerencia[], consulta: string): string | null {
  if (!consulta.trim()) return null;
  const q = sinAcentos(consulta);
  for (const s of lista) {
    const t = sinAcentos(s.texto);
    if (t.length > q.length && t.startsWith(q)) return consulta + s.texto.slice(consulta.length);
  }
  return null;
}
