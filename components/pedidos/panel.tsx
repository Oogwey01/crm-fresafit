"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Clock, ExternalLink, Eye, PackageCheck, Printer, Send, Truck } from "lucide-react";
import {
  CANALES,
  ESTADOS_PEDIDO,
  ESTADOS_PEDIDO_PENDIENTES,
  esGestor,
  obtenerCanal,
  obtenerEstadoPedido,
} from "@/lib/catalogos";
import { diasDesdeFecha, esPedidoAtrasado, formatearFecha, formatearFechaHora } from "@/lib/fecha";
import {
  PREPARACION,
  SITUACION,
  situacionDespacho,
  situacionPreparacion,
  type SituacionPreparacion,
} from "@/lib/canales/despacho";
import { nombreVenta } from "@/lib/ventas";
import { urlOrdenCanal, urlRastreo } from "@/lib/pedidos/rastreo";
import { cambiarEstadoPedido, listarPedidosHistorico } from "@/app/(app)/pedidos/actions";
import type { CanalId, EstadoPedidoId, RolId, PedidoEnvio } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pastilla } from "@/components/compartido/pastilla";
import { BarraHerramientas } from "@/components/compartido/barra-herramientas";
import { CampoBusqueda } from "@/components/compartido/campo-busqueda";
import { Resaltado } from "@/components/compartido/resaltado";
import { StatCard } from "@/components/compartido/stat-card";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { EnvioDialog } from "@/components/pedidos/envio-dialog";
import { cn } from "@/lib/utils";

/* Las VISTAS de la pantalla. "Entregados" era una y salió de aquí: ahora es un
   estado más del selector, que además alcanza los cancelados —que no tenían
   forma de verse solos— y no deja combinar "Entregados" con "estado: nuevo",
   que solo podía dar una tabla vacía.

   "Listos" nació de una pregunta de Armando: por qué un pedido que Mercado
   Libre ya daba por "Listo para recolección" seguía saliendo en Urgentes. Es su
   propia vista porque no es trabajo pendiente ni asunto cerrado: el paquete está
   hecho y lo único que falta es que alguien lo recoja. Si nadie lo hace en dos
   días, ahí se ve. */
type Filtro = "pendientes" | "urgentes" | "listos" | "todos";

const FILTROS: [Filtro, string][] = [
  ["pendientes", "Pendientes"],
  ["urgentes", "Urgentes"],
  ["listos", "Listos"],
  ["todos", "Todos"],
];

/* Los estados que ya no dan trabajo viven en el histórico, que la página no
   carga de entrada: pedirlos exige traerlo primero. */
function esEstadoTerminal(e: EstadoPedidoId): boolean {
  return !(ESTADOS_PEDIDO_PENDIENTES as readonly string[]).includes(e);
}

/* La última columna llevaba 60 px y el envío ("Estafeta MX 905590979741C70…")
   salía cortado sin remedio; ahora es la más ancha de la fila, que es lo que
   corresponde a la información con la que uno trabaja al empacar. La primera
   creció de 88 a 112 px para que quepa la pastilla del plazo de despacho, y de
   112 a 148 para la de "Listo para recolección" —el nombre es el que usa el
   panel de Mercado Libre y acortarlo obligaría a traducir de una pantalla a la
   otra—. */
const COLS = "grid-cols-[148px_minmax(170px,1fr)_130px_120px_118px_minmax(215px,250px)]";

/* `referencia_externa` es por RENGLÓN ("<orden>:<línea>"); lo que identifica al
   pedido de cara al cliente es la parte de la orden. */
function numeroOrden(ref: string): string {
  return ref.split(":")[0];
}

/* La guía imprimible DIRECTA: solo cuando el clic de verdad entrega la
   etiqueta (hoy: Mercado Libre con id de envío → PDF de su API). Cuando no la
   hay, la impresora no se pinta — mandar "imprimir" al detalle del pedido
   confundía, era un "ver pedido" disfrazado. */
function urlEtiquetaDirecta(p: PedidoEnvio): string | null {
  if (p.estado !== "nuevo" && p.estado !== "preparando") return null;
  if (p.canal === "mercado_libre" && p.envio_id) {
    return `/api/mercadolibre/etiqueta?envio=${encodeURIComponent(p.envio_id)}`;
  }
  return null;
}

/* "Ver pedido": la orden en el panel del canal, que es donde se imprime la
   guía cuando no hay PDF directo. Tienda Nube va por la ruta de etiqueta: hoy
   redirige al admin (Envío Nube no publica el PDF en la API), y el día que lo
   publique, este mismo enlace lo entregará sin tocar nada. */
function urlVerPedido(p: PedidoEnvio, dominioTN?: string | null): string | null {
  const ref = p.referencia_externa ? numeroOrden(p.referencia_externa) : "";
  if (p.canal === "tienda_nube" && /^\d+$/.test(ref)) {
    return `/api/tiendanube/etiqueta?orden=${encodeURIComponent(ref)}`;
  }
  return urlOrdenCanal(p.canal, ref, dominioTN, p.url_orden);
}

/* Dónde está el paquete de un pedido que aún no sale. Para los que ya salieron
   —enviado en adelante— no aplica: el subestado que quedó guardado describe una
   etapa que ya pasó. */
function preparacion(p: PedidoEnvio): SituacionPreparacion | null {
  if (p.estado !== "nuevo" && p.estado !== "preparando") return null;
  return situacionPreparacion(p.envio_logistica, p.envio_subestado);
}

/* ¿Queda trabajo de bodega? Es la pregunta que decide qué sale en Urgentes.
   Un paquete ya empacado esperando la colecta, o uno que vive en un centro de
   Mercado Full, no lo es — por muy vencido que esté el plazo, apurarse no
   cambia nada—. Sin el dato del canal (Tienda Nube no lo manda) se asume que sí:
   es lo que había antes y es el lado seguro. */
function hayTrabajo(p: PedidoEnvio): boolean {
  const s = preparacion(p);
  return s === null || PREPARACION[s].pendiente;
}

/* Plazo de despacho del canal (la sync lo deja en la venta; hoy lo reportan
   Mercado Libre y TikTok Shop): solo avisa mientras el pedido da trabajo —nuevo
   o preparando, y todavía en la bodega— y solo cuando urge. Ya enviado, "se pasó
   el plazo" es ruido; en plazo holgado, también; y sobre un paquete que ya está
   hecho, es una alarma que nadie puede atender. */
function plazoUrgente(p: PedidoEnvio, ahora: number): "vencido" | "por_vencer" | null {
  if (p.estado !== "nuevo" && p.estado !== "preparando") return null;
  if (!hayTrabajo(p)) return null;
  const s = situacionDespacho(p.envio_limite_despacho, p.envio_despachado_en, ahora);
  return s === "vencido" || s === "por_vencer" ? s : null;
}

/* Cuánto lleva en la calle un paquete que ya salió. Es la contraparte tranquila
   de `esPedidoAtrasado`: los enviados salieron de "atrasados" —despachar ya no
   está pendiente— pero saber que uno lleva 18 días sin confirmarse sigue siendo
   útil para llamar a la paquetería. Gris a propósito: informa, no alarma. */
const DIAS_TRANSITO_VISIBLE = 5;

function diasEnTransito(p: PedidoEnvio): number | null {
  if (p.estado !== "enviado") return null;
  const d = diasDesdeFecha(p.fecha);
  return d >= DIAS_TRANSITO_VISIBLE ? d : null;
}

/* Lo que la tabla pinta de rojo, y por tanto lo que el contador debe contar.

   Son dos cosas distintas que urgen igual: el pedido viejo que sigue sin salir
   (la regla de los tres días, que vale para todos los canales) y el que tiene el
   plazo del canal ya vencido, aunque sea de ayer —ahí además hay una métrica de
   la plataforma castigándonos—. El KPI contaba solo la primera mitad, así que
   podía haber cinco filas rojas y un "Atrasados: 2". */
function esUrgente(p: PedidoEnvio, ahora: number): boolean {
  /* Los dos criterios exigen que quede algo por hacer aquí. Un pedido del 14 de
     agosto empacado y esperando la colecta cumplía las dos condiciones y salía
     rojo: la regla de los tres días lo daba por atrasado y el plazo del canal
     por vencido, cuando lo único pendiente era que pasara el transportista. */
  if (!hayTrabajo(p)) return false;
  return esPedidoAtrasado(p.fecha, p.estado) || plazoUrgente(p, ahora) === "vencido";
}

function PastillaEstado({ estado }: { estado: string }) {
  const e = obtenerEstadoPedido(estado);
  if (!e) return null;
  return <Pastilla nombre={e.nombre} color={e.color} />;
}

export function PanelPedidos({
  pedidos,
  rol,
  dominioTiendaNube,
  ahora,
}: {
  pedidos: PedidoEnvio[];
  rol: RolId;
  /* Subdominio del panel de la tienda; sin él no se puede enlazar la orden de
     Tienda Nube (cada tienda tiene el suyo). Ver app/(app)/pedidos/page.tsx. */
  dominioTiendaNube?: string | null;
  /* Un solo "ahora" tomado por request en el servidor: dos pedidos con el mismo
     plazo de despacho deben clasificar igual (mismo criterio que el tablero de
     ML, ver instanteDeCorte). */
  ahora: number;
}) {
  const gestor = esGestor(rol);
  /* Cancelar retira la venta de Métricas y devuelve stock: es del lado del
     dinero y la BD lo reserva a dirección (ver 20261020000000). Ofrecerlo a
     quien no puede solo produce un error al soltar el clic; el resto del ciclo
     del envío lo mueve cualquiera del equipo. */
  const estadosQuePuedePoner =
    rol === "direccion" ? ESTADOS_PEDIDO : ESTADOS_PEDIDO.filter((e) => e.id !== "cancelado");
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [filtroCanal, setFiltroCanal] = useState<CanalId | "todos">("todos");
  const [filtroEstado, setFiltroEstado] = useState<EstadoPedidoId | "todos">("todos");
  const [busqueda, setBusqueda] = useState("");
  const [envio, setEnvio] = useState<PedidoEnvio | null>(null);
  const { ejecutar } = useAccionServidor();

  /* La página ya solo carga lo que da trabajo; los entregados y cancelados de
     la ventana se piden UNA vez, la primera vez que alguien sale del filtro de
     pendientes. `null` = aún no se han pedido. */
  const [historico, setHistorico] = useState<PedidoEnvio[] | null>(null);
  const [cargandoHistorico, setCargandoHistorico] = useState(false);

  function asegurarHistorico() {
    if (historico !== null || cargandoHistorico) return;
    setCargandoHistorico(true);
    /* Sin `ok`: es una lectura, y los pedidos que aparecen ya son el acuse. */
    ejecutar(() => listarPedidosHistorico(), {
      error: "No se pudo cargar el histórico. Revisa tu conexión.",
      alExito: (r) => setHistorico(r.pedidos),
      siempre: () => setCargandoHistorico(false),
    });
  }

  /* Activos + histórico, sin repetir (si un pedido está en ambos, manda la
     copia activa: es la más fresca) y en el mismo orden que trae el servidor. */
  const conHistorico = useMemo(() => {
    if (!historico) return pedidos;
    const porId = new Map<string, PedidoEnvio>();
    for (const p of historico) porId.set(p.id, p);
    for (const p of pedidos) porId.set(p.id, p);
    return [...porId.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  }, [pedidos, historico]);

  const conteo = useMemo(() => {
    let nuevos = 0,
      preparando = 0,
      enviados = 0,
      atrasados = 0,
      listos = 0;
    for (const p of pedidos) {
      if (p.estado === "nuevo") nuevos++;
      else if (p.estado === "preparando") preparando++;
      else if (p.estado === "enviado") enviados++;
      if (esUrgente(p, ahora)) atrasados++;
      /* Cuántos de esos "preparando" ya no son trabajo de nadie de aquí: el
         número suelto decía "10 por preparar" cuando nueve estaban hechos. */
      if (preparacion(p) !== null && !hayTrabajo(p)) listos++;
    }
    return { nuevos, preparando, enviados, atrasados, listos };
  }, [pedidos, ahora]);

  const visibles = useMemo(() => {
    /* Un estado concreto manda sobre la vista: quien pide "enséñame lo que está
       preparando" quiere ESO, sin que la vista de arriba se lo recorte. Los
       terminales salen del histórico (el selector se encarga de pedirlo). */
    const porEstado =
      filtroEstado !== "todos"
        ? (esEstadoTerminal(filtroEstado) ? conHistorico : pedidos).filter(
            (p) => p.estado === filtroEstado,
          )
        : filtro === "todos"
          ? conHistorico
          : filtro === "urgentes"
            ? /* Lo que hay que mover HOY: el plazo del canal vencido o a punto,
                 y los que llevan días sin salir. Sale de los pendientes y no del
                 histórico: un pedido entregado ya no urge, por tarde que saliera. */
              pedidos.filter((p) => esUrgente(p, ahora) || plazoUrgente(p, ahora) === "por_vencer")
            : filtro === "listos"
              ? /* Hechos, esperando a que se los lleven: los empacados con la
                   etiqueta puesta y los que están en un centro del canal. Aquí no
                   se empaca nada; se vigila que no lleven días parados. */
                pedidos.filter((p) => preparacion(p) !== null && !hayTrabajo(p))
              : // pendientes: nuevo, preparando, enviado (lo que aún da trabajo)
                pedidos.filter(
                  (p) => p.estado === "nuevo" || p.estado === "preparando" || p.estado === "enviado",
                );

    /* Filtro por canal: hasta ahora el canal se pintaba pero no se podía filtrar,
       y "enséñame solo lo de Mercado Libre" es justo lo que se pide al empacar. */
    const porCanal =
      filtroCanal === "todos" ? porEstado : porEstado.filter((p) => p.canal === filtroCanal);

    const q = busqueda.trim().toLowerCase();
    if (!q) return porCanal;
    /* Se busca por lo que uno tiene a mano cuando pregunta por un pedido: el
       nombre del cliente, el número de guía o la referencia de la orden. */
    return porCanal.filter(
      (p) =>
        (p.cliente?.nombre ?? "").toLowerCase().includes(q) ||
        (p.num_guia ?? "").toLowerCase().includes(q) ||
        (p.paqueteria ?? "").toLowerCase().includes(q) ||
        (p.referencia_externa ?? "").toLowerCase().includes(q) ||
        nombreVenta(p).toLowerCase().includes(q),
    );
  }, [pedidos, conHistorico, filtro, filtroCanal, filtroEstado, busqueda, ahora]);

  /* Recibe el pedido entero, y no solo su id, para que el aviso pueda nombrarlo
     igual que la columna de la tabla. */
  function cambiar(p: PedidoEnvio, estado: EstadoPedidoId) {
    ejecutar(() => cambiarEstadoPedido(p.id, estado), {
      ok: `${nombreVenta(p)} → ${obtenerEstadoPedido(estado)?.nombre ?? estado}.`,
      error: "No se pudo actualizar el pedido. Revisa tu conexión.",
    });
  }

  const columnas: Columna<PedidoEnvio>[] = [
    {
      clave: "fecha",
      label: "Fecha",
      celda: (p) => {
        /* "Atrasado" es un reproche a quien empaca, así que solo se pinta si
           todavía hay algo que empacar. Ver hayTrabajo(). */
        const atrasado = esPedidoAtrasado(p.fecha, p.estado) && hayTrabajo(p);
        const plazo = plazoUrgente(p, ahora);
        const prep = preparacion(p);
        const transito = diasEnTransito(p);
        const canal = obtenerCanal(p.canal)?.nombre ?? "la plataforma";
        return (
          <div className="min-w-0">
            <span
              className={cn("inline-flex items-center gap-1", atrasado && "font-semibold text-red-600")}
            >
              {atrasado && <AlertTriangle className="size-3.5" aria-label="Atrasado" />}
              {formatearFecha(p.fecha)}
            </span>
            {/* Semáforo del plazo de despacho del canal: es el dato por el que
                se decide qué empacar primero, y vivía solo en el panel de ML. */}
            {plazo && (
              <span
                className="block"
                title={`Plazo de despacho de ${canal}: ${formatearFechaHora(p.envio_limite_despacho!)}`}
              >
                <Pastilla
                  nombre={SITUACION[plazo].nombre}
                  color={SITUACION[plazo].color}
                  className="mt-1 whitespace-nowrap px-1.5 py-0.5 text-[10.5px]"
                />
              </span>
            )}
            {/* Dónde está el paquete mientras no sale. "Por empacar" no se
                pinta: es el caso normal de un pendiente y llenaría la tabla de
                pastillas que no dicen nada. Lo que se anuncia es justo lo
                contrario —que aquí ya no hay nada que hacer—, porque es lo que
                explica que el pedido no esté en Urgentes. */}
            {prep && !PREPARACION[prep].pendiente && (
              <span
                className="block"
                title={
                  prep === "en_el_canal"
                    ? `${canal} lo despacha desde su centro: aquí no hay nada que empacar.`
                    : `Empacado y con la etiqueta puesta desde ${formatearFecha(p.fecha)}; falta que pase la recolección.`
                }
              >
                <Pastilla
                  nombre={PREPARACION[prep].nombre}
                  color={PREPARACION[prep].color}
                  className="mt-1 px-1.5 py-0.5 text-[10.5px]"
                />
              </span>
            )}
            {/* Ya salió: cuántos días lleva viajando. No es una alerta. */}
            {transito !== null && (
              <span
                className="mt-1 block whitespace-nowrap text-[10.5px] text-muted-foreground"
                title={`Despachado hace ${transito} días; la plataforma aún no confirma la entrega.`}
              >
                En tránsito {transito} d
              </span>
            )}
          </div>
        );
      },
    },
    {
      clave: "producto",
      label: "Producto",
      esTitulo: true,
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate font-medium" title={nombreVenta(p)}>
            <Resaltado texto={nombreVenta(p)} busca={busqueda} />
            {p.cantidad > 1 && <span className="ml-1 text-muted-foreground">×{p.cantidad}</span>}
          </div>
          {/* Nº de orden del canal: es el dato por el que pregunta el cliente, y
              el enlace lleva a esa misma orden en el panel de la plataforma
              (conversación con el comprador, factura, reclamos: lo que el CRM no
              replica). */}
          {p.referencia_externa &&
            (() => {
              const ref = numeroOrden(p.referencia_externa);
              const url = urlOrdenCanal(p.canal, ref, dominioTiendaNube, p.url_orden);
              const texto = `#${ref}`;
              return url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={`Abrir la orden en ${obtenerCanal(p.canal)?.nombre ?? "la plataforma"}`}
                  className="inline-flex max-w-full items-center gap-1 font-mono text-[11.5px] text-muted-foreground hover:text-foreground hover:underline"
                >
                  <span className="truncate">{texto}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ) : (
                <div className="truncate font-mono text-[11.5px] text-muted-foreground">{texto}</div>
              );
            })()}
        </div>
      ),
    },
    {
      clave: "cliente",
      label: "Cliente",
      celda: (p) => (
        <div className="truncate text-muted-foreground" title={p.cliente?.nombre ?? ""}>
          <Resaltado texto={p.cliente?.nombre ?? "—"} busca={busqueda} />
        </div>
      ),
    },
    {
      clave: "canal",
      label: "Canal",
      celda: (p) => {
        const canal = obtenerCanal(p.canal);
        return canal ? <Pastilla nombre={canal.nombre} color={canal.color} /> : null;
      },
    },
    {
      clave: "estado",
      label: "Estado",
      celda: (p) => (
        <Select
          value={p.estado ?? undefined}
          onValueChange={(v) => v && cambiar(p, v as EstadoPedidoId)}
        >
          <SelectTrigger className="h-auto w-fit gap-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0">
            {p.estado && <PastillaEstado estado={p.estado} />}
          </SelectTrigger>
          <SelectContent>
            {estadosQuePuedePoner.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      clave: "envio",
      label: "Envío",
      cardAncho: true,
      celda: (p) => {
        const rastreo = urlRastreo(p.paqueteria, p.num_guia, p.url_rastreo);
        const etiqueta = urlEtiquetaDirecta(p);
        const pendiente = p.estado === "nuevo" || p.estado === "preparando";
        const verPedido = pendiente ? urlVerPedido(p, dominioTiendaNube) : null;
        const nombreCanal = obtenerCanal(p.canal)?.nombre ?? "la plataforma";
        return (
          <div className="flex min-w-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setEnvio(p)}
              className="min-w-0 flex-1 text-left text-xs text-muted-foreground hover:text-foreground"
              title={
                p.num_guia
                  ? `${p.paqueteria ?? "Guía"} ${p.num_guia}`
                  : "Ver/editar paquetería y guía"
              }
            >
              {p.num_guia ? (
                /* Paquetería arriba y guía abajo: en una sola línea no cabían y
                   la guía —lo que uno copia— era justo lo que se cortaba. */
                <span className="flex min-w-0 items-center gap-1">
                  <Truck className="size-3.5 shrink-0" />
                  <span className="min-w-0 leading-tight">
                    {p.paqueteria && <span className="block truncate">{p.paqueteria}</span>}
                    <span className="block truncate font-mono hover:underline">
                      <Resaltado texto={p.num_guia} busca={busqueda} />
                    </span>
                    {/* Lo último que dijo la paquetería. Es el dato por el que
                        había que salir del CRM: "Exception: empresa cerrada, sin
                        intento de entrega" explica en una línea por qué un
                        paquete se regresó. */}
                    {p.rastreo_detalle && (
                      <span
                        className="block truncate text-[11px] text-muted-foreground"
                        title={`${p.rastreo_estado ?? ""}${p.rastreo_en ? ` · consultado el ${formatearFechaHora(p.rastreo_en)}` : ""}`}
                      >
                        {p.rastreo_detalle}
                      </span>
                    )}
                  </span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-primary hover:underline">
                  <Truck className="size-3.5 shrink-0" />
                  Agregar guía
                </span>
              )}
            </button>
            {/* Dos acciones separadas mientras el pedido está por empacar:
                la impresora SOLO cuando el clic entrega la etiqueta de verdad
                (ML con id de envío), y "ver pedido" para abrir la orden en el
                panel del canal — que es donde se imprime cuando no hay PDF. */}
            {etiqueta && (
              <a
                href={etiqueta}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title="Imprimir la guía (PDF directo de Mercado Libre)"
                aria-label="Imprimir la guía"
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Printer className="size-3.5" />
              </a>
            )}
            {verPedido && (
              <a
                href={verPedido}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={
                  etiqueta
                    ? `Ver el pedido en ${nombreCanal}`
                    : `Ver el pedido en ${nombreCanal} (ahí se imprime la guía)`
                }
                aria-label={`Ver el pedido en ${nombreCanal}`}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <Eye className="size-3.5" />
              </a>
            )}
            {/* Atajo al rastreo de la paquetería: evita copiar la guía a mano en
                el sitio del transportista para saber dónde va el paquete. */}
            {rastreo && (
              <a
                href={rastreo}
                target="_blank"
                rel="noopener noreferrer"
                title={`Rastrear en ${p.paqueteria}`}
                aria-label={`Rastrear el envío en ${p.paqueteria}`}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <div>
      {/* Encabezado */}
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.5px]">Pedidos y envíos</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Qué hay que preparar y mandar, y qué se está atrasando. Los de Tienda Nube entran solos.
          </p>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard etiqueta="Nuevos" valor={String(conteo.nuevos)} icono={Clock} />
        <StatCard
          etiqueta="Preparando"
          valor={String(conteo.preparando)}
          icono={PackageCheck}
          nota={
            conteo.listos > 0
              ? `${conteo.listos} ya listos, esperando recolección`
              : undefined
          }
        />
        <StatCard etiqueta="Enviados" valor={String(conteo.enviados)} icono={Send} />
        <StatCard
          etiqueta="Atrasados"
          valor={String(conteo.atrasados)}
          icono={AlertTriangle}
          valorClassName={conteo.atrasados > 0 ? "text-red-600" : undefined}
        />
      </div>

      {/* El buscador salió del encabezado a su propio renglón: cuando llaman
          preguntando por un pedido, buscar por cliente o guía es lo primero que
          se hace, y ahí arriba competía de tamaño con dos selects y el
          segmentado. La barra además se queda pegada al bajar por la lista. */}
      <BarraHerramientas>
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar cliente, guía o nº de orden…"
          conteo={{ visibles: visibles.length, total: pedidos.length, unidad: "pedidos" }}
        />
        <div className="flex w-full flex-wrap items-center gap-2">
          <Select
            value={filtroCanal}
            onValueChange={(v) => setFiltroCanal((v ?? "todos") as CanalId | "todos")}
          >
            <SelectTrigger className="w-full bg-card md:w-[185px]">
              <SelectValue>
                {(v: string) =>
                  v === "todos" ? "Todos los canales" : (obtenerCanal(v)?.nombre ?? "Canal")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los canales</SelectItem>
              {CANALES.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filtroEstado}
            onValueChange={(v) => {
              const e = (v ?? "todos") as EstadoPedidoId | "todos";
              setFiltroEstado(e);
              /* Entregados y cancelados no vienen en la carga inicial. */
              if (e !== "todos" && esEstadoTerminal(e)) void asegurarHistorico();
            }}
          >
            <SelectTrigger className="w-full bg-card md:w-[165px]">
              <SelectValue>
                {(v: string) =>
                  v === "todos" ? "Todos los estados" : (obtenerEstadoPedido(v)?.nombre ?? "Estado")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos los estados</SelectItem>
              {ESTADOS_PEDIDO.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex w-full rounded-xl bg-muted p-[3px] md:w-auto">
            {FILTROS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => {
                  setFiltro(id);
                  /* El histórico se pide la primera vez que hace falta. Ni
                     "pendientes" ni "urgentes" lo necesitan: los dos salen de lo
                     que el servidor ya mandó. */
                  if (id === "todos") void asegurarHistorico();
                }}
                className={cn(
                  "flex-1 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors md:flex-none",
                  filtro === id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </BarraHerramientas>

      <TablaSimple
        cols={COLS}
        columnas={columnas}
        datos={visibles}
        filaKey={(p) => p.id}
        minW="min-w-[900px]"
        onRowClick={(p) => setEnvio(p)}
        filaClassName={(p) => (esUrgente(p, ahora) ? "bg-red-50/50 dark:bg-red-950/20" : "")}
        vacio={
          cargandoHistorico
            ? "Cargando el histórico…"
            : filtroEstado !== "todos"
              ? `Ningún pedido en "${obtenerEstadoPedido(filtroEstado)?.nombre ?? filtroEstado}".`
              : filtro === "pendientes"
                ? "No hay pedidos pendientes. Todo al día. 🎉"
                : filtro === "urgentes"
                  ? "Nada urgente: ningún pedido con el plazo encima. 🎉"
                  : filtro === "listos"
                    ? "Ningún paquete esperando recolección."
                    : "No hay pedidos que mostrar."
        }
      />

      {envio && (
        <EnvioDialog
          pedido={envio}
          gestor={gestor}
          onClose={() => setEnvio(null)}
        />
      )}
    </div>
  );
}
