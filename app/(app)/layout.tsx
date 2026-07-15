import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";
import type { Profile } from "@/lib/types";

/* Shell de la app protegida: sidebar + área principal.
   Doble guardia (además del middleware): sin sesión → login. */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: profile }, { count: tareasActivas }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, nombre, rol, area, color")
      .eq("id", user.id)
      .single(),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .neq("estado", "hecho"),
  ]);

  const navProps = {
    profile: profile as Profile | null,
    email: user.email ?? "",
    tareasActivas: tareasActivas ?? 0,
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
