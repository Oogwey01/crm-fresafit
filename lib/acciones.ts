/* Contrato único de respuesta de los server actions. Los clientes lo consumen
   con `if ("error" in r)`, así que cualquier forma nueva debe conservar esa
   discriminación. `advertencia` viaja en el caso ok: la operación principal
   funcionó pero algo secundario falló (p. ej. "se guardó en el CRM, pero el
   canal no respondió") — el cliente decide pintarla ámbar en vez de rojo. */
export type Resultado<T = void> =
  | (T extends void ? { ok: true; advertencia?: string } : { ok: true; advertencia?: string; datos: T })
  | { error: string };

/* Mensaje legible de una excepción, con fallback para lo no-Error. */
export function mensajeDeError(e: unknown, porDefecto: string): string {
  return e instanceof Error ? e.message : porDefecto;
}
