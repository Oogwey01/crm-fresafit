import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import type { Notificacion } from "@/lib/types";

/* Shell de la app protegida: sidebar + área principal.
   Doble guardia (además del middleware): sin sesión → login.
   usuarioActual() está cacheado por request: la page que se renderiza junto a
   este layout reutiliza el mismo getUser() y el mismo perfil. */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { supabase, user, perfil } = await usuarioActual();

  if (!user) redirect("/login");

  const [{ count: tareasActivas }, notisRes] = await Promise.all([
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .neq("estado", "hecho")
      .is("deleted_at", null),
    // Notificaciones del usuario (RLS ya limita a las suyas): las recientes.
    supabase
      .from("notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const notificaciones = (notisRes.data ?? []) as Notificacion[];

  const navProps = {
    profile: perfil,
    email: user.email ?? "",
    tareasActivas: tareasActivas ?? 0,
    notificaciones,
  };

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      {/* Móvil: header con hamburguesa. Escritorio: aside lateral. */}
      <MobileNav {...navProps} />
      <Sidebar {...navProps} />
      {/* min-w-0: sin esto, en un contenedor flex el main no puede encoger por
          debajo de su contenido y fuerza scroll horizontal de toda la página.
          El scroll horizontal vive ahora en los componentes que sí lo requieren
          (tablas anchas, calendario, kanban), no en el shell. */}
      <main className="min-w-0 flex-1 bg-[#f4f4f6] p-4 sm:p-6 md:p-7">{children}</main>
    </div>
  );
}
