"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Repeat, UserPlus, Users } from "lucide-react";
import { ventasDeCliente } from "@/app/(app)/clientes/actions";
import { useDetalleRemoto } from "@/components/compartido/use-detalle-remoto";
import { esGestor, obtenerCanal } from "@/lib/catalogos";
import { formatearFecha } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type { VistaDinero } from "@/lib/permisos-dinero";
import type { CustomerConStats, RolId, SaleConProducto } from "@/lib/types";
import { Button } from "@/components/ui/button";
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
import { TabsSeccion } from "@/components/compartido/tabs-seccion";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { ClienteDialog } from "@/components/clientes/cliente-dialog";
import { ClienteDetalle } from "@/components/clientes/cliente-detalle";
import { cn } from "@/lib/utils";

type Orden = "total" | "compras" | "reciente" | "nombre";

const ORDENES: [Orden, string][] = [
  ["total", "Más gastan"],
  ["compras", "Más compran"],
  ["reciente", "Más recientes"],
  ["nombre", "Nombre"],
];

/* Dos rejillas literales: Tailwind lee las clases del fuente y una armada por
   concatenación no llegaría a la hoja de estilos. */
const COLS = "grid-cols-[minmax(180px,1fr)_140px_130px_90px_120px_110px]";
const COLS_SIN_TOTAL = "grid-cols-[minmax(180px,1fr)_140px_130px_90px_110px]";

/* Las dos mitades del módulo: quién nos compra y quién nos trae compradores.
   La segunda solo existe para gestores. */
type Vista = "clientes" | "influencers";

const VISTAS = [
  ["clientes", "Clientes"],
  ["influencers", "Influencers"],
] as const;

export function PanelClientes({
  clientes,
  rol,
  dinero,
  programa,
}: {
  clientes: CustomerConStats[];
  rol: RolId;
  /* Cuánto ha gastado cada quien es ingreso: sin permiso, ni la columna ni la
     tarjeta ni el orden «Más gastan». */
  dinero: VistaDinero;
  /* El programa de influencers, ya renderizado en el servidor dentro de un
     <Suspense>: son cuatro tablas más que solo se miran al cambiar de pestaña, y
     esperarlas retrasaba la lista de clientes, que es a lo que se entra.
     null = quien entró no es gestor y ni siquiera se pidieron. */
  programa: React.ReactNode | null;
}) {
  const gestor = esGestor(rol);
  const verDinero = dinero.ingresos;
  /* «Más gastan» no se puede ordenar sin los importes, así que ni se ofrece. */
  const ordenes = verDinero ? ORDENES : ORDENES.filter(([id]) => id !== "total");
  const [vista, setVista] = useState<Vista>("clientes");
  const [busqueda, setBusqueda] = useState("");
  /* Sin importes el orden por defecto es por número de compras: «Más gastan» no
     se puede calcular y tampoco se ofrece. */
  const [orden, setOrden] = useState<Orden>(verDinero ? "total" : "compras");
  const [editar, setEditar] = useState<CustomerConStats | "nuevo" | null>(null);
  const [detalle, setDetalle] = useState<CustomerConStats | null>(null);

  const recurrentes = clientes.filter((c) => c.recurrente).length;
  const conCompras = clientes.filter((c) => c.compras > 0).length;
  const nuevos = conCompras - recurrentes;
  const totalVendido = verDinero
    ? clientes.reduce((a, c) => a + (c.total ?? 0), 0)
    : null;

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const filtrados = q
      ? clientes.filter(
          (c) =>
            c.nombre.toLowerCase().includes(q) ||
            (c.correo ?? "").toLowerCase().includes(q) ||
            (c.telefono ?? "").toLowerCase().includes(q),
        )
      : clientes;
    const copia = [...filtrados];
    copia.sort((a, b) => {
      if (orden === "total") return (b.total ?? 0) - (a.total ?? 0);
      if (orden === "compras") return b.compras - a.compras;
      if (orden === "reciente") return (b.ultimaCompra ?? "").localeCompare(a.ultimaCompra ?? "");
      return a.nombre.localeCompare(b.nombre, "es");
    });
    return copia;
  }, [clientes, busqueda, orden]);

  /* Historial del cliente abierto, cargado al abrir su ficha (antes venía
     serializado completo — todas las ventas de todos — desde el servidor). */
  const { datos: historial, cargando: cargandoHistorial } = useDetalleRemoto<SaleConProducto[]>(
    async () => {
      if (!detalle) return [];
      const r = await ventasDeCliente(detalle.id);
      if ("error" in r) {
        toast.error(r.error);
        return [];
      }
      return r.ventas;
    },
    detalle?.id ?? "",
  );

  const columnas: Columna<CustomerConStats>[] = [
    {
      clave: "cliente",
      label: "Cliente",
      esTitulo: true,
      celda: (c) => (
        <button
          type="button"
          onClick={() => setDetalle(c)}
          className="flex items-center gap-2 truncate text-left font-medium hover:underline"
          title={c.notas ?? c.nombre}
        >
          <span className="truncate">
            <Resaltado texto={c.nombre} busca={busqueda} />
          </span>
          {c.recurrente && (
            <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-bold text-primary">
              Recurrente
            </span>
          )}
        </button>
      ),
    },
    {
      clave: "contacto",
      label: "Contacto",
      celda: (c) => (
        <div className="truncate text-muted-foreground" title={c.correo ?? c.telefono ?? ""}>
          <Resaltado texto={c.correo ?? c.telefono ?? "—"} busca={busqueda} />
        </div>
      ),
    },
    {
      clave: "canal",
      label: "Canal",
      celda: (c) => {
        const canal = obtenerCanal(c.canal ?? "");
        return canal ? (
          <Pastilla nombre={canal.nombre} color={canal.color} />
        ) : (
          <span className="text-muted-foreground/50">—</span>
        );
      },
    },
    { clave: "compras", label: "Compras", celda: (c) => <div className="tabular-nums">{c.compras}</div> },
    /* La columna se va entera —no en blanco—: vacía se leería como un cliente
       que no ha gastado nada, y el dato tampoco llegó del servidor. */
    ...(verDinero
      ? ([
          {
            clave: "total",
            label: "Total gastado",
            celda: (c) => <div className="font-semibold tabular-nums">{formatearMXN(c.total)}</div>,
          },
        ] satisfies Columna<CustomerConStats>[])
      : []),
    {
      clave: "ultima",
      label: "Última compra",
      celda: (c) => (
        <div className="text-muted-foreground">
          {c.ultimaCompra ? formatearFecha(c.ultimaCompra) : "—"}
        </div>
      ),
    },
  ];

  return (
    <div>
      {/* Encabezado */}
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.5px]">Clientes y ventas</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            {vista === "clientes"
              ? "Quién compra, por dónde y cuánto. Los de Tienda Nube entran solos con cada pedido."
              : "Quién nos representa, qué se le manda y cuánto vende su código."}
          </p>
        </div>
        {vista === "clientes" && (
          <Button
            onClick={() => setEditar("nuevo")}
            className="h-10 w-full rounded-xl text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_var(--primary)] md:w-auto"
          >
            <Plus className="size-4" strokeWidth={2.1} />
            Nuevo cliente
          </Button>
        )}
      </div>

      {/* Solo hay dos mitades si esta persona puede ver el programa. */}
      {programa && (
        <TabsSeccion opciones={VISTAS} valor={vista} onCambio={setVista} className="mb-4" />
      )}

      {programa && vista === "influencers" ? (
        programa
      ) : (
        <>
      {/* KPIs */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <StatCard etiqueta="Clientes" valor={String(clientes.length)} icono={Users} />
        <StatCard etiqueta="Recurrentes" valor={String(recurrentes)} icono={Repeat} />
        <StatCard etiqueta="Compraron una vez" valor={String(Math.max(0, nuevos))} icono={UserPlus} />
        {totalVendido !== null && (
          <StatCard etiqueta="Total vendido" valor={formatearMXN(totalVendido)} />
        )}
      </div>

      {/* Buscar es lo que se viene a hacer a esta pantalla —el cliente que
          llamó, el correo de una venta—, así que el campo va solo en su renglón
          y la barra se queda pegada al bajar por la lista. El orden, debajo. */}
      <BarraHerramientas>
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar por nombre, correo o teléfono…"
          conteo={{ visibles: visibles.length, total: clientes.length, unidad: "clientes" }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="hidden flex-1 md:block" />
          {/* Móvil: Select. Escritorio: segmentado. */}
          <Select value={orden} onValueChange={(v) => v && setOrden(v as Orden)}>
            <SelectTrigger className="w-full bg-card md:hidden">
              <SelectValue>
                {(v: string) => {
                  const label = ordenes.find(([id]) => id === v)?.[1] ?? "Ordenar";
                  return `Orden: ${label}`;
                }}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {ordenes.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="hidden rounded-xl bg-muted p-[3px] md:inline-flex">
            {ordenes.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setOrden(id)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors",
                  orden === id
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

      {visibles.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          {clientes.length === 0
            ? "Aún no hay clientes. Los de Tienda Nube aparecerán al importar ventas; los de mostrador se dan de alta con «Nuevo cliente»."
            : "Ningún cliente coincide con la búsqueda."}
        </p>
      ) : (
        <TablaSimple
          cols={verDinero ? COLS : COLS_SIN_TOTAL}
          columnas={columnas}
          datos={visibles}
          filaKey={(c) => c.id}
          minW="min-w-[880px]"
          onRowClick={setDetalle}
        />
      )}
        </>
      )}

      {editar && (
        <ClienteDialog
          cliente={editar === "nuevo" ? null : editar}
          gestor={gestor}
          onClose={() => setEditar(null)}
        />
      )}

      {detalle && (
        <ClienteDetalle
          cliente={detalle}
          historial={historial ?? []}
          cargandoHistorial={cargandoHistorial}
          onEditar={() => {
            const c = detalle;
            setDetalle(null);
            setEditar(c);
          }}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
}
