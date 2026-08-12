/* ============================================================================
   Quién tiene sección de finanzas personales dentro de /finanzas.
   ----------------------------------------------------------------------------
   Es UNA persona: Armando. El rol no sirve para cortar aquí —`direccion` son
   tres (él, René y Aarón, ver EQUIPO_SEMILLA en lib/catalogos.ts)— y a los
   otros dos no se les ofrece la sección: no es suya y una pestaña vacía en su
   pantalla solo invita a preguntar de quién son esos números.

   OJO — ESTO NO ES EL CANDADO. El candado es la RLS de `finanzas_personales`
   (migración 20261009000000): las cuatro policies son `owner_id = auth.uid()`,
   así que ni René ni Aarón ni administración podrían leer un renglón de Armando
   aunque llegaran a la consulta. Lo de aquí es la otra mitad: no enseñarle a
   nadie más una sección que no le toca, y no dejar que las acciones se llamen
   por fuera de la pantalla.

   USOS (los tres, si un día hay que moverlo):
     app/(app)/finanzas/page.tsx            (la consulta condicional y la prop)
     app/(app)/finanzas/acciones/personales.ts  (el corte de las dos acciones)

   La identidad sale del correo y no del perfil porque `profiles` no guarda
   correo: viene del `user` de Supabase Auth. Mismo recurso que el
   CORREO_DIRECCION de app/login/page.tsx y que lib/inventario/historial-temporal.ts.
   Por eso el booleano SIEMPRE nace en el servidor y baja como prop: el correo
   no tiene por qué viajar al navegador.

   SI ALGÚN DÍA OTRO LLEVA AQUÍ SUS CUENTAS, esto se vuelve una lista de correos
   y nada más cambia: la RLS ya reparte por dueño, así que cada quien vería las
   suyas sin tocar la base.
   ============================================================================ */

const CORREO_FINANZAS_PERSONALES = "armando@fresafit.com.mx";

export function puedeVerFinanzasPersonales(correo: string | null | undefined): boolean {
  return correo?.trim().toLowerCase() === CORREO_FINANZAS_PERSONALES;
}
