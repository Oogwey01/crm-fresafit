"use client";

import { useState, type CSSProperties } from "react";
import { ExternalLink, KeyRound, Lock, Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { BarraHerramientas } from "@/components/compartido/barra-herramientas";
import { CampoBusqueda } from "@/components/compartido/campo-busqueda";
import { Resaltado } from "@/components/compartido/resaltado";
import { Pastilla } from "@/components/compartido/pastilla";
import { ImportarInsumos } from "@/components/bodega/importar-insumos";
import { DialogoInsumo } from "@/components/bodega/dialogo-insumo";
import { DialogoMovimiento } from "@/components/bodega/dialogo-movimiento-insumo";
import { DialogoPermisos } from "@/components/bodega/dialogo-permisos-insumos";
import { CATEGORIAS_INSUMO, obtenerCategoriaInsumo } from "@/lib/catalogos";
import { coincide, terminosBusqueda } from "@/lib/busqueda";
import { formatearFechaHora } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type {
  InsumoConPresentaciones,
  InsumoMovimiento,
  InsumoPermiso,
  Profile,
} from "@/lib/types";

/* Lo que cuesta cada pieza según cómo se compre: es la columna PRECIO P/UNIDAD
   de la hoja, pero calculada, no capturada. Se enseña la presentación más
   barata, que es la decisión que la hoja quiere ayudar a tomar. */
export function precioUnitario(insumo: InsumoConPresentaciones): number | null {
  const precios = insumo.presentaciones
    .filter((p) => p.precio != null && p.unidades > 0)
    .map((p) => (p.precio as number) / p.unidades);
  return precios.length ? Math.min(...precios) : null;
}

/* Los insumos que se consumen en bodega, con lo que la hoja «Recursos FRESA
   FIT» sabe de ellos: de quién se compran, en qué medida y a cómo. La regla que
   pidió René sigue igual: todo el equipo VE cuánto hay (Germán tiene que poder
   mirar), pero solo quien tenga permiso mueve el stock. El botón deshabilitado
   es cortesía; el candado real está en la función mover_insumo() de la base. */
export function SeccionInsumos({
  insumos,
  movimientos,
  permisos,
  equipo,
  puedeMover,
  admin,
}: {
  insumos: InsumoConPresentaciones[];
  movimientos: InsumoMovimiento[];
  permisos: InsumoPermiso[];
  equipo: Profile[];
  puedeMover: boolean;
  admin: boolean;
}) {
  const [dialogo, setDialogo] = useState<InsumoConPresentaciones | "nuevo" | null>(null);
  const [moviendo, setMoviendo] = useState<InsumoConPresentaciones | null>(null);
  const [dialogoPermisos, setDialogoPermisos] = useState(false);
  const [filtro, setFiltro] = useState("todas");
  const [busqueda, setBusqueda] = useState("");

  const nombreDe = (id: string | null) => equipo.find((p) => p.id === id)?.nombre ?? "—";

  /* La sección y la búsqueda se acumulan. Se busca también por proveedor, medida
     y presentación porque así es como se pide un insumo en voz alta («las bolsas
     de Castipack», «la de 20 x 28»). El compilador de React memoiza esto solo. */
  const terminos = terminosBusqueda(busqueda);
  const visibles = insumos
    .filter(
      (i) =>
        (filtro === "todas" || (i.categoria ?? "otro") === filtro) &&
        coincide(
          terminos,
          i.nombre,
          i.empresa,
          i.dimensiones,
          i.unidad,
          i.clave,
          i.notas,
          obtenerCategoriaInsumo(i.categoria)?.nombre,
          ...i.presentaciones.map((p) => p.descripcion),
        ),
    )
    /* Agrupados por sección y, dentro, por nombre: con la fila teñida, el orden
       alfabético global dejaba los colores salpicados. Así se leen como los
       bloques de la hoja. El orden de las secciones es el del catálogo, que es
       el de la hoja; lo que no tiene sección cae al final. */
    .sort((a, b) => {
      const orden = (i: InsumoConPresentaciones) => {
        const n = CATEGORIAS_INSUMO.findIndex((c) => c.id === i.categoria);
        return n === -1 ? CATEGORIAS_INSUMO.length : n;
      };
      return orden(a) - orden(b) || a.nombre.localeCompare(b.nombre);
    });
  const bajos = insumos.filter((i) => i.activo && i.stock <= i.minimo).length;

  /* Los bloques de colores de la hoja, traídos a la fila: el tinte de la sección
     de fondo y su color a plena saturación en la barra de la izquierda. Se lee
     de un vistazo qué es cada renglón sin ir columna por columna, que es como se
     usa la hoja en el piso. Los insumos sin sección se quedan en blanco. */
  const tinteSeccion = (i: InsumoConPresentaciones): CSSProperties | undefined => {
    const cat = obtenerCategoriaInsumo(i.categoria);
    if (!cat) return undefined;
    return {
      backgroundColor: `${cat.color}2E`,
      /* inset, no border: un borde correría el contenido de la fila 4px y
         desalinearía las columnas contra el encabezado. La segunda sombra
         repone la de la tarjeta, que el estilo en línea pisaría. */
      boxShadow: `inset 4px 0 0 0 ${cat.color}, 0 1px 3px 0 rgb(0 0 0 / 0.08)`,
    };
  };

  const columnas: Columna<InsumoConPresentaciones>[] = [
    {
      clave: "nombre",
      label: "Insumo",
      esTitulo: true,
      celda: (i) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">
            <Resaltado texto={i.nombre} busca={busqueda} />
          </div>
          <div className="truncate text-[12.5px] text-muted-foreground">
            <Resaltado
              texto={[i.empresa, i.dimensiones].filter(Boolean).join(" · ") || "—"}
              busca={busqueda}
            />
          </div>
        </div>
      ),
    },
    {
      clave: "categoria",
      label: "Sección",
      celda: (i) => {
        const cat = obtenerCategoriaInsumo(i.categoria);
        /* Sin pastilla: el color ya lo lleva la fila entera, como los bloques de
           la hoja. Queda el punto —que ata el tinte a un nombre, para quien no
           distinga los morados entre sí— y el nombre en texto normal: en color
           pleno sobre su propio tinte se leería peor, sobre todo el ámbar. */
        return cat ? (
          <span className="flex min-w-0 items-center gap-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: cat.color }}
            />
            <span className="truncate font-medium">{cat.nombre}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      clave: "stock",
      label: "Hay",
      celda: (i) => (
        <div className="min-w-0">
          <div
            className={
              i.stock <= i.minimo ? "font-semibold tabular-nums text-red-600" : "tabular-nums"
            }
          >
            {i.stock} {i.unidad}
          </div>
          {(i.reserva > 0 || i.pedido > 0) && (
            <div className="text-[11.5px] text-muted-foreground">
              {i.reserva > 0 && `${i.reserva} apartado`}
              {i.reserva > 0 && i.pedido > 0 && " · "}
              {i.pedido > 0 && `${i.pedido} en camino`}
            </div>
          )}
        </div>
      ),
    },
    {
      clave: "rango",
      label: "Mín · máx",
      celda: (i) => (
        <span className="tabular-nums text-muted-foreground">
          {i.minimo}
          {i.maximo != null ? ` · ${i.maximo}` : ""}
        </span>
      ),
    },
    /* Lo que cuesta comprar cada unidad es egreso. Para el resto del equipo la
       columna se va entera y en su lugar queda cuántas presentaciones hay, que
       es el dato de bodega: en blanco se leería como un insumo sin precio, y el
       importe tampoco llegó del servidor. */
    {
      clave: "precio",
      label: admin ? "Por unidad" : "Presentaciones",
      celda: (i) => {
        const precio = admin ? precioUnitario(i) : null;
        const cuantas = `${i.presentaciones.length} ${
          i.presentaciones.length === 1 ? "presentación" : "presentaciones"
        }`;
        if (precio == null) return <span className="text-muted-foreground">{cuantas}</span>;
        return (
          <div className="min-w-0">
            <div className="tabular-nums">{formatearMXN(precio)}</div>
            <div className="text-[11.5px] text-muted-foreground">{cuantas}</div>
          </div>
        );
      },
    },
    {
      clave: "estado",
      label: "",
      celda: (i) =>
        !i.activo ? (
          <Pastilla nombre="Inactivo" color="#94a3b8" />
        ) : i.stock <= i.minimo ? (
          <Pastilla nombre="Por acabarse" color="#d63031" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      clave: "acciones",
      label: "",
      celda: (i) => (
        <div className="flex items-center gap-1.5">
          {i.link && (
            <a
              href={i.link}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-primary"
              aria-label="Dónde se compra"
            >
              <ExternalLink className="size-4" />
            </a>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!puedeMover}
            title={puedeMover ? undefined : "No tienes permiso para mover insumos"}
            onClick={() => setMoviendo(i)}
          >
            {puedeMover ? "Mover" : <Lock className="size-3.5" />}
          </Button>
          {admin && (
            <Button variant="ghost" size="sm" onClick={() => setDialogo(i)}>
              Editar
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <BarraHerramientas className="mb-0">
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar insumo, proveedor o medida…"
          conteo={{ visibles: visibles.length, total: insumos.length, unidad: "insumos" }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Select value={filtro} onValueChange={(v) => setFiltro(v ?? "todas")}>
            <SelectTrigger className="w-[210px] bg-card">
              <SelectValue>
                {(v: string) =>
                  v === "todas"
                    ? "Todas las secciones"
                    : (obtenerCategoriaInsumo(v)?.nombre ?? "Sección")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las secciones</SelectItem>
              {/* El punto de color hace de leyenda: es dónde se aprende qué
                  sección es cada tinte de la tabla. */}
              {CATEGORIAS_INSUMO.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: c.color }}
                    />
                    {c.nombre}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[13.5px] text-muted-foreground">
            {puedeMover
              ? "Puedes registrar entradas y salidas."
              : "Puedes consultar el inventario; para descontar necesitas permiso de dirección."}
          </p>
          {bajos > 0 && <Pastilla nombre={`${bajos} por acabarse`} color="#d63031" />}
          <div className="flex-1" />
          {admin && (
            <>
              <ImportarInsumos />
              <Button variant="outline" onClick={() => setDialogoPermisos(true)}>
                <KeyRound className="size-4" /> Quién descuenta
              </Button>
              <Button onClick={() => setDialogo("nuevo")}>
                <Plus className="size-4" /> Nuevo insumo
              </Button>
            </>
          )}
        </div>
      </BarraHerramientas>

      <TablaSimple
        cols="grid-cols-[minmax(200px,2fr)_180px_130px_100px_130px_130px_170px]"
        columnas={columnas}
        datos={visibles}
        filaKey={(i) => i.id}
        filaStyle={tinteSeccion}
        minW="min-w-[1080px]"
        vacio={
          busqueda.trim()
            ? `Ningún insumo coincide con «${busqueda.trim()}»${filtro !== "todas" ? " en esta sección" : ""}.`
            : admin
              ? "Sin insumos en esta sección. Da de alta lo que se consume en bodega o pega el bloque de la hoja de recursos."
              : "Sin insumos dados de alta todavía."
        }
      />

      {movimientos.length > 0 && (
        <div className="rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Últimos movimientos
          </div>
          <div className="divide-y">
            {movimientos.slice(0, 20).map((m) => {
              const insumo = insumos.find((i) => i.id === m.insumo_id);
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-2 px-5 py-2 text-sm">
                  <span className="w-[130px] shrink-0 text-[12.5px] text-muted-foreground">
                    {formatearFechaHora(m.created_at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <b>{insumo?.nombre ?? "—"}</b>
                    {m.motivo && <span className="text-muted-foreground"> · {m.motivo}</span>}
                  </span>
                  <span
                    className={
                      m.tipo === "salida"
                        ? "tabular-nums font-semibold text-red-600"
                        : "tabular-nums font-semibold text-green-600"
                    }
                  >
                    {m.tipo === "salida" ? "−" : m.tipo === "entrada" ? "+" : "="}
                    {m.cantidad}
                  </span>
                  <span className="w-[110px] shrink-0 text-right text-[12.5px] text-muted-foreground">
                    quedan {m.stock_resultante ?? "—"}
                  </span>
                  <span className="w-[150px] shrink-0 truncate text-right text-[12.5px] text-muted-foreground">
                    {nombreDe(m.created_by)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {dialogo && (
        <DialogoInsumo
          insumo={dialogo === "nuevo" ? null : dialogo}
          onClose={() => setDialogo(null)}
        />
      )}
      {moviendo && <DialogoMovimiento insumo={moviendo} onClose={() => setMoviendo(null)} />}
      {dialogoPermisos && (
        <DialogoPermisos
          equipo={equipo}
          permisos={permisos}
          onClose={() => setDialogoPermisos(false)}
        />
      )}
    </div>
  );
}
