"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import logoFresafit from "@/public/logo-fresafit-blanco.png";
import { MODULOS, ROLES } from "@/lib/catalogos";
import type { Profile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function Sidebar({
  profile,
  email,
}: {
  profile: Profile | null;
  email: string;
}) {
  const pathname = usePathname();
  const rolNombre =
    ROLES.find((r) => r.id === profile?.rol)?.nombre ?? "Miembro";

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-sidebar p-4 max-md:w-full max-md:border-b max-md:border-r-0">
      {/* Marca */}
      <div className="mb-6">
        <div className="flex items-center justify-center rounded-xl bg-primary px-4 py-3">
          <Image
            src={logoFresafit}
            alt="Fresafit"
            priority
            className="h-6 w-auto"
          />
        </div>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Sistema interno
        </p>
      </div>

      {/* Menú de módulos */}
      <nav className="flex flex-1 flex-col gap-1">
        {MODULOS.map((m) => {
          const activo = pathname === m.href || pathname.startsWith(m.href + "/");

          if (!m.activo) {
            return (
              <div
                key={m.id}
                className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted-foreground/60"
                title="Se construirá en la Fase 2"
              >
                <span className="w-5 text-center">{m.icono}</span>
                <span className="flex-1">{m.nombre}</span>
                <Badge variant="secondary" className="text-[10px]">
                  Pronto
                </Badge>
              </div>
            );
          }

          return (
            <Link
              key={m.id}
              href={m.href}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                activo
                  ? "bg-primary font-semibold text-primary-foreground"
                  : "text-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              )}
            >
              <span className="w-5 text-center">{m.icono}</span>
              <span className="flex-1">{m.nombre}</span>
            </Link>
          );
        })}
      </nav>

      {/* Pie: usuario + salir */}
      <div className="mt-4 border-t pt-4">
        <div className="mb-2 flex items-center gap-2 px-1">
          <span
            className="inline-block size-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: profile?.color ?? "#e84393" }}
          />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {profile?.nombre || email}
            </div>
            <div className="truncate text-xs text-muted-foreground">
              {rolNombre}
            </div>
          </div>
        </div>
        <form action="/auth/signout" method="post">
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="w-full"
          >
            Cerrar sesión
          </Button>
        </form>
      </div>
    </aside>
  );
}
