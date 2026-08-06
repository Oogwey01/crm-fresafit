"use client";

import { Building2, Check, Info, ShieldCheck, Store, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  AREAS,
  MODULOS,
  MODULO_PORTADA,
  ROLES,
  esDireccion,
  obtenerRol,
  modulosDelRol,
  obtenerArea,
  puedeAdministrar,
  veAgencia,
} from "@/lib/catalogos";
import {
  cambiarArea,
  cambiarRol,
  cambiarAccesoAgencia,
  cambiarAccesoModulo,
} from "@/app/(app)/equipo/actions";
import type { AreaId, ProfileConCorreo, RolId } from "@/lib/types";
import { cn, iniciales } from "@/lib/utils";

const SIN_AREA = "sin-area";

/* ============================================================================
   Equipo — quién es quién y qué alcanza cada quien
   ----------------------------------------------------------------------------
   Hasta ahora los accesos se repartían corriendo SQL a mano y no había ninguna
   pantalla que contestara «¿qué ve esta persona?». Aquí se ve por persona, y se
   cambia en un clic: rol, área y si entra a la Agencia.

   Lo que dice cada tarjeta NO está escrito a mano: la lista de módulos sale de
   `modulosVisibles`, el mismo filtro con el que se pinta el menú. Una lista de
   permisos redactada aparte envejece y acaba mintiendo justo cuando más
   importa.
   ============================================================================ */
export function PanelEquipo({
  equipo,
  currentUserId,
}: {
  equipo: ProfileConCorreo[];
  currentUserId: string;
}) {
  const { pending, ejecutar } = useAccionServidor();

  return (
    <div>
      <h1 className="text-[26px] font-bold tracking-tight">Equipo</h1>
      <p className="mt-1.5 text-[14.5px] text-muted-foreground">
        Quién es quién y qué alcanza cada quien — y desde aquí se cambia.
      </p>

      <div className="mt-4 flex items-start gap-2.5 rounded-xl border bg-card px-4 py-3 text-[13px] text-muted-foreground">
        <Info className="mt-px size-[17px] shrink-0" strokeWidth={1.8} aria-hidden="true" />
        <span className="leading-relaxed">
          Los cambios se aplican de inmediato y sin guardar. El{" "}
          <b className="font-semibold text-foreground">rol marca el techo</b> —qué podría ver alguien— y
          los interruptores de cada sección solo <b className="font-semibold text-foreground">restan</b>:
          por eso solo aparecen las secciones que su rol ya alcanza. Para subirle el techo, cámbiale el
          rol. Y el acceso de verdad lo impone la base de datos, no esta pantalla: aquí se decide, allá
          se cumple.{" "}
          <b className="font-semibold text-foreground">Tu propio rol no se puede cambiar desde aquí</b> —
          si pudieras quitarte Dirección, nadie podría devolvértela.
        </span>
      </div>

      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {equipo.map((p) => {
          const soyYo = p.id === currentUserId;
          /* El TECHO de su rol, no lo que ve hoy: los interruptores tienen que
             seguir ahí —tachados— cuando se le quita una sección, o no habría
             forma de devolvérsela. */
          const delRol = modulosDelRol(p);
          const deFresafit = delRol.filter((m) => m.espacio === "fresafit");
          const deAgencia = delRol.filter((m) => m.espacio === "agencia");

          return (
            <article key={p.id} className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm">
              {/* Persona */}
              <div className="flex items-center gap-3">
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-full text-[15px] font-semibold text-white"
                  style={{ backgroundColor: p.color }}
                  aria-hidden="true"
                >
                  {iniciales(p.nombre)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-semibold">{p.nombre}</span>
                    {soyYo && (
                      <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
                        Tú
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[12.5px] text-muted-foreground">
                    {p.email ?? "sin correo registrado"}
                  </div>
                </div>
              </div>

              {/* Rol y área */}
              <div className="grid gap-2.5 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Rol
                  </span>
                  <Select
                    value={p.rol}
                    disabled={pending || soyYo}
                    onValueChange={(v) =>
                      v &&
                      v !== p.rol &&
                      ejecutar(() => cambiarRol(p.id, v as RolId), {
                        ok: `${p.nombre} ahora es ${obtenerRol(v)?.nombre}.`,
                      })
                    }
                  >
                    <SelectTrigger className="w-full bg-background">
                      <SelectValue>
                        {(v: string) => obtenerRol(v)?.nombre ?? "Rol"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </label>

                <label className="flex flex-col gap-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Área
                  </span>
                  <Select
                    value={p.area ?? SIN_AREA}
                    disabled={pending}
                    onValueChange={(v) =>
                      v &&
                      v !== (p.area ?? SIN_AREA) &&
                      ejecutar(
                        () => cambiarArea(p.id, v === SIN_AREA ? null : (v as AreaId)),
                        { ok: "Área actualizada." },
                      )
                    }
                  >
                    <SelectTrigger className="w-full bg-background">
                      <SelectValue>
                        {(v: string) =>
                          v === SIN_AREA ? "Sin área" : (obtenerArea(v)?.nombre ?? "Área")
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {AREAS.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.nombre}
                        </SelectItem>
                      ))}
                      <SelectItem value={SIN_AREA}>Sin área</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              {/* Qué puede hacer, en palabras del catálogo de roles. */}
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-[12.5px] leading-relaxed text-muted-foreground">
                {obtenerRol(p.rol)?.desc}
              </p>

              {/* Acceso a la Agencia: permiso por persona, no por rol. */}
              <button
                type="button"
                disabled={pending}
                aria-pressed={veAgencia(p)}
                onClick={() =>
                  ejecutar(() => cambiarAccesoAgencia(p.id, !veAgencia(p)), {
                    ok: veAgencia(p)
                      ? `${p.nombre} ya no entra a la Agencia.`
                      : `${p.nombre} ya entra a la Agencia.`,
                  })
                }
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors disabled:opacity-50",
                  veAgencia(p)
                    ? "border-primary bg-primary/10"
                    : "bg-background hover:bg-accent/40",
                )}
              >
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-md border",
                    veAgencia(p) ? "border-primary bg-primary text-primary-foreground" : "bg-background",
                  )}
                  aria-hidden="true"
                >
                  {veAgencia(p) && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold">Entra a la Agencia</span>
                  <span className="block text-[11.5px] text-muted-foreground">
                    {veAgencia(p)
                      ? "Ve el selector de negocio y el espacio Agencia."
                      : "Solo ve Fresafit; el selector de negocio ni aparece."}
                  </span>
                </span>
                <Building2
                  className={cn("size-4 shrink-0", veAgencia(p) ? "text-primary" : "text-muted-foreground/50")}
                  strokeWidth={1.9}
                  aria-hidden="true"
                />
              </button>

              {/* Las secciones, una por una. Solo salen las que su ROL le
                  permitiría: marcar aquí no puede dar lo que la base niega, así
                  que ofrecer Finanzas para un miembro sería prometer una
                  pantalla que le saldría vacía. El techo se sube con el rol. */}
              <div className="flex flex-col gap-2.5">
                <SeccionesEspacio
                  icono={<Store className="size-3.5" strokeWidth={1.9} aria-hidden="true" />}
                  titulo="Secciones de Fresafit"
                  modulos={deFresafit}
                  persona={p}
                  pending={pending}
                  onCambiar={(m, ver) =>
                    ejecutar(() => cambiarAccesoModulo(p.id, m.id, ver), {
                      ok: ver
                        ? `${p.nombre} ya ve ${m.nombre}.`
                        : `${p.nombre} ya no ve ${m.nombre}.`,
                    })
                  }
                />
                {veAgencia(p) && (
                  <SeccionesEspacio
                    icono={<Building2 className="size-3.5" strokeWidth={1.9} aria-hidden="true" />}
                    titulo="Secciones de la Agencia"
                    modulos={deAgencia}
                    persona={p}
                    pending={pending}
                    onCambiar={(m, ver) =>
                      ejecutar(() => cambiarAccesoModulo(p.id, m.id, ver), {
                        ok: ver
                          ? `${p.nombre} ya ve ${m.nombre} de la Agencia.`
                          : `${p.nombre} ya no ve ${m.nombre} de la Agencia.`,
                      })
                    }
                  />
                )}
                {(puedeAdministrar(p.rol) || esDireccion(p.rol)) && (
                  <p className="flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
                    <ShieldCheck className="mt-px size-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                    <span>
                      {esDireccion(p.rol)
                        ? "Ve el dinero completo (lo que entra y lo que sale) y puede repartir estos accesos."
                        : "Ve y captura lo que SALE —gastos, nómina, cobros— pero no los ingresos ni el cierre."}
                    </span>
                  </p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* Las secciones de un negocio, como chips que se prenden y apagan.

   Cada chip es la sección tal como aparece en el menú: encendido = la ve. Solo
   se listan las que su ROL ya le permitiría, porque esto solo resta. Y la
   portada (Tareas de Fresafit) sale encendida y sin apagador: es a donde va a
   parar quien entra a lo que no le toca. */
function SeccionesEspacio({
  icono,
  titulo,
  modulos,
  persona,
  pending,
  onCambiar,
}: {
  icono: React.ReactNode;
  titulo: string;
  modulos: (typeof MODULOS)[number][];
  persona: ProfileConCorreo;
  pending: boolean;
  onCambiar: (m: (typeof MODULOS)[number], ver: boolean) => void;
}) {
  const ocultos = persona.modulos_ocultos ?? [];

  if (modulos.length === 0) {
    return (
      <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className="inline-flex items-center gap-1 font-semibold text-muted-foreground">
          {icono}
          {titulo}:
        </span>
        <span className="italic text-muted-foreground/70">su rol no alcanza ninguna</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground">
        {icono}
        {titulo}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {modulos.map((m) => {
          const ve = !ocultos.includes(m.id);
          const fija = m.id === MODULO_PORTADA;
          return (
            <button
              key={m.id}
              type="button"
              disabled={pending || fija}
              aria-pressed={ve}
              title={
                fija
                  ? "La portada del CRM: no se puede cerrar"
                  : ve
                    ? `Quitarle ${m.nombre}`
                    : `Devolverle ${m.nombre}`
              }
              onClick={() => onCambiar(m, !ve)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold transition-colors",
                ve
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-dashed bg-background text-muted-foreground/70 line-through",
                fija ? "cursor-default opacity-90" : "disabled:opacity-50",
              )}
            >
              {ve ? (
                <Check className="size-3 shrink-0 text-primary" strokeWidth={3} aria-hidden="true" />
              ) : (
                <X className="size-3 shrink-0" strokeWidth={2.6} aria-hidden="true" />
              )}
              {m.nombre}
            </button>
          );
        })}
      </div>
    </div>
  );
}
