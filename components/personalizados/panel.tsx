"use client";

import { useRef, useState } from "react";
import {
  AlarmClock,
  Check,
  Copy,
  Download,
  ExternalLink,
  Mail,
  MailCheck,
  Palette,
  Plus,
  Sparkles,
  Store,
  Truck,
  X,
} from "lucide-react";
import { toast } from "sonner";
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
import { RangoFechas } from "@/components/compartido/rango-fechas";
import { Resaltado } from "@/components/compartido/resaltado";
import { StatCard } from "@/components/compartido/stat-card";
import { Pastilla } from "@/components/compartido/pastilla";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { FiltroMeses } from "@/components/personalizados/filtro-meses";
import { PersonalizadoDialog } from "@/components/personalizados/personalizado-dialog";
import { ImportarPersonalizados } from "@/components/personalizados/importar-personalizados";
import { VerDiseno } from "@/components/personalizados/ver-diseno";
import {
  cambiarEstadoPersonalizado,
  ligaDisenoParaProveedor,
  traerPedidosDeMaquila,
} from "@/app/(app)/personalizados/actions";
import { enviarConfirmacionPersonalizado } from "@/app/(app)/personalizados/acciones/correo";
import {
  ESTADOS_PERSONALIZADO,
  ESTADOS_PERSONALIZADO_ABIERTOS,
  MODELOS_PERSONALIZADO,
  TIPOS_PERSONALIZADO,
  obtenerCanal,
  obtenerEstadoPersonalizado,
} from "@/lib/catalogos";
import { formatearFecha, hoyISO, rangoDeMes, type PresetRangoId } from "@/lib/fecha";
import { enRango } from "@/lib/metricas";
import { norm } from "@/lib/importar/tsv";
import { cn, iniciales } from "@/lib/utils";
import type { EnlaceOrden } from "@/lib/personalizados/desde-maquila";
import type { EstadoPersonalizadoId, Personalizado, Profile } from "@/lib/types";

const ABIERTOS: readonly string[] = ESTADOS_PERSONALIZADO_ABIERTOS;

/* La miniatura ya no llega firmada desde el servidor (firmar ~160 era lo que
   tenía a la página en 18 segundos): cada <img> apunta a esta ruta, que valida
   la sesión y redirige al enlace firmado. Lazy por defecto de next/image, así
   que solo viajan las que entran en pantalla. */
const rutaDiseno = (path: string) => `/api/personalizados/diseno?path=${encodeURIComponent(path)}`;

const colorEstado = (id: string) => obtenerEstadoPersonalizado(id)?.color;

/* El mismo punto que en la hoja hace el relleno de la celda: es lo que permite
   barrer la columna Estado de un vistazo sin leer palabra por palabra. */
function PuntoEstado({ estado }: { estado: string }) {
  const color = colorEstado(estado);
  if (!color) return null;
  return (
    <span
      className="size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
      aria-hidden="true"
    />
  );
}

/* El botón que le escribe al CLIENTE: confirmación, cómo funciona y para cuándo
   lo tendrá. Vive apagado la mayor parte del tiempo —solo Tienda Nube entrega el
   correo del comprador— y por eso el título explica el motivo en vez de dejar un
   botón muerto sin razón aparente. Verde y con palomita cuando ya salió: es la
   única forma de ver desde la tabla a quién falta avisarle. */
function BotonCorreoCliente({
  personalizado: p,
  correo,
  pendiente,
  onEnviar,
}: {
  personalizado: Personalizado;
  correo: string | undefined;
  pendiente: boolean;
  onEnviar: () => void;
}) {
  const enviado = Boolean(p.correo_enviado_en);
  const Icono = enviado ? MailCheck : Mail;
  const titulo = !correo
    ? "No tenemos el correo de este cliente: solo llega de Tienda Nube (Mercado Libre lo anonimiza y TikTok lo enmascara)."
    : enviado
      ? `Confirmación enviada a ${p.correo_enviado_a ?? correo}${
          p.correo_enviado_en ? ` el ${formatearFecha(p.correo_enviado_en.slice(0, 10))}` : ""
        }. Clic para volver a mandarla.`
      : `Mandarle a ${p.cliente} la confirmación de su pedido (${correo})`;

  return (
    <button
      type="button"
      disabled={!correo || pendiente}
      onClick={(e) => {
        e.stopPropagation();
        onEnviar();
      }}
      className={cn(
        "rounded p-1 hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
        enviado ? "text-emerald-600" : "text-muted-foreground hover:text-foreground",
      )}
      title={titulo}
      aria-label={titulo}
    >
      <Icono className="size-4" />
    </button>
  );
}

/* El texto que se le manda a Eduardo (el proveedor que borda/imprime) por
   WhatsApp. Antes se armaba a mano cada vez. La liga del diseño es un enlace
   FIRMADO a la imagen aprobada del bucket —no el `url` de la ficha, que suele
   apuntar a la orden en el panel de la tienda y a Eduardo no le abre—; lo que
   falte se marca en vez de omitirse, para que se vea el hueco. */
function mensajeParaEduardo(p: Personalizado, ligaDiseno: string | null): string {
  const modelo = MODELOS_PERSONALIZADO.find((m) => m.id === p.modelo)?.nombre;
  const tecnica = TIPOS_PERSONALIZADO.find((t) => t.id === p.tipo)?.nombre;
  return [
    `Personalizado — ${p.cliente}`,
    [modelo ?? "modelo por definir", p.talla ? `talla ${p.talla}` : null, tecnica]
      .filter(Boolean)
      .join(" · "),
    ligaDiseno ? `Diseño: ${ligaDiseno}` : "(falta subir el diseño aprobado a la ficha)",
    ligaDiseno ? "La liga del diseño dura 7 días." : null,
    p.fecha_limite ? `Se necesita para el ${formatearFecha(p.fecha_limite)}` : null,
    p.notas ? `Notas: ${p.notas}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

/* Los cinturones personalizados en proceso. Es la hoja «Personalizados FRESA
   FIT» pero sin las columnas que ahí eran de colores: aquí el color lo pone el
   estado y la urgencia la pone la fecha límite. */
export function PanelPersonalizados({
  personalizados,
  equipo,
  enlacesOrden,
  correosCliente,
}: {
  personalizados: Personalizado[];
  equipo: Profile[];
  /* id de la ficha → el detalle de la venta en el panel del canal. Solo traen
     enlace las que salieron de una venta del CRM: el folio de las viejas de la
     hoja no existe en ningún panel. */
  enlacesOrden: Record<string, EnlaceOrden>;
  /* id de la ficha → correo del cliente, cuando lo tenemos (en la práctica,
     Tienda Nube y poco más: ver lib/personalizados/correo-cliente.ts). Lo que
     no está aquí es lo que no se puede avisar. */
  correosCliente: Record<string, string>;
}) {
  const porId = new Map(equipo.map((p) => [p.id, p]));

  /* Arma el mensaje para Eduardo y lo deja en el portapapeles. La liga se firma
     al momento de copiar (7 días desde HOY, no desde que se subió el diseño). */
  async function copiarMensajeEduardo(p: Personalizado) {
    let liga: string | null = null;
    if (p.foto_path) {
      const r = await ligaDisenoParaProveedor(p.foto_path);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      liga = r.url;
    }
    try {
      await navigator.clipboard.writeText(mensajeParaEduardo(p, liga));
      toast.success(
        liga
          ? "Mensaje copiado con la liga del diseño (dura 7 días). Pégalo en el chat de Eduardo."
          : "Mensaje copiado, pero a la ficha le falta el diseño aprobado.",
      );
    } catch {
      toast.error("No se pudo copiar.");
    }
  }
  const { pending, ejecutar } = useAccionServidor();
  /* Propio y no el `ejecutar` de arriba: ese lo comparten los cambios de estado
     de la tabla, y el botón no debe deshabilitarse cuando alguien mueve una
     ficha (ni al revés). */
  const { pending: pendingTraer, ejecutar: ejecutarTraer } = useAccionServidor();
  const { pending: pendingCorreo, ejecutar: ejecutarCorreo } = useAccionServidor();

  /* La confirmación al cliente. Pide confirmar SIEMPRE —sale un correo a una
     persona de fuera y de la bandeja de alguien no se retira nada— y avisa
     cuando ya se le escribió antes, que es el único error caro aquí. */
  function mandarConfirmacion(p: Personalizado) {
    const correo = correosCliente[p.id];
    if (!correo) return;
    const yaFue = Boolean(p.correo_enviado_en);
    ejecutarCorreo(() => enviarConfirmacionPersonalizado(p.id, yaFue), {
      confirmar: yaFue
        ? `A ${p.cliente} ya se le mandó la confirmación${
            p.correo_enviado_en ? ` el ${formatearFecha(p.correo_enviado_en.slice(0, 10))}` : ""
          }.\n\n¿Volver a enviarla a ${correo}?`
        : `Se le va a mandar a ${p.cliente} la confirmación de su pedido, con las instrucciones y la fecha estimada de entrega.\n\nA: ${correo}\n\n¿Enviar?`,
      ok: (r) => `Confirmación enviada a ${r.datos.correo}.`,
      error: "No se pudo enviar el correo. Revisa tu conexión.",
    });
  }
  const [dialogo, setDialogo] = useState<Personalizado | "nuevo" | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("abiertos");
  /* Rango sobre la FECHA DE COMPRA: es la que ordena la lista y la que se ve
     bajo el nº de venta, así que el recorte se explica solo. Arranca vacío —
     todo a la vista—; el preset se guarda aparte para poder rotular el atajo. */
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [preset, setPreset] = useState<PresetRangoId | "">("");
  const presetElegido = useRef<PresetRangoId | "">("");
  const hayRango = Boolean(desde && hasta);

  /* La tira de meses sale de las fichas mismas (por fecha de compra), acotada
     a fechas plausibles: hay un par de fichas viejas con el año mal capturado
     (1900, meses futuros) que pintarían pestañas fantasma. */
  const mesLimite = hoyISO().slice(0, 7);
  const meses = [
    ...new Set(
      personalizados
        .map((p) => p.fecha_compra?.slice(0, 7))
        .filter((ym): ym is string => Boolean(ym && ym >= "2025-01" && ym <= mesLimite)),
    ),
  ].sort();
  /* El mes «activo» se deduce del rango en vez de guardarse aparte: así la
     pastilla y el calendario nunca se contradicen, y mover el rango a mano
     suelta la pastilla sola. */
  const mesActivo =
    meses.find((ym) => {
      const r = rangoDeMes(ym);
      return r.desde === desde && r.hasta === hasta;
    }) ?? null;

  function elegirMes(ym: string | null) {
    const r = ym ? rangoDeMes(ym) : { desde: "", hasta: "" };
    setDesde(r.desde);
    setHasta(r.hasta);
    setPreset("");
    presetElegido.current = "";
    /* Elegir un mes es mirar historia, y la historia vive en «enviado»: con el
       filtro «En proceso» un mes cerrado sale vacío y parece que no hay datos
       (pasó de verdad: se creyó perdido lo que sí estaba). Volver a «Todo»
       regresa al default del día a día. */
    setFiltroEstado(ym ? "todos" : "abiertos");
  }

  /* Las fichas viejas de la hoja no traen fecha de compra: con un rango puesto
     no hay forma de decir si caen dentro, así que se quedan fuera. Se cuentan
     para avisarlo en la barra en vez de que desaparezcan sin explicación. */
  const base = hayRango
    ? personalizados.filter((p) => p.fecha_compra && enRango(p.fecha_compra, { desde, hasta }))
    : personalizados;
  const sinFechaCompra = hayRango ? personalizados.filter((p) => !p.fecha_compra).length : 0;

  /* Las cuatro tarjetas miran el periodo elegido, no el total: con un rango
     puesto, «fuera de fecha» es de esos pedidos y no del módulo entero. */
  const enProceso = base.filter((p) => ABIERTOS.includes(p.estado));
  const hoy = hoyISO();
  /* Vencido = se prometió para una fecha que ya pasó y todavía no sale. */
  const vencidos = enProceso.filter((p) => p.fecha_limite && p.fecha_limite < hoy);
  /* Sin rango la tarjeta es «este mes» (lo de siempre). Con rango, filtrar
     además por el mes en curso daría casi siempre cero: lo que se pidió en
     junio se envió en junio. Ahí cuenta los enviados del periodo. */
  const enviados = hayRango
    ? base.filter((p) => p.estado === "enviado")
    : base.filter(
        (p) => p.estado === "enviado" && (p.updated_at ?? p.created_at).startsWith(hoy.slice(0, 7)),
      );
  const sinDiseno = enProceso.filter((p) => !p.foto_path);

  /* Los cinturones personalizados que ya se vendieron y todavía no tenían
     ficha. La ingesta los trae sola en cada pasada; esto es para no esperarla. */
  function traer() {
    ejecutarTraer(() => traerPedidosDeMaquila(), {
      error: "No se pudo consultar. Revisa tu conexión.",
      ok: (r) =>
        r.datos.creadas > 0
          ? `${r.datos.creadas} pedido(s) traídos. Ya solo falta subirles el diseño.`
          : "Nada nuevo: todos los pedidos vendidos ya tienen su ficha.",
    });
  }

  /* El compilador de React memoiza esto solo: la lista base se deriva en cada
     render y envolverla a mano rompía su optimización. */
  const q = norm(busqueda);
  const visibles = base.filter((p) => {
    if (filtroEstado === "abiertos" && !ABIERTOS.includes(p.estado)) return false;
    if (filtroEstado !== "abiertos" && filtroEstado !== "todos" && p.estado !== filtroEstado)
      return false;
    if (!q) return true;
    return [p.cliente, p.no_venta, p.talla, p.notas]
      .filter(Boolean)
      .some((c) => norm(String(c)).includes(q));
  });

  const columnas: Columna<Personalizado>[] = [
    {
      clave: "cliente",
      label: "Cliente",
      esTitulo: true,
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">
            <Resaltado texto={p.cliente} busca={busqueda} />
          </div>
          <div className="truncate text-[12.5px] text-muted-foreground">
            {[
              MODELOS_PERSONALIZADO.find((m) => m.id === p.modelo)?.nombre,
              p.talla,
              TIPOS_PERSONALIZADO.find((t) => t.id === p.tipo)?.nombre,
            ]
              .filter(Boolean)
              .join(" · ") || "—"}
          </div>
        </div>
      ),
    },
    {
      clave: "responsable",
      label: "Quién",
      celda: (p) => {
        const r = p.responsable_id ? porId.get(p.responsable_id) : null;
        if (!r) return <span className="text-muted-foreground/50">—</span>;
        return (
          <span
            className="flex size-6 items-center justify-center rounded-full text-[10px] font-bold text-white"
            style={{ backgroundColor: r.color }}
            title={r.nombre}
          >
            {iniciales(r.nombre)}
          </span>
        );
      },
    },
    {
      clave: "venta",
      label: "Venta",
      celda: (p) => {
        const canal = obtenerCanal(p.canal ?? "");
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-1 truncate font-mono text-[12.5px]">
              <Resaltado texto={p.no_venta ?? "—"} busca={busqueda} />
              {/* Ligado a una venta del CRM y no solo tecleado: es la diferencia
                  entre un número que alguien copió y uno que existe de verdad. */}
              {p.sale_order_id && (
                <Check
                  className="size-3 shrink-0 text-emerald-600"
                  strokeWidth={2.5}
                  aria-label="Ligado a una venta del CRM"
                />
              )}
            </div>
            {/* La fecha de compra es la que ordena la lista: si no se ve, el
                orden parece arbitrario. */}
            <div className="truncate text-[11.5px] text-muted-foreground">
              {[canal?.nombre, p.fecha_compra ? formatearFecha(p.fecha_compra) : null]
                .filter(Boolean)
                .join(" · ") || "—"}
            </div>
          </div>
        );
      },
    },
    {
      clave: "produccion",
      label: "Producción",
      celda: (p) => (
        <span className="text-muted-foreground">
          {p.fecha_produccion ? formatearFecha(p.fecha_produccion) : "sin mandar"}
        </span>
      ),
    },
    {
      clave: "limite",
      label: "Fecha límite",
      celda: (p) => {
        if (!p.fecha_limite) return <span className="text-muted-foreground">—</span>;
        const tarde = p.fecha_limite < hoy && ABIERTOS.includes(p.estado);
        return (
          <span className={tarde ? "font-semibold text-red-600" : "text-muted-foreground"}>
            {formatearFecha(p.fecha_limite)}
          </span>
        );
      },
    },
    {
      clave: "diseno",
      label: "Diseño",
      celda: (p) => (
        <VerDiseno
          url={p.foto_path ? rutaDiseno(p.foto_path) : null}
          path={p.foto_path}
          cliente={p.cliente}
        />
      ),
    },
    {
      clave: "estado",
      label: "Estado",
      celda: (p) => (
        <Select
          value={p.estado}
          disabled={pending}
          onValueChange={(v) =>
            v &&
            v !== p.estado &&
            ejecutar(() => cambiarEstadoPersonalizado(p.id, v as EstadoPersonalizadoId), {
              ok: `${p.cliente} → ${obtenerEstadoPersonalizado(v)?.nombre ?? v}.`,
            })
          }
        >
          {/* Los colores de la hoja: la celda se tiñe del estado —al 12%, que
              es como se pinta todo el CRM— y el punto lleva el color a fondo
              entero. El nombre se queda en el color del texto a propósito: el
              amarillo de «En diseño» sobre fondo claro no se lee. */}
          <SelectTrigger
            className="h-8 w-[155px]"
            style={
              colorEstado(p.estado)
                ? {
                    backgroundColor: `${colorEstado(p.estado)}1F`,
                    borderColor: `${colorEstado(p.estado)}59`,
                  }
                : undefined
            }
          >
            <SelectValue>
              {(v: string) => (
                <span className="flex items-center gap-1.5">
                  <PuntoEstado estado={v} />
                  {obtenerEstadoPersonalizado(v)?.nombre ?? "Estado"}
                </span>
              )}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ESTADOS_PERSONALIZADO.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                <span className="flex items-center gap-1.5">
                  <PuntoEstado estado={e.id} />
                  {e.nombre}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      clave: "acciones",
      label: "",
      celda: (p) => (
        <div className="flex items-center gap-1.5">
          {enlacesOrden[p.id] && (
            <a
              href={enlacesOrden[p.id].url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-primary"
              title={`Ver la venta en ${obtenerCanal(enlacesOrden[p.id].canal)?.nombre ?? "el canal"}`}
              aria-label={`Ver la venta en ${obtenerCanal(enlacesOrden[p.id].canal)?.nombre ?? "el canal"}`}
            >
              <Store className="size-4" />
            </a>
          )}
          {p.url && (
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-primary"
              aria-label="Abrir enlace"
            >
              <ExternalLink className="size-4" />
            </a>
          )}
          {/* El mensaje para el proveedor, listo para pegarse en WhatsApp: era
              lo que se redactaba a mano en cada pedido. */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              void copiarMensajeEduardo(p);
            }}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Copiar mensaje para Eduardo (specs + liga del diseño)"
            aria-label="Copiar mensaje para Eduardo"
          >
            <Copy className="size-4" />
          </button>
          {/* La confirmación al CLIENTE. Se pinta deshabilitado y no se esconde
              cuando no hay correo: «no se puede» explica algo, un botón ausente
              solo deja la duda de si existe. */}
          <BotonCorreoCliente
            personalizado={p}
            correo={correosCliente[p.id]}
            pendiente={pendingCorreo}
            onEnviar={() => mandarConfirmacion(p)}
          />
          <Button variant="outline" size="sm" onClick={() => setDialogo(p)}>
            Editar
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Personalizados</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Cada cinturón con nombre y apellido: de quién es, de qué venta, quién lo tiene y para
            cuándo se prometió.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
          {/* Mismo selector que Finanzas y Métricas: atajos y rango a mano en un
              solo calendario, sobre la fecha de compra. */}
          <RangoFechas
            desde={desde}
            hasta={hasta}
            preset={preset}
            /* Elegir un atajo dispara onPreset y enseguida onChange, así que
               limpiar el preset ahí lo borraría siempre. El ref (síncrono, ya
               puesto cuando llega el onChange) distingue «vino de un atajo» de
               «lo eligió a mano en el calendario». */
            onPreset={(id) => {
              presetElegido.current = id;
              setPreset(id);
            }}
            onChange={(d, h) => {
              setDesde(d);
              setHasta(h);
              setPreset(presetElegido.current);
              presetElegido.current = "";
            }}
            className="w-full md:w-[220px]"
          />
          <Button
            variant="outline"
            onClick={traer}
            disabled={pendingTraer}
            className="h-auto w-full gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold md:w-auto"
          >
            <Download className="size-4" strokeWidth={2.1} />
            Traer pedidos vendidos
          </Button>
          <ImportarPersonalizados />
          <Button
            onClick={() => setDialogo("nuevo")}
            className="h-auto w-full gap-1.5 rounded-[11px] px-[17px] py-2.5 text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_rgba(232,67,147,0.7)] md:w-auto"
          >
            <Plus className="size-4" strokeWidth={2.1} />
            Nuevo personalizado
          </Button>
        </div>
      </div>

      <FiltroMeses meses={meses} activo={mesActivo} onElegir={elegirMes} />

      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <StatCard etiqueta="En proceso" valor={String(enProceso.length)} icono={Sparkles} />
        <StatCard
          etiqueta="Fuera de fecha"
          valor={String(vencidos.length)}
          icono={AlarmClock}
          nota="pasó la fecha límite"
          valorClassName={vencidos.length > 0 ? "text-red-600" : undefined}
        />
        <StatCard
          etiqueta="Sin diseño cargado"
          valor={String(sinDiseno.length)}
          icono={Palette}
          valorClassName={sinDiseno.length > 0 ? "text-amber-600" : undefined}
        />
        <StatCard
          etiqueta={hayRango ? "Enviados" : "Enviados este mes"}
          valor={String(enviados.length)}
          icono={Truck}
          nota={hayRango ? "del periodo elegido" : undefined}
        />
      </div>

      <BarraHerramientas>
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar por cliente, nº de venta o nota…"
          conteo={{ visibles: visibles.length, total: base.length, unidad: "pedidos" }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filtroEstado} onValueChange={(v) => setFiltroEstado(v ?? "abiertos")}>
            <SelectTrigger className="w-[185px] bg-card">
              <SelectValue>
                {(v: string) =>
                  v === "abiertos"
                    ? "En proceso"
                    : v === "todos"
                      ? "Todos los estados"
                      : (obtenerEstadoPersonalizado(v)?.nombre ?? "Estado")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="abiertos">En proceso</SelectItem>
              <SelectItem value="todos">Todos los estados</SelectItem>
              {ESTADOS_PERSONALIZADO.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  <span className="flex items-center gap-1.5">
                    <PuntoEstado estado={e.id} />
                    {e.nombre}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {hayRango && (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDesde("");
                  setHasta("");
                  setPreset("");
                  presetElegido.current = "";
                }}
                className="h-8 gap-1 text-[13px] text-muted-foreground"
              >
                <X className="size-3.5" />
                Quitar fechas
              </Button>
              {/* Las viejas de la hoja no traen fecha de compra: si no se dice,
                  parece que el filtro se comió pedidos. */}
              {sinFechaCompra > 0 && (
                <span className="text-[12.5px] text-muted-foreground">
                  {sinFechaCompra} sin fecha de compra {sinFechaCompra === 1 ? "queda" : "quedan"}{" "}
                  fuera
                </span>
              )}
            </>
          )}
          <div className="flex-1" />
          {vencidos.length > 0 && <Pastilla nombre={`${vencidos.length} fuera de fecha`} color="#d63031" />}
        </div>
      </BarraHerramientas>

      <TablaSimple
        /* El diseño se lleva la columna más ancha de la tabla a propósito: es lo
           que distingue un pedido de otro. Las fechas y el nº de venta se
           aprietan para pagarla. */
        cols="grid-cols-[minmax(170px,1fr)_48px_140px_105px_105px_360px_170px_180px]"
        columnas={columnas}
        datos={visibles}
        filaKey={(p) => p.id}
        minW="min-w-[1410px]"
        vacio="Sin personalizados. Da de alta el primero o pega el bloque de la hoja."
        onRowClick={setDialogo}
      />

      {dialogo && (
        <PersonalizadoDialog
          personalizado={dialogo === "nuevo" ? null : dialogo}
          equipo={equipo}
          urlDiseno={
            dialogo !== "nuevo" && dialogo.foto_path ? rutaDiseno(dialogo.foto_path) : null
          }
          onClose={() => setDialogo(null)}
        />
      )}
    </div>
  );
}
