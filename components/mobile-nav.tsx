"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import logoFresafit from "@/public/logo-fresafit-blanco.png";
import type { Profile } from "@/lib/types";
import { SidebarContent } from "@/components/sidebar";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

/* Barra superior de navegación en móvil (oculta en escritorio, donde manda el
   aside). Hamburguesa → Sheet lateral con el mismo menú del sidebar. */
export function MobileNav(props: {
  profile: Profile | null;
  email: string;
  tareasActivas: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Cerrar el panel al navegar a otra ruta.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-sidebar-border bg-sidebar px-3 md:hidden">
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

      <div className="flex items-center gap-2.5">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-[11px] bg-primary shadow-[0_6px_16px_-6px_rgba(232,67,147,0.55)]">
          <Image src={logoFresafit} alt="Fresafit" priority className="h-4 w-auto" />
        </div>
        <span className="font-heading text-base font-bold tracking-tight">FRESA FIT</span>
      </div>
    </header>
  );
}
