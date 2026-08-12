"use client";

import { useState } from "react";
import { AlarmClock, Check, Copy, ExternalLink, Palette, Plus, Sparkles, Truck } from "lucide-react";
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
import { Resaltado } from "@/components/compartido/resaltado";
import { StatCard } from "@/components/compartido/stat-card";
import { Pastilla } from "@/components/compartido/pastilla";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { PersonalizadoDialog } from "@/components/personalizados/personalizado-dialog";
import { ImportarPersonalizados } from "@/components/personalizados/importar-personalizados";
import { VerDiseno } from "@/components/personalizados/ver-diseno";
import {
  cambiarEstadoPersonalizado,
  ligaDisenoParaProveedor,
} from "@/app/(app)/personalizados/actions";
import {
  ESTADOS_PERSONALIZADO,
  ESTADOS_PERSONALIZADO_ABIERTOS,
  MODELOS_PERSONALIZADO,
  TIPOS_PERSONALIZADO,
  obtenerCanal,
  obtenerEstadoPersonalizado,
} from "@/lib/catalogos";
import { formatearFecha, hoyISO } from "@/lib/fecha";
import { norm } from "@/lib/importar/tsv";
import { iniciales } from "@/lib/utils";
import type { EstadoPersonalizadoId, Personalizado, Profile } from "@/lib/types";

const ABIERTOS: readonly string[] = ESTADOS_PERSONALIZADO_ABIERTOS;

/* La miniatura ya no llega firmada desde el servidor (firmar ~160 era lo que
   tenía a la página en 18 segundos): cada <img> apunta a esta ruta, que valida
   la sesión y redirige al enlace firmado. Lazy por defecto de next/image, así
   que solo viajan las que entran en pantalla. */
const rutaDiseno = (path: string) => `/api/personalizados/diseno?path=${encodeURIComponent(path)}`;

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
}: {
  personalizados: Personalizado[];
  equipo: Profile[];
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
  const [dialogo, setDialogo] = useState<Personalizado | "nuevo" | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState("abiertos");

  const enProceso = personalizados.filter((p) => ABIERTOS.includes(p.estado));
  const hoy = hoyISO();
  /* Vencido = se prometió para una fecha que ya pasó y todavía no sale. */
  const vencidos = enProceso.filter((p) => p.fecha_limite && p.fecha_limite < hoy);
  const enviadosEsteMes = personalizados.filter(
    (p) => p.estado === "enviado" && (p.updated_at ?? p.created_at).startsWith(hoy.slice(0, 7)),
  );
  const sinDiseno = enProceso.filter((p) => !p.foto_path);

  /* El compilador de React memoiza esto solo: la lista base se deriva en cada
     render y envolverla a mano rompía su optimización. */
  const q = norm(busqueda);
  const visibles = personalizados.filter((p) => {
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
            {canal && <div className="text-[11.5px] text-muted-foreground">{canal.nombre}</div>}
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
          <SelectTrigger className="h-8 w-[155px]">
            <SelectValue>
              {(v: string) => obtenerEstadoPersonalizado(v)?.nombre ?? "Estado"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ESTADOS_PERSONALIZADO.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nombre}
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
        <StatCard etiqueta="Enviados este mes" valor={String(enviadosEsteMes.length)} icono={Truck} />
      </div>

      <BarraHerramientas>
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar por cliente, nº de venta o nota…"
          conteo={{ visibles: visibles.length, total: personalizados.length, unidad: "pedidos" }}
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
                  {e.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          {vencidos.length > 0 && <Pastilla nombre={`${vencidos.length} fuera de fecha`} color="#d63031" />}
        </div>
      </BarraHerramientas>

      <TablaSimple
        /* El diseño se lleva la columna más ancha de la tabla a propósito: es lo
           que distingue un pedido de otro. Las fechas y el nº de venta se
           aprietan para pagarla. */
        cols="grid-cols-[minmax(170px,1fr)_48px_140px_105px_105px_360px_170px_150px]"
        columnas={columnas}
        datos={visibles}
        filaKey={(p) => p.id}
        minW="min-w-[1380px]"
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
