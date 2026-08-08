"use client";

import { useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
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
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { GuiaMaquilaDialog } from "@/components/maquila/guia-dialog";
import {
  cambiarEstadoMaquila,
  cambiarSubestadoMaquila,
} from "@/app/(app)/maquila/actions";
import {
  ESTADOS_MAQUILA,
  ESTADOS_MAQUILA_ACTIVOS,
  SUBESTADOS_MAQUILA,
  obtenerAcabadoMaquila,
  obtenerColorPalanca,
  obtenerEstadoMaquila,
  obtenerModeloMaquila,
  obtenerSubestadoMaquila,
} from "@/lib/catalogos";
import {
  SEMAFORO_MAQUILA,
  indicadoresDePedido,
  semaforoMaquila,
} from "@/lib/maquila/reglas";
import { formatearFecha } from "@/lib/fecha";
import { norm } from "@/lib/importar/tsv";
import type { EstadoMaquilaId, PedidoMaquila, SubestadoMaquilaId } from "@/lib/types";

const ACTIVOS: readonly string[] = ESTADOS_MAQUILA_ACTIVOS;

type Vista = "hoy" | "corte" | "prensados" | "atrasados" | "historial";

const VISTAS = [
  ["hoy", "Hoy"],
  ["corte", "Corte actual"],
  ["prensados", "Prensados"],
  ["atrasados", "Atrasados"],
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
  hoy,
  esEquipo,
  onAbrir,
}: {
  pedidos: PedidoMaquila[];
  hoy: string;
  esEquipo: boolean;
  onAbrir?: (p: PedidoMaquila) => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [vista, setVista] = useState<Vista>("hoy");
  const [busqueda, setBusqueda] = useState("");
  const [guiaPara, setGuiaPara] = useState<PedidoMaquila | null>(null);

  const base = pedidos.filter((p) => p.estado !== "esperando_pago");
  const activos = base.filter((p) => ACTIVOS.includes(p.estado));
  const atrasados = activos.filter((p) => p.fecha_prometida && p.fecha_prometida < hoy);
  /* El corte "actual" es el lote pendiente más viejo: si quedó uno atrás, ese
     es el que urge, no el del calendario de esta semana. */
  const enCorte = activos.filter((p) => p.ruta === "corte");
  const corteActual = enCorte.reduce<string | null>(
    (min, p) => (p.corte_fecha && (!min || p.corte_fecha < min) ? p.corte_fecha : min),
    null,
  );

  const porVista: Record<Vista, PedidoMaquila[]> = {
    hoy: activos.filter((p) => p.fecha_prometida && p.fecha_prometida <= hoy),
    corte: enCorte.filter((p) => p.corte_fecha === corteActual),
    prensados: activos.filter((p) => p.ruta === "directa" || p.acabado === "prensado"),
    atrasados,
    historial: base.filter((p) => !ACTIVOS.includes(p.estado)),
  };

  const q = norm(busqueda);
  const visibles = porVista[vista].filter((p) => {
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
      label: "Promesa",
      celda: (p) => {
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
      celda: (p) => (
        <div className="flex items-center gap-1.5">
          {p.num_guia ? (
            <div className="min-w-0">
              <div className="truncate font-mono text-[12px]">{p.num_guia}</div>
              {p.paqueteria && (
                <div className="truncate text-[11px] text-muted-foreground">{p.paqueteria}</div>
              )}
            </div>
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
      ),
    },
  ];

  return (
    <div>
      <BarraHerramientas>
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar por diseño, orden, cliente o SKU…"
          conteo={{ visibles: visibles.length, total: porVista[vista].length, unidad: "pedidos" }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <ControlSegmentado opciones={VISTAS} valor={vista} onCambio={setVista} />
          {vista === "corte" && corteActual && (
            <span className="text-[13px] font-medium text-muted-foreground">
              corte del {formatearFecha(corteActual)}
            </span>
          )}
          <div className="flex-1" />
          {atrasados.length > 0 && (
            <Pastilla nombre={`${atrasados.length} atrasados`} color="#d63031" />
          )}
        </div>
      </BarraHerramientas>

      <TablaSimple
        cols="grid-cols-[minmax(200px,1.3fr)_150px_120px_150px_190px_170px]"
        columnas={columnas}
        datos={visibles}
        filaKey={(p) => p.id}
        minW="min-w-[1080px]"
        filaClassName={(p) =>
          ACTIVOS.includes(p.estado) && p.fecha_prometida && p.fecha_prometida < hoy
            ? "bg-red-500/5"
            : ""
        }
        vacio={
          vista === "historial"
            ? "Todavía no se entrega nada."
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
