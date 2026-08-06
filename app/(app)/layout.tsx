import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { Sidebar } from "@/components/layout/sidebar";
import { MobileNav } from "@/components/layout/mobile-nav";
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

  /* El `?sesion=expirada` no es cosmético: le avisa al proxy que esta guardia
     —que sí pregunta por red— no vio sesión, para que no rebote de vuelta al
     tablero creyendo válido un JWT que solo lo parece por la firma. Sin esa
     señal, las dos guardias se rebotaban entre sí hasta el ERR_TOO_MANY_REDIRECTS. */
  if (!user) redirect("/login?sesion=expirada");

  /* Un contador por negocio: el menú muestra un espacio a la vez, y una sola
     cifra global marcaba «12 tareas» en Fresafit contando las de la agencia. */
  const contarPendientes = (espacio: string) =>
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("espacio", espacio)
      .neq("estado", "hecho")
      .is("deleted_at", null);

  const [{ count: pendientesFresafit }, { count: pendientesAgencia }, notisRes] = await Promise.all([
    contarPendientes("fresafit"),
    contarPendientes("agencia"),
    // Notificaciones del usuario (RLS ya limita a las suyas): las recientes,
    // con las columnas del tipo y no `*` — esto viaja en CADA navegación.
    supabase
      .from("notifications")
      .select("id, user_id, task_id, tipo, texto, leida, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const notificaciones = (notisRes.data ?? []) as Notificacion[];

  const navProps = {
    profile: perfil,
    email: user.email ?? "",
    tareasActivas: {
      fresafit: pendientesFresafit ?? 0,
      agencia: pendientesAgencia ?? 0,
    },
    notificaciones,
  };

  return (
    /* min-h-dvh y no min-h-screen: en el celular, `screen` mide la ventana sin
       descontar la barra de direcciones, así que el shell quedaba más alto que
       lo visible y el scroll pegaba un salto cada vez que esa barra aparecía. */
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Móvil: header con hamburguesa. Escritorio: aside lateral. */}
      <MobileNav {...navProps} />
      <Sidebar {...navProps} />
      {/* min-w-0: sin esto, en un contenedor flex el main no puede encoger por
          debajo de su contenido y fuerza scroll horizontal de toda la página.
          El scroll horizontal vive ahora en los componentes que sí lo requieren
          (tablas anchas, calendario, kanban), no en el shell. */}
      {/* pb con el inset: en la PWA instalada la barra de gestos de Android/iOS
          se comía la última fila de cada pantalla. El max() conserva el padding
          normal donde no hay inset (escritorio y teléfonos con botones). */}
      <main className="min-w-0 flex-1 bg-lienzo p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] md:p-7 md:pb-[max(1.75rem,env(safe-area-inset-bottom))]">
        {children}
      </main>
    </div>
  );
}
