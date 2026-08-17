/* ============================================================================
   lib/personalizados/plazo.ts — Para cuándo se le promete el cinto al cliente
   ----------------------------------------------------------------------------
   Un personalizado tarda MUCHO más que un pedido de estante, y esa espera se
   negocia una sola vez: al comprar. La promesa son **33 días naturales** desde
   que entra el cinto, y se cuentan de corrido —domingos y festivos incluidos—
   porque es lo que el cliente cuenta en su calendario; explicarle días hábiles
   es una discusión que nadie quiere tener.

   NO CONFUNDIR CON `maquila_pedidos.fecha_prometida`. Esa es la promesa del
   TALLER (7 o 10 días HÁBILES desde el pago, lib/maquila/reglas.ts): mide
   cuánto tarda Eduardo en producir una pieza que ya tiene arte. Son plazos de
   dos cosas distintas y por eso hay dos campos:

     · la del taller arranca con el pago (o con el arte, lo que llegue después)
       y le dice a Eduardo qué sacar hoy;
     · esta arranca con el ingreso y cubre el ciclo COMPLETO que el cliente
       vive — diseño, ida y vuelta de aprobación, producción y envío—, que es
       de lo que se queja si se pasa.

   Se mezclaron cuando la ficha del personalizado empezó a nacer sola desde
   maquila (lib/personalizados/desde-maquila.ts): copiaba la fecha del taller
   tal cual, así que las fichas nuevas salían con ~12 días de límite mientras
   las 150 históricas de la hoja —capturadas a mano por el equipo, que sí sabía
   el plazo real— traían 30-33. El módulo daba por "fuera de fecha" pedidos que
   iban perfectamente en tiempo.
   ============================================================================ */

import { sumarDias } from "@/lib/fecha";

/* Días NATURALES desde el ingreso del cinto. Si algún día se renegocia, se
   cambia aquí y punto: nadie más debe escribir el número. */
export const PLAZO_PERSONALIZADO_DIAS = 33;

/* La fecha que se le promete al cliente. `ingreso` es un AAAA-MM-DD (la fecha
   de compra de la ficha); devuelve null si no hay de dónde contar, porque una
   fecha límite inventada es peor que ninguna — se pintaría en rojo sola. */
export function fechaLimitePersonalizado(ingreso: string | null | undefined): string | null {
  if (!ingreso) return null;
  return sumarDias(ingreso.slice(0, 10), PLAZO_PERSONALIZADO_DIAS) || null;
}
