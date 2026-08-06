import { Suspense } from "react";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";
import { esDireccion } from "@/lib/catalogos";
import { TabsCanales } from "@/components/canales/tabs-canales";
import { DialogoPermisosDinero } from "@/components/canales/dialogo-permisos-dinero";
import type { DineroPermisoCanal, Profile } from "@/lib/types";

/* Quién ve el dinero de cada plataforma lo reparte dirección, y desde aquí
   porque es donde ya está mirando el canal (mismo criterio que puso el
   permiso de insumos dentro de Bodega). Para el resto del equipo ni se piden
   las dos consultas: la RLS las devolvería vacías igual.

   En su propio <Suspense>: solo alimentan un diálogo que casi nunca se abre,
   y esperándolas en el layout frenaban el primer pintado de TODA la página
   del canal. El botón aterriza cuando esté. */
async function BotonPermisosDinero() {
  const { supabase } = await usuarioActual();
  const [permisosRes, equipoRes] = await Promise.all([
    supabase.from("dinero_permisos_canal").select("profile_id, canal, otorgado_por, created_at"),
    supabase.from("profiles").select("id, nombre, rol, area, color").order("nombre"),
  ]);
  return (
    <DialogoPermisosDinero
      equipo={(equipoRes.data ?? []) as Profile[]}
      permisos={(permisosRes.data ?? []) as DineroPermisoCanal[]}
    />
  );
}

/* Armazón del módulo Canales. El encabezado y las pestañas viven en el layout
   para que al cambiar de plataforma solo se vuelva a pintar el contenido: las
   páginas de aquí hacen llamadas en vivo a APIs ajenas y no conviene repetir
   ese trabajo por navegar entre pestañas. */
export default async function CanalesLayout({ children }: { children: React.ReactNode }) {
  /* La puerta del módulo va en el layout y no en cada plataforma: son cuatro
     páginas (la portada que redirige y las tres plataformas) y así ninguna se
     queda abierta si mañana se agrega una cuarta. */
  await exigirModulo("canales");

  /* Cacheado por request: comparte getUser() y perfil con el shell. */
  const { rol } = await usuarioActual();
  const puedeRepartir = esDireccion(rol);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-[-0.4px]">Canales</h1>
          <p className="mt-0.5 text-[13.5px] text-muted-foreground">
            Cómo nos está tratando cada plataforma: su termómetro, sus plazos y lo que nos
            exige. Lo que se vendió está en Métricas.
          </p>
        </div>
        {puedeRepartir && (
          <Suspense fallback={null}>
            <BotonPermisosDinero />
          </Suspense>
        )}
      </header>
      <TabsCanales />
      {children}
    </div>
  );
}
