"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProductoVista } from "@/components/inventario/producto-vista";
import { ProductoDialog } from "@/components/inventario/producto-dialog";
import type { GrupoReorden } from "@/lib/inventario/reabastecimiento";
import type { VistaDinero } from "@/lib/permisos-dinero";
import type { ProductConProveedor, Supplier } from "@/lib/types";

/* Envoltura cliente de /inventario/producto/[id]: la ficha en modo página, con
   la navegación que antes resolvía el panel cuando esto era un pop-up (volver al
   catálogo, saltar a otra talla) y el formulario de edición, que sí sigue siendo
   un diálogo porque es un formulario, no una pantalla. */
export function FichaProductoPagina({
  producto,
  hermanas,
  grupo,
  ventanaDias,
  proveedores,
  gestor,
  dinero,
  escrituraCanales,
  dominioTiendaNube,
}: {
  producto: ProductConProveedor;
  hermanas: ProductConProveedor[];
  grupo: GrupoReorden | null;
  ventanaDias: number;
  proveedores: Supplier[];
  gestor: boolean;
  /* Qué puede ver de dinero quien mira: precio (ingreso) y costo (egreso). */
  dinero: VistaDinero;
  escrituraCanales: boolean;
  /* Subdominio del admin de Tienda Nube, para el enlace «Ver en Tienda Nube». */
  dominioTiendaNube: string | null;
}) {
  const router = useRouter();
  const [editar, setEditar] = useState(false);

  return (
    <>
      <ProductoVista
        producto={producto}
        hermanas={hermanas}
        grupo={grupo}
        ventanaDias={ventanaDias}
        dinero={dinero}
        escrituraCanales={escrituraCanales}
        onVerHermana={(id) => router.push(`/inventario/producto/${id}`)}
        onEditar={() => setEditar(true)}
        onVolver={() => router.push("/inventario")}
        dominioTiendaNube={dominioTiendaNube}
      />

      {editar && (
        <ProductoDialog
          producto={producto}
          proveedores={proveedores}
          gestor={gestor}
          dinero={dinero}
          escrituraCanales={escrituraCanales}
          onClose={() => setEditar(false)}
        />
      )}
    </>
  );
}
