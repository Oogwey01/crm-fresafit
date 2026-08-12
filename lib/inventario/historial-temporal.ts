/* ============================================================================
   TEMPORAL — el historial de stock se enseña solo a Aarón mientras lo afina.
   ----------------------------------------------------------------------------
   La pestaña «Historial de stock» de /inventario está a medio pulir y todavía
   se presenta al equipo, así que se acota a una persona en vez de esconderla
   del todo o dejarla a la vista a medias.

   PARA REVERTIR: borrar este archivo y quitar sus TRES usos —
     app/(app)/inventario/page.tsx      (la consulta condicional y la prop)
     components/inventario/panel.tsx    (la pestaña, sus filtros y la carga)
     app/(app)/inventario/actions.ts    (el corte de `movimientosStock`)

   La identidad sale del correo y no del perfil porque `profiles` no guarda
   correo: viene del `user` de Supabase Auth. Mismo recurso que el
   CORREO_DIRECCION de app/login/page.tsx. Por eso el booleano SIEMPRE nace en
   el servidor y baja como prop: el correo no tiene por qué viajar al navegador.
   ============================================================================ */

const CORREO_HISTORIAL_STOCK = "aaron@fresafit.com.mx";

export function puedeVerHistorialStock(correo: string | null | undefined): boolean {
  return correo?.trim().toLowerCase() === CORREO_HISTORIAL_STOCK;
}
