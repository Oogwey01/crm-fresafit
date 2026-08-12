/* ============================================================================
   lib/maquila/reglas.ts — Días hábiles, cortes y fecha prometida de la maquila
   ----------------------------------------------------------------------------
   La promesa al cliente sale de aquí: prensado = pago + 7 días hábiles (Eduardo
   lo saca manual cualquier día); sublimado/bordado = pago + 10, asignado al
   siguiente corte de LUNES o JUEVES. "Hábil" excluye domingos, festivos de ley
   y cierres del taller (tabla maquila_festivos), y el sábado es configurable.
   Si el pago cae después de la hora límite del día, cuenta desde el siguiente
   día hábil — esa hora vive en maquila_config, no aquí.

   Funciones PURAS al estilo lib/tareas/reglas.ts, con una restricción más:
   este módulo NO importa nada. Todo lo que depende de huso horario entra ya
   resuelto (el día y la hora de México los da lib/fecha.ts — diaMX/horaMX — y
   el calendario llega por parámetro). A cambio, la aritmética de fechas de
   aquí se hace en UTC fijo a mediodía, que es determinista en cualquier
   máquina, y scripts/probar-maquila-reglas.mjs puede ejecutar este archivo con
   `node` a pelo — los criterios de aceptación de fechas (viernes→corte del
   lunes, festivo no cuenta, +7/+10) se comprueban sin levantar nada.
   ============================================================================ */

/* Lo que el cálculo necesita saber del mundo: la configuración y los días que
   no cuentan. `noHabiles` trae festivos Y cierres del taller (AAAA-MM-DD). */
export type CalendarioMaquila = {
  /* "HH:mm" (24 h, hora de México). A partir de esta hora el pago es del día
     hábil siguiente. */
  horaLimite: string;
  sabadoHabil: boolean;
  noHabiles: Set<string>;
};

export const PLAZO_DIRECTA = 7; // prensado: días hábiles desde el pago
export const PLAZO_CORTE = 10;  // sublimado/bordado: días hábiles desde el pago

/* La ruta de producción la decide el acabado: prensado no espera corte. */
export type RutaMaquila = "directa" | "corte";
export function rutaDeAcabado(acabado: string): RutaMaquila {
  return acabado === "prensado" ? "directa" : "corte";
}

/* ---- Aritmética de días (determinista, sin huso) -------------------------
   Anclar a mediodía UTC hace que sumar días y preguntar el día de la semana
   den lo mismo en el server (UTC), en la laptop y en el navegador: aquí solo
   viajan fechas de calendario, nunca instantes. */

function aDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

function aISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/* 0=domingo … 6=sábado, como Date#getDay. */
function diaSemana(iso: string): number {
  return aDate(iso).getUTCDay();
}

function masDias(iso: string, n: number): string {
  const d = aDate(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return aISO(d);
}

/* Días de calendario entre dos ISO (b − a; negativo si b es antes). */
export function diasEntre(a: string, b: string): number {
  return Math.round((aDate(b).getTime() - aDate(a).getTime()) / 86_400_000);
}

/* ---- Días hábiles --------------------------------------------------------- */

export function esDiaHabil(iso: string, cal: CalendarioMaquila): boolean {
  const dia = diaSemana(iso);
  if (dia === 0) return false;                      // domingo, siempre fuera
  if (dia === 6 && !cal.sabadoHabil) return false;  // sábado, según config
  return !cal.noHabiles.has(iso);
}

/* El mismo día si es hábil; si no, el primero que sí. */
export function primerDiaHabil(iso: string, cal: CalendarioMaquila): string {
  let d = iso;
  while (!esDiaHabil(d, cal)) d = masDias(d, 1);
  return d;
}

/* El primer día hábil ESTRICTAMENTE después de `iso`. */
export function siguienteDiaHabil(iso: string, cal: CalendarioMaquila): string {
  return primerDiaHabil(masDias(iso, 1), cal);
}

/* `n` días hábiles contados DESPUÉS de `desde` (el propio `desde` no cuenta,
   sea hábil o no): "pago + 7 días hábiles" es el séptimo día hábil que sigue
   al día del pago. */
export function sumarDiasHabiles(desde: string, n: number, cal: CalendarioMaquila): string {
  let d = desde;
  for (let i = 0; i < n; i++) d = siguienteDiaHabil(d, cal);
  return d;
}

/* ---- Del instante del pago al día que cuenta ------------------------------ */

/* El día desde el que corren los plazos. `dia`/`hora` vienen de diaMX()/horaMX()
   sobre `pagado_en`. Después de la hora límite, el pago es "de mañana"; y si el
   día resultante no es hábil (domingo, festivo), corre al primero que sí. */
export function diaEfectivoDePago(dia: string, hora: string, cal: CalendarioMaquila): string {
  const base = hora >= cal.horaLimite ? masDias(dia, 1) : dia;
  return primerDiaHabil(base, cal);
}

/* El corte al que se asigna un pedido por lote: el primer LUNES o JUEVES que
   sea `diaEfectivo` o después. Si ese día no es hábil (festivo en lunes, cierre
   del taller), el lote corre al siguiente día de corte hábil — no al día
   siguiente, porque la producción por lote solo se manda en día de corte. */
export function corteSiguiente(diaEfectivo: string, cal: CalendarioMaquila): string {
  let d = diaEfectivo;
  // Cota holgada: aun con vacaciones largas del taller, hay un corte adelante.
  for (let i = 0; i < 370; i++) {
    const dia = diaSemana(d);
    if ((dia === 1 || dia === 4) && esDiaHabil(d, cal)) return d;
    d = masDias(d, 1);
  }
  return d;
}

/* ---- La clasificación completa de un pago --------------------------------- */

export type ClasificacionMaquila = {
  diaEfectivo: string;
  ruta: RutaMaquila;
  /* Solo para la ruta por corte; null en producción directa. */
  corteFecha: string | null;
  fechaPrometida: string;
};

/* Todo lo que la ingesta escribe al aprobarse un pago, en una sola pasada:
   día efectivo → ruta → corte (si aplica) → fecha prometida. La promesa cuenta
   desde el día efectivo del PAGO, no desde el corte — es la promesa literal de
   la spec (+7/+10 hábiles desde el pago). */
export function clasificarPago(
  dia: string,
  hora: string,
  acabado: string,
  cal: CalendarioMaquila,
): ClasificacionMaquila {
  const diaEfectivo = diaEfectivoDePago(dia, hora, cal);
  const ruta = rutaDeAcabado(acabado);
  return {
    diaEfectivo,
    ruta,
    corteFecha: ruta === "corte" ? corteSiguiente(diaEfectivo, cal) : null,
    fechaPrometida: sumarDiasHabiles(
      diaEfectivo,
      ruta === "directa" ? PLAZO_DIRECTA : PLAZO_CORTE,
      cal,
    ),
  };
}

/* ---- El semáforo del tablero ---------------------------------------------
   `hoy` llega por parámetro (hoyISO() tomado UNA vez en el Server Component),
   patrón de instanteDeCorte() en lib/canales/despacho.ts: dos pedidos con la
   misma fecha prometida deben clasificar igual dentro del mismo request. */

export type SemaforoMaquila = "rojo" | "amarillo" | "verde";

export function semaforoMaquila(fechaPrometida: string | null, hoy: string): SemaforoMaquila | null {
  if (!fechaPrometida) return null;
  const dias = diasEntre(hoy, fechaPrometida);
  if (dias <= 0) return "rojo";      // vencido o vence hoy
  if (dias <= 2) return "amarillo";  // vence en 1–2 días
  return "verde";
}

export const SEMAFORO_MAQUILA: Record<SemaforoMaquila, { nombre: string; color: string }> = {
  rojo: { nombre: "Vencido o vence hoy", color: "#d63031" },
  amarillo: { nombre: "Vence en 1–2 días", color: "#f59e0b" },
  verde: { nombre: "Con holgura", color: "#22c55e" },
};

/* ---- El paquete al que pertenece un renglón -------------------------------
   La guía es del PAQUETE, no de la pieza: una orden con tres cinturones lleva
   una sola etiqueta. Esta clave espeja el coalesce del trigger
   solicitar_guia_maquila y de la RLS de maquila_guias (20260926000100); si
   dejaran de coincidir, el tablero pintaría solicitudes huérfanas. */
export function grupoDePedido(p: { referencia_orden: string | null; id: string }): string {
  return p.referencia_orden?.trim() || p.id;
}

/* ---- Indicadores de un pedido (los emojis del tablero) -------------------- */

export type IndicadorMaquila = { icono: string; titulo: string };

export function indicadoresDePedido(p: {
  acabado: string;
  combo: string;
  requiere_palanca: boolean;
  /* Opcionales: los pedidos sin arte propio (una colección de catálogo) no
     tienen nada que esperar y no pintan nada. */
  personalizado_id?: string | null;
  diseno_id?: string | null;
  diseno_listo_en?: string | null;
}): IndicadorMaquila[] {
  const out: IndicadorMaquila[] = [];
  if (p.acabado === "prensado") {
    out.push({ icono: "⚡", titulo: "Prensado: fuera de corte, se saca manual" });
  } else {
    out.push({ icono: "🧵", titulo: "Requiere tercero (bordado/impresión)" });
  }
  if (p.combo !== "ninguno") out.push({ icono: "🎁", titulo: "Lleva combo" });
  if (p.requiere_palanca) out.push({ icono: "🔧", titulo: "Requiere palanca" });
  /* El arte: lo que decide si esta pieza se puede empezar. Se pinta solo cuando
     el pedido tiene un diseño propio colgado —el de un personalizado o uno de
     la biblioteca—, porque es ahí donde «todavía no llega» significa algo. */
  if (p.personalizado_id || p.diseno_id) {
    out.push(
      p.diseno_listo_en
        ? { icono: "🎨", titulo: "Diseño entregado: se puede producir" }
        : { icono: "⏳", titulo: "Falta que diseño entregue el arte" },
    );
  }
  return out;
}
