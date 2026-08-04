"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Building2,
  ClipboardCheck,
  DollarSign,
  LogOut,
  Package,
  Receipt,
  Store,
  TrendingUp,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { LogoFresafit } from "@/components/logo-fresafit";
import { AvisosPush } from "@/components/tareas/avisos-push";
import { Notificaciones } from "@/components/tareas/notificaciones";
import { TemaToggle } from "@/components/tema-toggle";
import { SelectorEspacio } from "@/components/selector-espacio";
import { ESPACIOS, MODULOS, ROLES, espacioDeRuta, type EspacioId } from "@/lib/catalogos";
import type { Profile, Notificacion } from "@/lib/types";
import { cn, iniciales } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const ICONOS: Record<string, LucideIcon> = {
  tareas: ClipboardCheck,
  inventario: Package,
  metricas: BarChart3,
  canales: Store,
  finanzas: DollarSign,
  clientes: Users,
  pedidos: Truck,
  nomina: Users,
  reportes: TrendingUp,
  "agencia-empresas": Building2,
  "agencia-cobros": Receipt,
  "agencia-nomina": Users,
  "agencia-reportes": TrendingUp,
};

/* Envoltura de escritorio: el aside fijo lateral (oculto en móvil, donde la
   navegación vive en el Sheet de components/mobile-nav.tsx). */
export function Sidebar(props: {
  profile: Profile | null;
  email: string;
  tareasActivas: number;
  notificaciones: Notificacion[];
}) {
  return (
    /* sticky + h-screen: el menú se queda pegado a la ventana en vez de crecer
       con la página. Sin esto, en una pantalla con mucho contenido (inventario,
       métricas) había que bajar hasta el final para llegar al pie —usuario,
       tema, cerrar sesión—, que es justo lo que uno quiere tener siempre a mano. */
    <aside className="sticky top-0 hidden h-screen w-[272px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
      <SidebarContent {...props} />
    </aside>
  );
}

/* Contenido del menú (marca + módulos + pie). Compartido 1:1 entre el aside de
   escritorio y el Sheet móvil. `onNavigate` cierra el Sheet al tocar un módulo. */
export function SidebarContent({
  profile,
  email,
  tareasActivas,
  notificaciones,
  onNavigate,
}: {
  profile: Profile | null;
  email: string;
  tareasActivas: number;
  notificaciones: Notificacion[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const rolNombre =
    ROLES.find((r) => r.id === profile?.rol)?.nombre ?? "Miembro";
  const nombre = profile?.nombre || email;

  /* Finanzas y toda la Agencia solo existen para Dirección: ni siquiera aparecen
     en el menú del resto (la BD lo refuerza con RLS; esto es para no tentar ni
     confundir). */
  const visible = (m: (typeof MODULOS)[number]) =>
    !("soloDireccion" in m && m.soloDireccion) || profile?.rol === "direccion";

  /* El menú muestra un solo negocio a la vez, el de la ruta en la que estás.
     Fresafit y Agencia comparten equipo pero no comparten nada más: verlos
     juntos era una lista de diez entradas sin relación entre sí. */
  const espacio = espacioDeRuta(pathname);
  const delEspacio = MODULOS.filter((m) => visible(m) && m.espacio === espacio);
  const activos = delEspacio.filter((m) => m.activo);
  const proximos = delEspacio.filter((m) => !m.activo);

  /* A dónde lleva cada pestaña del selector: el primer módulo que esa persona
     puede ver de ese negocio. Si no puede ver ninguno, el espacio no se ofrece. */
  const destinos = Object.fromEntries(
    ESPACIOS.map((e) => [
      e.id,
      MODULOS.find((m) => m.activo && visible(m) && m.espacio === e.id)?.href,
    ]).filter(([, href]) => href),
  ) as Partial<Record<EspacioId, string>>;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4.5 pb-4">
      {/* Marca */}
      <div className="mb-5 flex flex-col items-start gap-1.5 px-1.5 pb-1">
        <LogoFresafit priority className="h-7 w-auto" />
        <div className="text-[11.5px] text-muted-foreground">Sistema interno</div>
      </div>

      {/* Menú de módulos. El scroll vive AQUÍ, no en el menú entero: así el pie
          (usuario, tema, cerrar sesión) queda clavado abajo y siempre visible,
          aunque algún día la lista de módulos no quepa. */}
      <nav className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        <SelectorEspacio actual={espacio} destinos={destinos} onNavigate={onNavigate} />
        <div className="px-2.5 pb-2 text-[10.5px] font-semibold tracking-wide text-muted-foreground/80 uppercase">
          {espacio === "agencia" ? "Agencia Fresafit" : "Operación"}
        </div>
        {activos.map((m) => {
          const activo = pathname === m.href || pathname.startsWith(m.href + "/");
          const Icono = ICONOS[m.id] ?? ClipboardCheck;
          return (
            <Link
              key={m.id}
              href={m.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 rounded-[11px] px-3 py-2.5 text-[14.5px] transition-colors",
                activo
                  ? "bg-accent font-semibold text-accent-foreground"
                  : "font-medium text-foreground/80 hover:bg-muted hover:text-foreground",
              )}
            >
              <Icono className="size-[18px]" strokeWidth={1.9} />
              <span className="flex-1">{m.nombre}</span>
              {m.id === "tareas" && tareasActivas > 0 && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
                  {tareasActivas}
                </span>
              )}
            </Link>
          );
        })}

        <div className="px-2.5 pt-4.5 pb-2 text-[10.5px] font-semibold tracking-wide text-muted-foreground/80 uppercase">
          Próximamente
        </div>
        {proximos.map((m) => {
          const Icono = ICONOS[m.id] ?? Package;
          return (
            <div
              key={m.id}
              className="flex cursor-default items-center gap-3 rounded-[11px] px-3 py-2.5 text-[14.5px] font-medium text-muted-foreground/60"
              title="Próximamente"
            >
              <Icono className="size-[18px]" strokeWidth={1.7} />
              <span className="flex-1">{m.nombre}</span>
              <Badge variant="secondary" className="text-[10px]">
                Pronto
              </Badge>
            </div>
          );
        })}
      </nav>

      {/* Pie: usuario + salir */}
      <div className="mt-auto border-t border-sidebar-border pt-3.5">
        <div className="mb-3 flex items-center gap-2.5 px-1.5 py-1.5">
          <span
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white"
            style={{ backgroundColor: profile?.color ?? "#e84393" }}
          >
            {iniciales(nombre)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[13.5px] font-semibold text-foreground">
              {nombre}
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {rolNombre}
            </div>
          </div>
          <Notificaciones notificaciones={notificaciones} />
        </div>
        <AvisosPush />
        <div className="mt-2">
          <TemaToggle />
        </div>
        <form action="/auth/signout" method="post">
          <Button type="submit" variant="outline" size="sm" className="w-full gap-2">
            <LogOut className="size-[15px]" strokeWidth={1.8} />
            Cerrar sesión
          </Button>
        </form>
      </div>
    </div>
  );
}
