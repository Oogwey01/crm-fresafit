import { AlertTriangle, Clock, ExternalLink, PackageCheck, Scissors, Zap } from "lucide-react";
import { Bloque, Dato } from "@/components/compartido/bloque-dato";
import { Pastilla } from "@/components/compartido/pastilla";
import { StatCard } from "@/components/compartido/stat-card";
import { formatearFechaHora } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type { CostosCanal } from "@/lib/canales/tipos";
import {
  COLOR_NIVEL,
  NOMBRE_NIVEL,
  SITUACION,
  desempenoML,
  type DespachoOrden,
  type MetricaEvaluada,
  type ResumenDespacho,
} from "@/lib/mercadolibre/desempeno";
import type { SaludML } from "@/lib/canales/salud";
import { cn } from "@/lib/utils";

/* ============================================================================
   Mercado Libre por dentro: el termómetro y los plazos.
   ----------------------------------------------------------------------------
   Mercado Libre decide cuánta gente nos ve según tres porcentajes de los
   últimos 60 días, y el más castigado es el de despachos tardíos: cuando sube,
   se pierde el "llega mañana" y con él buena parte del tráfico.

   Su panel enseña el color ya calculado. Lo que falta —y es lo que se pinta
   aquí— es cuánto margen queda antes de bajar de nivel, y qué paquetes hay que
   sacar HOY para no empeorarlo. Lo primero se responde con la métrica; lo
   segundo, con el plazo de cada pedido.
   ============================================================================ */

/* Lo que cobra la plataforma por vender, ya sumado. */
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

/* "en 3 h", "hace 2 d": lo que queda (o lo que ya se pasó) para el plazo. */
function faltante(limite: string, ahora: number): string {
  const ms = Date.parse(limite) - ahora;
  const abs = Math.abs(ms);
  const dias = Math.floor(abs / 86_400_000);
  const horas = Math.floor(abs / 3_600_000);
  const minutos = Math.floor(abs / 60_000);
  const cuanto = dias >= 1 ? `${dias} d` : horas >= 1 ? `${horas} h` : `${minutos} min`;
  return ms >= 0 ? `en ${cuanto}` : `hace ${cuanto}`;
}

function Metrica({ m }: { m: MetricaEvaluada }) {
  const color = COLOR_NIVEL[m.nivel];
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12.5px] font-medium text-muted-foreground">{m.etiqueta}</span>
        <Pastilla nombre={NOMBRE_NIVEL[m.nivel]} color={color} className="shrink-0 px-2 py-0.5" />
      </div>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="text-[26px] font-bold leading-none tabular-nums" style={{ color }}>
          {pct(m.tasa)}
        </span>
        {m.indultada && (
          <span className="text-[12px] text-muted-foreground">
            ML publica {pct(m.tasaPublicada)}
          </span>
        )}
      </div>
      <div className="mt-2 text-[12px] text-muted-foreground">
        {m.casos > 0 ? `${m.casos} ${m.casos === 1 ? "caso real" : "casos reales"} · ` : ""}
        {m.margen === null
          ? "ya es el nivel más bajo"
          : m.margen === 0
            ? "justo en el límite del nivel"
            : `${pct(m.margen)} de margen antes de bajar de nivel`}
      </div>
    </div>
  );
}

function FilaDespacho({ d, ahora }: { d: DespachoOrden; ahora: number }) {
  const s = SITUACION[d.situacion];
  return (
    <li className="flex items-center gap-3 border-b py-2.5 last:border-b-0">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: s.color }}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium">
          {d.descripcion ?? `Orden ${d.orden}`}
          {d.renglones > 1 && (
            <span className="font-normal text-muted-foreground"> +{d.renglones - 1} más</span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">
          Orden {d.orden} · {d.piezas} {d.piezas === 1 ? "pieza" : "piezas"}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-[12.5px] font-semibold tabular-nums" style={{ color: s.color }}>
          {d.despachadoEn ? s.nombre : faltante(d.limite, ahora)}
        </div>
        <div className="text-[11.5px] text-muted-foreground">
          {d.despachadoEn
            ? `salió ${formatearFechaHora(d.despachadoEn)}`
            : `vence ${formatearFechaHora(d.limite)}`}
        </div>
      </div>
      {d.urlOrden && (
        <a
          href={d.urlOrden}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          title="Abrir en Mercado Libre"
        >
          <ExternalLink className="size-4" strokeWidth={1.9} />
        </a>
      )}
    </li>
  );
}

export function PanelMercadoLibre({
  salud,
  conectada,
  ultimaSync,
  resumen,
  costos,
  dias,
  ahora,
}: {
  salud: SaludML | null;
  conectada: boolean;
  ultimaSync: string | null;
  resumen: ResumenDespacho;
  /* Null = todavía no hay órdenes con comisión archivada. */
  costos: CostosCanal | null;
  dias: number;
  /* El instante contra el que se midieron los plazos. Llega desde la página en
     vez de leerse aquí para que el "vence en 3 h" y la situación de esa misma
     fila estén contados desde el mismo momento. */
  ahora: number;
}) {
  const d = salud ? desempenoML(salud) : null;
  const urgentes = resumen.vencidos + resumen.porVencer;

  if (!conectada) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-[13.5px] text-muted-foreground">
        Mercado Libre no está conectado. Se conecta desde Inventario.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* --- El semáforo: qué tanto nos está mostrando la plataforma --- */}
      {d && (
        <section
          className="rounded-2xl border-l-4 bg-card p-5 shadow-sm"
          style={{ borderLeftColor: COLOR_NIVEL[d.nivel] }}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-[19px] font-bold tracking-[-0.3px]">{d.titulo}</h2>
            <Pastilla nombre={NOMBRE_NIVEL[d.nivel]} color={COLOR_NIVEL[d.nivel]} />
            {d.protegida && d.nivelPublicado && d.nivelPublicado !== d.nivel && (
              <span className="text-[12.5px] text-muted-foreground">
                en su panel se ve {NOMBRE_NIVEL[d.nivelPublicado].toLowerCase()}
              </span>
            )}
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-[12.5px] font-semibold",
                d.demoraPermiteEnvioRapido ? "text-green-600" : "text-amber-600",
              )}
            >
              <Zap className="size-3.5" strokeWidth={2.2} aria-hidden="true" />
              {d.demoraPermiteEnvioRapido
                ? "El despacho da para “llega mañana”"
                : "El despacho no da para “llega mañana”"}
            </span>
          </div>
          <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-muted-foreground">
            {d.mensaje}
          </p>
          {d.protegidaHasta && (
            <p className="mt-1.5 max-w-2xl text-[13px] font-medium text-amber-700 dark:text-amber-500">
              La protección de Mercado Libre vence el {formatearFechaHora(d.protegidaHasta)}: a
              partir de ahí el color de su panel pasa a ser el de arriba.
            </p>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {d.metricas.map((m) => (
              <Metrica key={m.clave} m={m} />
            ))}
          </div>
          <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
            Porcentajes de los últimos 60 días. El número grande es el REAL, contando todos los
            casos; cuando Mercado Libre excluye algunos, su cifra aparece al lado. Los niveles
            usan los umbrales de México.
          </p>
        </section>
      )}

      {!salud && (
        <p className="rounded-xl border border-dashed p-5 text-center text-[13.5px] text-muted-foreground">
          Mercado Libre no respondió con el estado de la cuenta. El tablero de despacho de
          abajo sigue siendo válido: sale de las ventas ya importadas.
        </p>
      )}

      {/* --- Lo que la plataforma se queda --- */}
      {costos && (
        <Bloque
          titulo="Lo que cuesta vender aquí"
          icono={Scissors}
          pie={`Sobre ${costos.ordenes.toLocaleString("es-MX")} órdenes de los últimos ${costos.dias} días con costo archivado. Son las cifras que cobró Mercado Libre, no estimaciones. El flete es el que pagamos NOSOTROS: el comprador casi siempre paga cero.`}
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato etiqueta="Vendido" valor={formatearMXN(costos.venta)} />
            <Dato
              etiqueta="Comisión"
              valor={formatearMXN(costos.comision)}
              className="text-red-600"
            />
            <Dato
              etiqueta="Envío a nuestro cargo"
              valor={formatearMXN(costos.flete)}
              className="text-red-600"
            />
            <Dato
              etiqueta="Queda"
              valor={formatearMXN(costos.venta - costos.comision - costos.flete)}
              detalle={`se va el ${costos.tasa.toFixed(1)}%, antes del producto`}
              className="text-green-600"
            />
          </div>
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
            <span
              className="bg-green-500"
              style={{ width: `${Math.max(0, 100 - costos.tasa)}%` }}
            />
            <span className="bg-red-500" style={{ width: `${Math.min(100, costos.tasa)}%` }} />
          </div>
        </Bloque>
      )}

      {/* --- Lo que hay que sacar hoy --- */}
      <section>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[17px] font-bold tracking-[-0.3px]">Pendientes por despachar</h2>
          <span className="text-[12.5px] text-muted-foreground">
            Últimos {dias} días
            {ultimaSync && ` · sincronizado ${formatearFechaHora(ultimaSync)}`}
          </span>
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
          El plazo se reconstruye con lo que manda Mercado Libre de cada envío: la hora en que
          entró a preparación más las horas de manejo que concede. No publica la fecha límite ya
          hecha, así que los pedidos a los que les falte alguno de esos dos datos no aparecen.
        </p>

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard
            etiqueta="Se pasó el plazo"
            valor={String(resumen.vencidos)}
            icono={AlertTriangle}
            valorClassName={resumen.vencidos > 0 ? "text-red-600" : undefined}
            nota={resumen.vencidos > 0 ? "ya suman a la métrica" : "ninguno"}
          />
          <StatCard
            etiqueta="Vence en horas"
            valor={String(resumen.porVencer)}
            icono={Clock}
            valorClassName={resumen.porVencer > 0 ? "text-amber-600" : undefined}
            nota={resumen.porVencer > 0 ? "hay que sacarlos hoy" : "nada urgente"}
          />
          <StatCard
            etiqueta="Pendientes en total"
            valor={String(resumen.pendientes.length)}
            icono={PackageCheck}
            nota="sin despachar"
          />
        </div>

        {resumen.pendientes.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-[13.5px] text-muted-foreground">
            No hay nada esperando despacho. Así se conserva la exposición.
          </p>
        ) : (
          <div className="rounded-2xl border bg-card px-5 py-1 shadow-sm">
            <ul>
              {resumen.pendientes.map((p) => (
                <FilaDespacho key={p.orden} d={p} ahora={ahora} />
              ))}
            </ul>
          </div>
        )}

        {urgentes > 0 && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-500/10 p-3.5 text-[13px] leading-relaxed text-amber-700 dark:text-amber-500">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
            <span>
              {urgentes === 1 ? "Hay 1 pedido" : `Hay ${urgentes} pedidos`} que ya venció o vence en
              horas. Cada uno que salga tarde se queda 60 días dentro de la métrica que nos quita
              exposición.
            </span>
          </p>
        )}
      </section>

    </div>
  );
}
