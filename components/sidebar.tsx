"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardCheck,
  Package,
  BarChart3,
  DollarSign,
  Users,
  Truck,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import logoFresafit from "@/public/logo-fresafit-blanco.png";
import { MODULOS, ROLES } from "@/lib/catalogos";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const ICONOS: Record<string, LucideIcon> = {
  tareas: ClipboardCheck,
  inventario: Package,
  metricas: BarChart3,
  finanzas: DollarSign,
  clientes: Users,
  pedidos: Truck,
};

function iniciales(nombre: string): string {
  const p = nombre.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

/* Envoltura de escritorio: el aside fijo lateral (oculto en móvil, donde la
   navegación vive en el Sheet de components/mobile-nav.tsx). */
export function Sidebar(props: {
  profile: Profile | null;
  email: string;
  tareasActivas: number;
}) {
  return (
    <aside className="hidden w-[272px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
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
  onNavigate,
}: {
  profile: Profile | null;
  email: string;
  tareasActivas: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const rolNombre =
    ROLES.find((r) => r.id === profile?.rol)?.nombre ?? "Miembro";
  const nombre = profile?.nombre || email;

  /* Finanzas solo existe para Dirección: ni siquiera aparece en el menú del
     resto (la BD lo refuerza con RLS; esto es para no tentar ni confundir). */
  const visible = (m: (typeof MODULOS)[number]) =>
    !("soloDireccion" in m && m.soloDireccion) || profile?.rol === "direccion";
  const activos = MODULOS.filter((m) => m.activo && visible(m));
  const proximos = MODULOS.filter((m) => !m.activo && visible(m));

  return (
    <div className="flex min-h-0 flex-1 flex-col p-4.5 pb-4">
      {/* Marca */}
      <div className="mb-5 flex items-center gap-3 px-1.5 pb-1">
        <div className="flex size-[42px] shrink-0 items-center justify-center rounded-[13px] bg-primary shadow-[0_6px_16px_-6px_rgba(232,67,147,0.55)]">
          <Image src={logoFresafit} alt="Fresafit" priority className="h-5 w-auto" />
        </div>
        <div className="leading-tight">
          <div className="font-heading text-lg font-bold tracking-tight text-foreground">
            FRESA FIT
          </div>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">
            Sistema interno
          </div>
        </div>
      </div>

      {/* Menú de módulos */}
      <nav className="flex flex-1 flex-col gap-0.5">
        <div className="px-2.5 pt-1.5 pb-2 text-[10.5px] font-semibold tracking-wide text-muted-foreground/80 uppercase">
          Operación
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
          <div className="min-w-0 leading-tight">
            <div className="truncate text-[13.5px] font-semibold text-foreground">
              {nombre}
            </div>
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
              {rolNombre}
            </div>
          </div>
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
