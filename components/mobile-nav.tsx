"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { LogoFresafit } from "@/components/logo-fresafit";
import { Notificaciones } from "@/components/tareas/notificaciones";
import type { Profile, Notificacion } from "@/lib/types";
import { SidebarContent } from "@/components/sidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/* Barra superior de navegación en móvil (oculta en escritorio, donde manda el
   aside). Hamburguesa → Sheet lateral con el mismo menú del sidebar. */
export function MobileNav(props: {
  profile: Profile | null;
  email: string;
  tareasActivas: number;
  notificaciones: Notificacion[];
}) {
  /* El panel se cierra al navegar vía el onNavigate que recibe SidebarContent
     (cada Link del menú lo invoca); no hace falta vigilar el pathname. */
  const [open, setOpen] = useState(false);

  return (
    /* `no-imprimir`: la vista de impresión de reportes la usa para dejar fuera
       del papel el andamiaje de la app. */
    <header className="no-imprimir sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar px-3 md:hidden">
      <Sheet open={open} onOpenChange={(o) => setOpen(o)}>
        <SheetTrigger
          aria-label="Abrir menú"
          className="flex size-11 items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-muted"
        >
          <Menu className="size-6" strokeWidth={1.9} aria-hidden="true" />
        </SheetTrigger>
        <SheetContent>
          <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
          <SidebarContent {...props} onNavigate={() => setOpen(false)} />
        </SheetContent>
      </Sheet>

      <LogoFresafit priority className="h-5 w-auto" />

      <div className="ml-auto">
        <Notificaciones notificaciones={props.notificaciones} />
      </div>
    </header>
  );
}
