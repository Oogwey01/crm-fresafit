"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BarraHerramientas } from "@/components/compartido/barra-herramientas";
import { CampoBusqueda } from "@/components/compartido/campo-busqueda";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { Pastilla } from "@/components/compartido/pastilla";
import { Resaltado } from "@/components/compartido/resaltado";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { Miniatura } from "@/components/compartido/miniatura";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { GuiaMaquilaDialog } from "@/components/maquila/guia-dialog";
import {
  cambiarEstadoMaquila,
  cambiarSubestadoMaquila,
  urlGuiaMaquila,
} from "@/app/(app)/maquila/actions";
import {
  ESTADOS_MAQUILA,
  ESTADOS_MAQUILA_ACTIVOS,
  SUBESTADOS_MAQUILA,
  obtenerAcabadoMaquila,
  obtenerCanal,
  obtenerColorPalanca,
  obtenerEstadoMaquila,
  obtenerModeloMaquila,
  obtenerSubestadoMaquila,
} from "@/lib/catalogos";
import {
  SEMAFORO_MAQUILA,
  grupoDePedido,
  indicadoresDePedido,
  particionarPedidos,
  semaforoMaquila,
} from "@/lib/maquila/reglas";
import { formatearFecha, formatearFechaHora } from "@/lib/fecha";
import { direccionEnUnaLinea } from "@/lib/canales/direccion";
import { norm } from "@/lib/importar/tsv";
import type {
  EstadoMaquilaId,
  GuiaMaquila,
  PedidoMaquila,
  SubestadoMaquilaId,
} from "@/lib/types";

const ACTIVOS: readonly string[] = ESTADOS_MAQUILA_ACTIVOS;

/* Sin vista de atrasados: es un subconjunto de «Hoy» y las filas vencidas ya
   se pintan en rojo en cualquier vista — la pastilla roja de la barra filtra.
   `espera` solo existe para el equipo: a Eduardo la RLS ni le entrega esas
   filas y el segmento no se le pinta. */
export type Vista = "espera" | "hoy" | "salidas" | "corte" | "prensados" | "esperando" | "historial";

/* «Salidas»: lo que pidió Armando — TODOS los pedidos que han caído al
   tablero, ordenados por el día en que salieron (se pagaron), el más nuevo
   arriba. «Hoy» sigue siendo lo que VENCE hoy; son preguntas distintas. */
const VISTAS_TALLER = [
  ["hoy", "Hoy"],
  ["salidas", "Salidas"],
  ["corte", "Corte actual"],
  ["prensados", "Prensados"],
  ["esperando", "Esperando diseño"],
  ["historial", "Historial"],
] as const;

/* A dónde puede avanzar cada estado con el botón (el flujo del maquilero).
   `enviado` no está: a enviado solo se llega capturando la guía. */
const SIGUIENTE: Partial<Record<EstadoMaquilaId, { a: EstadoMaquilaId; etiqueta: string }>> = {
  recibido: { a: "en_produccion", etiqueta: "Iniciar producción" },
  pendiente_produccion: { a: "en_produccion", etiqueta: "Iniciar producción" },
  en_produccion: { a: "terminado", etiqueta: "Terminado" },
  enviado: { a: "entregado", etiqueta: "Entregado" },
};

/* Los sub-estados solo aplican a la producción por lote y solo hacia
   adelante; la BD lo exige para el maquilero y la UI no ofrece lo que va a
   rebotar. */
function subestadosDisponibles(p: PedidoMaquila) {
  const desde = p.subestado
    ? SUBESTADOS_MAQUILA.findIndex((s) => s.id === p.subestado)
    : -1;
  return SUBESTADOS_MAQUILA.filter((_, i) => i > desde);
}

/* El tablero de producción, compartido: Eduardo lo ve solo con sus botones de
   avance; el equipo, con el selector completo de estados y el diálogo de
   detalle. Las vistas son las de la spec — lo urgente arriba, siempre (la
   lista ya llega ordenada por fecha prometida). */
export function TableroMaquila({
  pedidos,
  guias,
  disenosPorPedido,
  hoy,
  esEquipo,
  onAbrir,
  vista: vistaControlada,
  onVista,
  soloAtrasados: soloAtrasadosControlado,
  onSoloAtrasados,
}: {
  pedidos: PedidoMaquila[];
  /* Las solicitudes de guía vivas, indexadas por paquete: es lo que convierte
     la columna Guía en «solicitada / lista para imprimir». */
  guias: GuiaMaquila[];
  /* pedido_id → ruta del arte en el bucket `personalizados`. Lo que hace que
     cada renglón enseñe SU cinturón y no la portada del catálogo. */
  disenosPorPedido: Record<string, string>;
  hoy: string;
  esEquipo: boolean;
  onAbrir?: (p: PedidoMaquila) => void;
  /* La vista y el filtro de atrasados admiten control externo: el panel del
     equipo los levanta para que sus StatCards naveguen hasta aquí. Sin estas
     props (la vista del maquilero) el tablero se maneja solo. */
  vista?: Vista;
  onVista?: (v: Vista) => void;
  soloAtrasados?: boolean;
  onSoloAtrasados?: (v: boolean) => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [vistaInterna, setVistaInterna] = useState<Vista>("hoy");
  const [soloAtrasadosInterno, setSoloAtrasadosInterno] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const [guiaPara, setGuiaPara] = useState<PedidoMaquila | null>(null);

  const vista = vistaControlada ?? vistaInterna;
  const setVista = onVista ?? setVistaInterna;
  const soloAtrasados = soloAtrasadosControlado ?? soloAtrasadosInterno;
  const setSoloAtrasados = onSoloAtrasados ?? setSoloAtrasadosInterno;

  const VISTAS: readonly (readonly [Vista, string])[] = esEquipo
    ? ([["espera", "Esperando pago"], ...VISTAS_TALLER] as const)
    : VISTAS_TALLER;

  /* El cruce guía↔pedido es por (canal, grupo): no hay FK porque la guía es
     del paquete y el pedido del renglón. `grupoDePedido` espeja el coalesce
     del trigger y de la RLS. */
  const guiaPorPaquete = new Map(guias.map((g) => [`${g.canal}|${g.grupo}`, g]));
  const guiaDe = (p: PedidoMaquila) =>
    guiaPorPaquete.get(`${p.canal}|${grupoDePedido(p)}`) ?? null;

  /* El arte, servido por la ruta que ya usa /personalizados: valida la sesión y
     redirige al enlace firmado y redimensionado, así que la página no firma
     nada por adelantado y el navegador solo pide las miniaturas que se ven. */
  const arteDe = (p: PedidoMaquila) => {
    const path = disenosPorPedido[p.id];
    return path ? `/api/personalizados/diseno?path=${encodeURIComponent(path)}` : null;
  };

  /* Un personalizado no se puede empezar sin el arte, y ese pendiente es del
     diseñador. Las vistas de trabajo enseñan SOLO lo que ya se puede producir
     —lo de catálogo entra derecho, sin esperar a nadie— y lo demás vive en su
     propia vista, para que se vea que viene en camino y no que se perdió. */
  const parte = particionarPedidos(pedidos, ACTIVOS, hoy);
  const { atrasados, corteActual } = parte;

  /* «Salidas»: todo lo que ya cayó al tablero (pagado), del más reciente al
     más viejo. La lista llega ordenada por promesa; aquí manda cuándo salió. */
  const salidas = pedidos
    .filter((p) => p.estado !== "esperando_pago")
    .slice()
    .sort((a, b) =>
      (b.pagado_en ?? b.created_at).localeCompare(a.pagado_en ?? a.created_at),
    );

  const porVista: Record<Vista, PedidoMaquila[]> = {
    espera: esEquipo ? parte.esperandoPago : [],
    hoy: parte.paraHoy,
    salidas,
    corte: parte.loteActual,
    prensados: parte.prensados,
    esperando: parte.esperandoArte,
    historial: parte.historial,
  };

  /* La lente de atrasados: filtra la vista activa a lo realmente atrasado
     (listo Y vencido) — por pertenencia, no por fecha, para que el historial
     viejo no se cuele. Si el último atrasado se entrega, se apaga sola. */
  const filtroAtrasados = soloAtrasados && atrasados.length > 0;
  const idsAtrasados = new Set(atrasados.map((p) => p.id));
  const enVista = filtroAtrasados
    ? porVista[vista].filter((p) => idsAtrasados.has(p.id))
    : porVista[vista];

  const q = norm(busqueda);
  const visibles = enVista.filter((p) => {
    if (!q) return true;
    return [p.diseno, p.sku, p.numero_orden, p.envio_nombre, p.talla, p.color, p.notas]
      .filter(Boolean)
      .some((c) => norm(String(c)).includes(q));
  });

  const columnas: Columna<PedidoMaquila>[] = [
    {
      clave: "pedido",
      label: "Pedido",
      esTitulo: true,
      celda: (p) => (
        <div className="flex min-w-0 items-center gap-2.5">
          {/* El arte manda sobre la portada del catálogo: en un personalizado
              la foto de la tienda es la misma para los ocho pedidos, y lo que
              hay que producir es el diseño que subió el diseñador. Sin arte
              (gamuza PRO, o todavía sin entregar) se queda la del producto. */}
          <Miniatura
            src={arteDe(p) ?? p.imagen_url}
            alt={arteDe(p) ? `Diseño de ${p.envio_nombre ?? p.numero_orden ?? "el pedido"}` : (p.diseno ?? p.sku ?? "Cinturón")}
            tam="size-11"
          />
          <div className="min-w-0">
            <div className="truncate font-semibold">
              <Resaltado texto={p.diseno ?? p.sku ?? "Sin diseño"} busca={busqueda} />
              {p.cantidad > 1 && <span className="ml-1.5 text-primary">×{p.cantidad}</span>}
            </div>
            <div className="truncate text-[12.5px] text-muted-foreground">
              {[
                obtenerModeloMaquila(p.modelo)?.nombre,
                obtenerAcabadoMaquila(p.acabado)?.nombre,
                p.talla ? `talla ${p.talla}` : null,
                p.color,
              ]
                .filter(Boolean)
                .join(" · ")}{" "}
              {indicadoresDePedido(p).map((i) => (
                <span key={i.icono} title={i.titulo}>
                  {i.icono}
                </span>
              ))}
            </div>
          </div>
        </div>
      ),
    },
    {
      clave: "orden",
      label: "Orden",
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-[12.5px]">
            <Resaltado texto={p.numero_orden ?? "manual"} busca={busqueda} />
          </div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            <Resaltado texto={p.envio_nombre ?? "—"} busca={busqueda} />
          </div>
        </div>
      ),
    },
    {
      clave: "palanca",
      label: "Palanca",
      celda: (p) => {
        if (!p.requiere_palanca) return <span className="text-muted-foreground/50">—</span>;
        const color = obtenerColorPalanca(p.palanca_color);
        return color ? (
          <Pastilla nombre={color.nombre} color={color.color} />
        ) : (
          <Pastilla nombre="SIN DEFINIR" color="#d63031" />
        );
      },
    },
    {
      clave: "promesa",
      /* En «Salidas» lo que importa es CUÁNDO salió el pedido, no cuándo vence. */
      label: vista === "salidas" ? "Salió" : "Promesa",
      celda: (p) => {
        if (vista === "salidas") {
          return (
            <div className="min-w-0">
              <div className="font-medium">
                {formatearFechaHora(p.pagado_en ?? p.created_at)}
              </div>
              <div className="text-[11.5px] text-muted-foreground">
                {p.fecha_prometida ? `promesa ${formatearFecha(p.fecha_prometida)}` : ""}
              </div>
            </div>
          );
        }
        const sem = ACTIVOS.includes(p.estado) ? semaforoMaquila(p.fecha_prometida, hoy) : null;
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              {sem && (
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: SEMAFORO_MAQUILA[sem].color }}
                  title={SEMAFORO_MAQUILA[sem].nombre}
                />
              )}
              <span
                className={
                  sem === "rojo" ? "font-semibold text-red-600" : "font-medium"
                }
              >
                {p.fecha_prometida ? formatearFecha(p.fecha_prometida) : "—"}
              </span>
            </div>
            <div className="text-[11.5px] text-muted-foreground">
              {p.ruta === "corte" && p.corte_fecha
                ? `corte del ${formatearFecha(p.corte_fecha)}`
                : p.ruta === "directa"
                  ? "producción directa"
                  : ""}
            </div>
          </div>
        );
      },
    },
    {
      clave: "estado",
      label: "Estado",
      cardAncho: true,
      celda: (p) => {
        const estado = obtenerEstadoMaquila(p.estado);
        const siguiente = SIGUIENTE[p.estado];
        const conSubestado =
          p.estado === "en_produccion" && p.acabado !== "prensado";
        return (
          <div className="flex min-w-0 flex-col gap-1.5">
            {esEquipo ? (
              <Select
                value={p.estado}
                disabled={pending}
                onValueChange={(v) =>
                  v &&
                  v !== p.estado &&
                  ejecutar(() => cambiarEstadoMaquila(p.id, v as EstadoMaquilaId), {
                    ok: `${p.diseno ?? "Pedido"} → ${obtenerEstadoMaquila(v)?.nombre ?? v}.`,
                  })
                }
              >
                <SelectTrigger className="h-8 w-[168px]">
                  <SelectValue>
                    {(v: string) => obtenerEstadoMaquila(v)?.nombre ?? "Estado"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {/* Sin esperando_pago (lo pone el sistema al llegar el pago) y
                      sin cancelado/devuelto: esas son decisiones de
                      administración y viven en el diálogo, con su guardia. */}
                  {ESTADOS_MAQUILA.filter(
                    (e) => !["esperando_pago", "cancelado", "devuelto"].includes(e.id),
                  ).map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <div className="flex items-center gap-1.5">
                {estado && <Pastilla nombre={estado.nombre} color={estado.color} />}
                {siguiente && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      ejecutar(() => cambiarEstadoMaquila(p.id, siguiente.a), {
                        ok: `${p.diseno ?? "Pedido"} → ${obtenerEstadoMaquila(siguiente.a)?.nombre}.`,
                      })
                    }
                  >
                    {siguiente.etiqueta}
                  </Button>
                )}
              </div>
            )}
            {conSubestado && (
              <Select
                value={p.subestado ?? ""}
                disabled={pending}
                onValueChange={(v) =>
                  v &&
                  v !== p.subestado &&
                  ejecutar(() => cambiarSubestadoMaquila(p.id, v as SubestadoMaquilaId), {
                    ok: `→ ${obtenerSubestadoMaquila(v)?.nombre ?? v}.`,
                  })
                }
              >
                <SelectTrigger className="h-7 w-[168px] text-[12px]">
                  <SelectValue>
                    {(v: string) => obtenerSubestadoMaquila(v)?.nombre ?? "¿Y el tercero?"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(esEquipo ? SUBESTADOS_MAQUILA : subestadosDisponibles(p)).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        );
      },
    },
    {
      clave: "guia",
      label: "Guía",
      cardAncho: true,
      celda: (p) => {
        /* La guía la surte logística: Eduardo la descarga e imprime. El botón
           de captura a mano se queda como respaldo para cuando la etiqueta
           llegó por fuera y nadie la subió. */
        const guia = guiaDe(p);
        return (
        <div className="flex items-center gap-1.5">
          {guia?.archivo_path ? (
            <Button
              size="sm"
              variant="default"
              disabled={pending}
              onClick={() =>
                ejecutar(() => urlGuiaMaquila(guia.id), {
                  alExito: (r) => {
                    window.open(r.datos.url, "_blank", "noopener");
                  },
                })
              }
              className="gap-1.5"
            >
              <Download className="size-3.5" />
              Imprimir guía
            </Button>
          ) : p.num_guia ? (
            <div className="min-w-0">
              <div className="truncate font-mono text-[12px]">{p.num_guia}</div>
              {p.paqueteria && (
                <div className="truncate text-[11px] text-muted-foreground">{p.paqueteria}</div>
              )}
            </div>
          ) : guia ? (
            <Pastilla nombre="Guía solicitada" color="#f59e0b" />
          ) : ACTIVOS.includes(p.estado) ? (
            <Button
              size="sm"
              variant={p.estado === "terminado" ? "default" : "outline"}
              disabled={pending}
              onClick={() => setGuiaPara(p)}
            >
              Guía
            </Button>
          ) : (
            <span className="text-muted-foreground/50">—</span>
          )}
          <Link
            href={`/maquila/ficha/${p.id}`}
            target="_blank"
            onClick={(e) => e.stopPropagation()}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Imprimir ficha de producción"
            aria-label="Imprimir ficha de producción"
          >
            <Printer className="size-4" />
          </Link>
        </div>
        );
      },
    },
  ];

  /* La vista de espera enseña otra cosa: no hay promesa ni estado que mover
     (el pago no ha entrado), lo que importa es QUÉ llegó, de quién y cuándo. */
  const columnasEspera: Columna<PedidoMaquila>[] = [
    {
      clave: "pedido",
      label: "Pedido",
      esTitulo: true,
      celda: (p) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Miniatura src={p.imagen_url} alt={p.diseno ?? p.sku ?? "Cinturón"} tam="size-11" />
          <div className="min-w-0">
            <div className="truncate font-semibold">
              <Resaltado texto={p.diseno ?? p.sku ?? "Sin diseño"} busca={busqueda} />
            </div>
            <div className="truncate text-[12.5px] text-muted-foreground">
              {[
                obtenerModeloMaquila(p.modelo)?.nombre,
                obtenerAcabadoMaquila(p.acabado)?.nombre,
                p.talla ? `talla ${p.talla}` : null,
                p.color,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        </div>
      ),
    },
    {
      clave: "orden",
      label: "Orden",
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-[12.5px]">
            <Resaltado texto={p.numero_orden ?? "manual"} busca={busqueda} />
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            {obtenerCanal(p.canal)?.nombre ?? p.canal}
          </div>
        </div>
      ),
    },
    {
      clave: "cliente",
      label: "Cliente",
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate">
            <Resaltado texto={p.envio_nombre ?? "—"} busca={busqueda} />
          </div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {direccionEnUnaLinea(p.envio_direccion) || "—"}
          </div>
        </div>
      ),
    },
    {
      clave: "llego",
      label: "Llegó",
      celda: (p) => (
        <span className="text-muted-foreground">{formatearFechaHora(p.created_at)}</span>
      ),
    },
  ];

  const esEspera = vista === "espera";

  return (
    <div>
      <BarraHerramientas>
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar por diseño, orden, cliente o SKU…"
          conteo={{ visibles: visibles.length, total: enVista.length, unidad: "pedidos" }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <ControlSegmentado opciones={VISTAS} valor={vista} onCambio={setVista} />
          {vista === "corte" && corteActual && (
            <span className="text-[13px] font-medium text-muted-foreground">
              corte del {formatearFecha(corteActual)}
            </span>
          )}
          <div className="flex-1" />
          {parte.esperandoArte.length > 0 && (
            <Pastilla nombre={`${parte.esperandoArte.length} esperando diseño`} color="#f59e0b" />
          )}
          {atrasados.length > 0 && (
            <button
              type="button"
              aria-pressed={soloAtrasados}
              title={
                soloAtrasados
                  ? "Quitar el filtro y ver la vista completa"
                  : "Dejar solo los atrasados en la vista"
              }
              onClick={() => setSoloAtrasados(!soloAtrasados)}
              className={`rounded-md ${soloAtrasados ? "ring-2 ring-red-500/50" : ""}`}
            >
              <Pastilla nombre={`${atrasados.length} atrasados`} color="#d63031" />
            </button>
          )}
        </div>
      </BarraHerramientas>

      {esEspera && (
        <p className="mb-3 text-[13.5px] text-muted-foreground">
          Ya llegó la orden pero el pago no se ha aprobado, así que{" "}
          <b className="font-semibold text-foreground">no se produce ni se le muestra a Eduardo</b>.
          Cuando el pago entra, se calcula la fecha prometida y el pedido salta solo al tablero. Si
          la orden se cancela antes, se marca y se queda como constancia.
        </p>
      )}

      <TablaSimple
        cols={
          esEspera
            ? "grid-cols-[minmax(220px,1.4fr)_140px_minmax(200px,1fr)_150px]"
            : "grid-cols-[minmax(200px,1.3fr)_150px_120px_150px_190px_170px]"
        }
        columnas={esEspera ? columnasEspera : columnas}
        datos={visibles}
        filaKey={(p) => p.id}
        minW={esEspera ? "min-w-[820px]" : "min-w-[1080px]"}
        filaClassName={(p) =>
          ACTIVOS.includes(p.estado) && p.fecha_prometida && p.fecha_prometida < hoy
            ? "bg-red-500/5"
            : ""
        }
        vacio={
          filtroAtrasados
            ? "Sin atrasados en esta vista."
            : esEspera
              ? "Nada esperando pago. Cuando una orden llegue sin pagar, cae aquí y NO al tablero de Eduardo."
              : vista === "historial"
                ? "Todavía no se entrega nada."
                : vista === "esperando"
                  ? "Nada atorado en diseño: todo lo vendido ya tiene su arte."
                  : "Nada pendiente en esta vista. 🎉"
        }
        onRowClick={onAbrir}
      />

      {guiaPara && (
        <GuiaMaquilaDialog pedido={guiaPara} onClose={() => setGuiaPara(null)} />
      )}
    </div>
  );
}
