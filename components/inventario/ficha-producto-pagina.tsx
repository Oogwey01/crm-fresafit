"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ProductoVista } from "@/components/inventario/producto-vista";
import { ProductoDialog } from "@/components/inventario/producto-dialog";
import type { GrupoReorden } from "@/lib/inventario/reabastecimiento";
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
  esDireccion,
  escrituraCanales,
  sugerido,
}: {
  producto: ProductConProveedor;
  hermanas: ProductConProveedor[];
  grupo: GrupoReorden | null;
  ventanaDias: number;
  proveedores: Supplier[];
  gestor: boolean;
  /* El pedido a proveedor es de dirección: lleva costos de compra. */
  esDireccion: boolean;
  escrituraCanales: boolean;
  /* Cuántas piezas propone el reorden, para prellenar el pedido. */
  sugerido: number;
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
        escrituraCanales={escrituraCanales}
        onVerHermana={(id) => router.push(`/inventario/producto/${id}`)}
        onEditar={() => setEditar(true)}
        onGenerarPedido={
          esDireccion
            ? () =>
                router.push(
                  `/proveedores?producto=${producto.id}&cantidad=${sugerido || 1}`,
                )
            : undefined
        }
        onVolver={() => router.push("/inventario")}
      />

      {editar && (
        <ProductoDialog
          producto={producto}
          proveedores={proveedores}
          gestor={gestor}
          escrituraCanales={escrituraCanales}
          onClose={() => setEditar(false)}
        />
      )}
    </>
  );
}
