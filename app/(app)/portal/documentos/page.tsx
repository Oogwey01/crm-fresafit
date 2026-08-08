import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";
import { documentosDeEmpresa } from "@/lib/documentos/consulta";
import { ListaDocumentos } from "@/components/documentos/lista-documentos";
import type { AgenciaEmpresa } from "@/lib/types";

export const metadata = { title: "Documentos · Tu espacio con Fresafit" };

/* El archivo de documentos, del lado del cliente.

   Misma consulta que la pestaña del equipo y mismo componente: lo que cambia es
   lo que la RLS devuelve (solo lo compartido de su empresa) y que aquí no se
   editan fichas ajenas — `puedeGestionar` en false. */
export default async function PortalDocumentosPage() {
  await exigirModulo("portal-documentos");
  const { supabase, perfil } = await usuarioActual();

  const empresaId = perfil?.empresa_id ?? "";

  const [documentos, empresaRes] = await Promise.all([
    documentosDeEmpresa(supabase, empresaId),
    supabase.from("agencia_empresas").select("id, nombre, color").eq("id", empresaId).maybeSingle(),
  ]);

  const empresa = (empresaRes.data ?? null) as Pick<
    AgenciaEmpresa,
    "id" | "nombre" | "color"
  > | null;

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-[19px] font-bold">Documentos</h1>
        <p className="text-[13.5px] text-muted-foreground">
          Todo lo que nos hemos intercambiado, en un solo lugar y sin buscar en WhatsApp.
        </p>
      </header>

      <ListaDocumentos
        documentos={documentos}
        empresaId={empresaId}
        empresaNombre={empresa?.nombre ?? "tu empresa"}
        puedeGestionar={false}
      />
    </div>
  );
}
