/* ============================================================================
   lib/supabase/columnas-opcionales.ts — Sobrevivir a una migración pendiente
   ----------------------------------------------------------------------------
   En este proyecto las migraciones se aplican A MANO en el SQL Editor de
   Supabase, en un paso separado del deploy. Entre uno y otro hay una ventana en
   la que el código nuevo pide columnas que todavía no existen — y PostgREST
   responde con error a TODA la consulta, no solo a esa columna: una página
   entera se queda en blanco por un campo opcional.

   Este helper prueba primero el `select` completo y, si la base se queja de una
   columna que no conoce, repite con el select mínimo de siempre. En cuanto la
   migración está aplicada, el primer intento acierta y el segundo nunca corre.

   Es andamiaje temporal: cuando una migración lleva tiempo aplicada en
   producción, el caller puede volver al select simple.
   ============================================================================ */

type Respuesta<T> = { data: T[] | null; error: { message: string } | null };

/* ¿El error es "esa columna/tabla no existe" y no un fallo real? */
function esEsquemaDesactualizado(mensaje: string): boolean {
  const m = mensaje.toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("could not find the table") ||
    m.includes("column") ||
    m.includes("schema cache")
  );
}

/* Corre `completo`; si falla por esquema, cae a `basico`. Cualquier otro error
   se propaga en la respuesta, como haría la consulta normal. */
export async function conColumnasOpcionales<T>(
  completo: () => PromiseLike<Respuesta<T>>,
  basico: () => PromiseLike<Respuesta<T>>,
  ambito: string,
): Promise<Respuesta<T>> {
  const r = await completo();
  if (!r.error || !esEsquemaDesactualizado(r.error.message)) return r;
  console.warn(
    `[${ambito}] Falta una migración por aplicar (${r.error.message}). ` +
      "Se cargan los datos sin las columnas nuevas.",
  );
  return basico();
}
