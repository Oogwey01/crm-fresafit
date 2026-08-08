import { redirect } from "next/navigation";
import { after } from "next/server";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { createAdminClient } from "@/lib/supabase/admin";
import { registrarVisita } from "@/lib/actividad";
import { destinoSeguro, esExterno } from "@/lib/catalogos";

/* Puerta del portal de la empresa cliente.

   El corte por rol ya lo hace `exigirModulo` en cada página (la regla vive en
   `puedeVerModulo`: el espacio `portal` es del rol `externo` y de nadie más).
   Este layout está por lo que esa regla NO puede saber:

     * que la persona tenga empresa. Un externo sin `empresa_id` no debería
       existir —la BD lo prohíbe con `profiles_externo_empresa_check`—, pero si
       algún día existe, la RLS le devolvería listas vacías en todas las
       pantallas y parecería un CRM roto en vez de un alta a medias.
     * dejar constancia de que entró. La spec pide registrar los inicios de
       sesión, y un login no escribe en ninguna tabla: ningún trigger puede
       verlo. Se anota aquí, una vez por jornada (ver registrarVisita).

   La cabecera con el nombre del cliente la pinta cada página, no este layout:
   el shell de (app) ya trae el menú y no queremos dos barras. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const { user, perfil } = await usuarioActual();
  if (!user) redirect("/login?sesion=expirada");

  /* Un interno que llega aquí (por un enlace, por curiosidad) se va a su propio
     destino. No es una pantalla de «no tienes acceso»: el portal enseña los
     datos ya recortados por la RLS, así que a un interno le enseñaría su CRM a
     medias, que es peor que no enseñárselo. */
  if (!esExterno(perfil?.rol) || !perfil?.empresa_id) redirect(destinoSeguro(perfil));

  /* En `after` para que no retrase la pantalla: la constancia se escribe
     mientras la persona ya está leyendo sus tareas. Con la llave de servicio
     porque `actividad_empresas` solo la puede LEER dirección, y sin poder leer
     no se puede saber si ya hay una visita de hoy (se anotaría una por
     navegación). Escribir sí podría con su sesión; leer, no. */
  after(async () => {
    try {
      await registrarVisita(createAdminClient(), {
        empresaId: perfil.empresa_id ?? null,
        actorId: user.id,
        actorNombre: perfil.nombre,
      });
    } catch (e) {
      console.warn("[portal] no se pudo registrar la visita:", e instanceof Error ? e.message : e);
    }
  });

  return <>{children}</>;
}
