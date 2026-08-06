import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { veAgencia } from "@/lib/catalogos";

/* Puerta del espacio Agencia.

   Quién entra es un permiso POR PERSONA (`profiles.ve_agencia`), no un rol: la
   llevan cuatro, y entre ellos hay dos direcciones pero no las dos que existen.
   El menú ya no ofrece ni el selector ni los módulos a quien no entra, pero
   esconder un botón no cierra una puerta: sin esto, cualquiera con el enlace
   —un aviso reenviado, una pestaña vieja— seguiría entrando.

   Se manda a /tareas y no a un "no tienes acceso": para quien no lleva la
   Agencia, ese espacio sencillamente no existe, y una pantalla de rechazo solo
   informa de que hay algo detrás. */
export default async function AgenciaLayout({ children }: { children: React.ReactNode }) {
  const { user, perfil } = await usuarioActual();
  if (!user) redirect("/login");
  if (!veAgencia(perfil)) redirect("/tareas");
  return <>{children}</>;
}
