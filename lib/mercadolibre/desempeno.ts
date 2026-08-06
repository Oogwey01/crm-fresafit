/* ============================================================================
   lib/mercadolibre/desempeno.ts — El termómetro de Mercado Libre, traducido
   ----------------------------------------------------------------------------
   Mercado Libre nos califica con tres porcentajes de los últimos 60 días
   (reclamos, demora en el despacho y cancelaciones) y de ahí sale el color del
   termómetro, que es lo que decide cuánta exposición nos da y si podemos
   ofrecer "llega mañana". El panel de ML enseña el color; lo que no enseña es
   CUÁNTO falta para el siguiente escalón, que es la única forma de saber si el
   problema se está arreglando o agravando.

   Los umbrales son los publicados para MLM (México) y no valen para otros
   países: la misma tasa de demoras que en México te deja en amarillo, en Brasil
   te deja en verde. Están escritos aquí y no derivados de la API porque ML no
   los expone: solo manda el color ya calculado.

   Nada de esto pide datos por su cuenta; recibe lo que ya trae saludML().
   ============================================================================ */

import { situacionDespacho, type SituacionDespacho } from "@/lib/canales/despacho";
import type { SaludML } from "@/lib/canales/salud";
import type { VentaDespacho } from "@/lib/types";

export type NivelDesempeno = "lider" | "verde" | "amarillo" | "naranja" | "rojo";

/* Tope de cada nivel, en tanto por uno. Un valor IGUAL al tope todavía cae
   dentro de ese nivel; pasarlo baja al siguiente. Lo que exceda "naranja" es
   rojo. Fuente: tabla de reputación de MLM en developers.mercadolibre.com.mx. */
export const UMBRALES_MLM = {
  reclamos: { lider: 0.01, verde: 0.015, amarillo: 0.03, naranja: 0.06 },
  demoras: { lider: 0.08, verde: 0.1, amarillo: 0.15, naranja: 0.22 },
  cancelaciones: { lider: 0.005, verde: 0.01, amarillo: 0.025, naranja: 0.03 },
} as const;

export type Umbrales = (typeof UMBRALES_MLM)[keyof typeof UMBRALES_MLM];

export const COLOR_NIVEL: Record<NivelDesempeno, string> = {
  lider: "#00b894",
  verde: "#55efc4",
  amarillo: "#fdcb6e",
  naranja: "#e17055",
  rojo: "#d63031",
};

export const NOMBRE_NIVEL: Record<NivelDesempeno, string> = {
  lider: "Nivel líder",
  verde: "Verde",
  amarillo: "Amarillo",
  naranja: "Naranja",
  rojo: "Rojo",
};

export function nivelPorTasa(tasa: number, u: Umbrales): NivelDesempeno {
  if (tasa <= u.lider) return "lider";
  if (tasa <= u.verde) return "verde";
  if (tasa <= u.amarillo) return "amarillo";
  if (tasa <= u.naranja) return "naranja";
  return "rojo";
}

/* Una métrica ya evaluada, con sus dos caras.

   Mercado Libre excluye casos del cálculo cuando la cuenta está protegida, y
   entonces publica una tasa mejor que la que dejó la operación. Aquí manda la
   REAL: el indulto tiene fecha de vencimiento y los paquetes que salieron tarde
   ya salieron tarde. La publicada se conserva para poder enseñar la diferencia,
   que es justo lo que explica por qué el panel de ML se ve mejor de lo que se
   siente la operación. */
export type MetricaEvaluada = {
  clave: keyof typeof UMBRALES_MLM;
  etiqueta: string;
  tasa: number; // la real (tanto por uno), sin excluir casos
  tasaPublicada: number; // la que ML enseña
  casos: number; // casos reales, incluidos los que ML excluye
  nivel: NivelDesempeno; // por la tasa real
  nivelPublicado: NivelDesempeno;
  /* Tope del nivel actual: pasarlo baja de color. */
  topeDelNivel: number | null;
  margen: number | null;
  /* ML nos está descontando casos en esta métrica. */
  indultada: boolean;
};

function evaluar(
  clave: keyof typeof UMBRALES_MLM,
  etiqueta: string,
  m: { rate: number; realRate: number; real: number },
): MetricaEvaluada {
  const u = UMBRALES_MLM[clave];
  const nivel = nivelPorTasa(m.realRate, u);
  const topeDelNivel = nivel === "rojo" ? null : u[nivel];
  return {
    clave,
    etiqueta,
    tasa: m.realRate,
    tasaPublicada: m.rate,
    casos: m.real,
    nivel,
    nivelPublicado: nivelPorTasa(m.rate, u),
    topeDelNivel,
    margen: topeDelNivel === null ? null : Math.max(0, topeDelNivel - m.realRate),
    indultada: m.realRate > m.rate,
  };
}

/* El semáforo de ML traducido a nuestro nivel. `level_id` es el color que ML
   publica; `real_level` es el que nos tocaría sin protección y usa los mismos
   colores sin el prefijo numérico ("red" en vez de "1_red"), así que el mapa
   acepta las dos formas. */
const NIVEL_POR_LEVEL_ID: Record<string, NivelDesempeno> = {
  "5_green": "verde",
  "4_light_green": "verde",
  "3_yellow": "amarillo",
  "2_orange": "naranja",
  "1_red": "rojo",
  green: "verde",
  light_green: "verde",
  yellow: "amarillo",
  orange: "naranja",
  red: "rojo",
};

const ORDEN: NivelDesempeno[] = ["lider", "verde", "amarillo", "naranja", "rojo"];

function peor(a: NivelDesempeno, b: NivelDesempeno): NivelDesempeno {
  return ORDEN.indexOf(a) >= ORDEN.indexOf(b) ? a : b;
}

export type Desempeno = {
  /* El nivel que manda para operar: el REAL, sin los casos que ML nos perdona.
     Es el que se va a ver en el panel en cuanto se acabe la protección. */
  nivel: NivelDesempeno;
  /* El color que Mercado Libre enseña hoy. Cuando es mejor que `nivel`, la
     diferencia es el indulto. */
  nivelPublicado: NivelDesempeno | null;
  /* Cómo se resume el momento, en las palabras con las que se habla del tema
     adentro: al tope, regular, o con problemas. */
  titulo: string;
  mensaje: string;
  /* Mercado Libre está excluyendo casos del cálculo. */
  protegida: boolean;
  protegidaHasta: string | null;
  /* Si la demora de despacho está dentro del rango que permite envío rápido.
     Es una CONDICIÓN, no una confirmación: la API no dice si "llega mañana"
     está activo, y depende además del tiempo de manejo configurado. */
  demoraPermiteEnvioRapido: boolean;
  metricas: MetricaEvaluada[];
  demoras: MetricaEvaluada;
};

/* Traduce la salud de la cuenta a "qué tan visibles estamos".

   El nivel general se calcula sobre las tasas REALES y se cruza con el
   `real_level` que manda ML: entre los dos se toma el peor, porque cada uno
   avisa antes que el otro según el caso. El color publicado queda aparte, para
   poder enseñar la brecha en vez de esconderla. */
export function desempenoML(salud: SaludML): Desempeno {
  const metricas = [
    evaluar("demoras", "Demora en el despacho", salud.demoras),
    evaluar("reclamos", "Reclamos", salud.reclamos),
    evaluar("cancelaciones", "Cancelaciones", salud.cancelaciones),
  ];
  const demoras = metricas[0];

  const porMetricas = metricas.map((m) => m.nivel).reduce(peor);
  const porML = salud.nivelReal ? NIVEL_POR_LEVEL_ID[salud.nivelReal] : undefined;
  const nivel = porML ? peor(porML, porMetricas) : porMetricas;

  const nivelPublicado = salud.nivel ? (NIVEL_POR_LEVEL_ID[salud.nivel] ?? null) : null;
  const protegida =
    metricas.some((m) => m.indultada) ||
    !!salud.protegidaHasta ||
    (nivelPublicado !== null && nivel !== nivelPublicado);

  /* Mercado Libre exige verde en demoras para el envío rápido. Que se cumpla no
     garantiza que esté activo —eso también depende del tiempo de manejo que
     tengamos puesto—, pero que NO se cumpla sí lo descarta. */
  const demoraPermiteEnvioRapido = demoras.nivel === "lider" || demoras.nivel === "verde";

  const bien = nivel === "lider" || nivel === "verde";
  const titulo = bien ? "Exposición al tope" : nivel === "amarillo" ? "Vamos regular" : "Exposición en riesgo";

  const base = bien
    ? "Mercado Libre nos está mostrando. Mantener el despacho al día es lo que conserva esto."
    : nivel === "amarillo"
      ? "Mercado Libre nos muestra menos de lo que podría. Se recupera despachando a tiempo los próximos 60 días."
      : "Mercado Libre nos está escondiendo. Cada paquete que sale tarde alarga la recuperación: la métrica mira 60 días hacia atrás.";

  /* Lo que explica que el panel de ML se vea mejor de lo que se siente la
     operación: nos están perdonando casos, y eso se acaba. */
  const aviso = protegida
    ? " Ojo: Mercado Libre está excluyendo casos del cálculo, así que el color de su panel es mejor que el real. Lo de aquí ya cuenta los casos completos."
    : "";

  return {
    nivel,
    nivelPublicado,
    titulo,
    mensaje: base + aviso,
    protegida,
    protegidaHasta: salud.protegidaHasta,
    demoraPermiteEnvioRapido,
    metricas,
    demoras,
  };
}

/* ------------------------- Los paquetes, uno por uno ---------------------- */

/* El semáforo del plazo (vencido / por vencer / salió tarde) ya no es de Mercado
   Libre: TikTok Shop también reporta el suyo y el criterio es común, así que vive
   en lib/canales/despacho.ts. Se re-exporta desde aquí porque el tablero del
   canal lo consume por esta puerta desde antes de que hubiera un segundo canal
   con plazo, y lo lee junto a la métrica de 60 días, que sí es de ML. */
export {
  HORAS_URGENTE,
  SITUACION,
  instanteDeCorte,
  situacionDespacho,
  type SituacionDespacho,
} from "@/lib/canales/despacho";

/* Un pedido con su plazo, ya juntando los renglones que lo componen: `sales`
   guarda una fila por producto, y una orden de tres artículos se empaca y se
   despacha UNA vez. Sin agrupar, un solo pedido atrasado se vería como tres. */
export type DespachoOrden = {
  orden: string; // nº de orden en Mercado Libre
  fecha: string; // AAAA-MM-DD
  piezas: number;
  renglones: number;
  descripcion: string | null; // el primer producto, para reconocerlo
  urlOrden: string | null;
  limite: string;
  despachadoEn: string | null;
  situacion: SituacionDespacho;
};

/* El nº de orden vive al inicio de referencia_externa ("<orden>:<item>:<var>"). */
function ordenDe(v: VentaDespacho): string {
  return v.referencia_externa?.split(":")[0] || v.id;
}

export function agruparDespachos(
  ventas: VentaDespacho[],
  ahora: number = Date.now(),
): DespachoOrden[] {
  const porOrden = new Map<string, DespachoOrden>();

  for (const v of ventas) {
    const situacion = situacionDespacho(v.envio_limite_despacho, v.envio_despachado_en, ahora);
    if (!situacion || !v.envio_limite_despacho) continue;

    const clave = ordenDe(v);
    const ya = porOrden.get(clave);
    if (ya) {
      ya.piezas += v.cantidad || 0;
      ya.renglones += 1;
      continue;
    }
    porOrden.set(clave, {
      orden: clave,
      fecha: v.fecha,
      piezas: v.cantidad || 0,
      renglones: 1,
      descripcion: v.descripcion,
      urlOrden: v.url_orden,
      limite: v.envio_limite_despacho,
      despachadoEn: v.envio_despachado_en,
      situacion,
    });
  }

  /* Por plazo: lo que primero se vence, primero se empaca. */
  return [...porOrden.values()].sort((a, b) => a.limite.localeCompare(b.limite));
}

/* Lo que hay que mover hoy.

   Deliberadamente NO calcula un porcentaje de cumplimiento histórico. La
   importación se salta el envío de las órdenes que ya llegaron (para ahorrar
   llamadas), así que los únicos despachos con plazo guardado son los que siguen
   en curso —justo los atrasados—. Promediar sobre esa muestra daba "13%
   salieron a tiempo" cuando la métrica oficial de la cuenta dice 96%: no era un
   dato duro, era el sesgo de a quién le preguntamos.

   El porcentaje honesto lo publica Mercado Libre y ya está arriba, en el
   termómetro. Aquí vive solo lo pendiente, que sí está completo porque de esas
   órdenes siempre se consulta el envío. */
export type ResumenDespacho = {
  pendientes: DespachoOrden[]; // sin despachar, del más urgente al menos
  vencidos: number;
  porVencer: number;
};

export function resumirDespachos(despachos: DespachoOrden[]): ResumenDespacho {
  const pendientes = despachos.filter((d) => !d.despachadoEn);
  return {
    pendientes,
    vencidos: pendientes.filter((d) => d.situacion === "vencido").length,
    porVencer: pendientes.filter((d) => d.situacion === "por_vencer").length,
  };
}
