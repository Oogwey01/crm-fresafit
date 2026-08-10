"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Pastilla } from "@/components/compartido/pastilla";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { guardarDisenoMaquila, subirArchivoDiseno } from "@/app/(app)/maquila/actions";
import { ACABADOS_MAQUILA, obtenerAcabadoMaquila } from "@/lib/catalogos";
import type { AcabadoMaquilaId, DisenoMaquila } from "@/lib/types";

const SIN_VALOR = "sin_valor";

/* La biblioteca de artes listos para producir. Es lo que abre la puerta a
   sacar colecciones enteras sobre venta: «mañana sale Batman, ya tenemos los
   diseños definidos — descárgalo, mándalo a imprimir y lo envías», sin
   fabricar una sola pieza por adelantado.

   Un diseño sin archivo no le sirve a nadie: la tabla lo señala en rojo. */
export function BibliotecaDisenos({ disenos }: { disenos: DisenoMaquila[] }) {
  const [editando, setEditando] = useState<DisenoMaquila | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const columnas: Columna<DisenoMaquila>[] = [
    {
      clave: "nombre",
      label: "Diseño",
      esTitulo: true,
      celda: (d) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{d.nombre}</div>
          <div className="truncate text-[12px] text-muted-foreground">
            {d.coleccion ?? "sin colección"}
          </div>
        </div>
      ),
    },
    {
      clave: "acabado",
      label: "Acabado",
      celda: (d) => {
        const a = obtenerAcabadoMaquila(d.acabado);
        return a ? (
          <Pastilla nombre={a.nombre} color={a.color} />
        ) : (
          <span className="text-muted-foreground/50">cualquiera</span>
        );
      },
    },
    {
      clave: "archivo",
      label: "Arte",
      celda: (d) =>
        d.archivo_path ? (
          <span className="truncate text-[12px] text-muted-foreground">{d.archivo_nombre}</span>
        ) : (
          <Pastilla nombre="FALTA EL ARCHIVO" color="#d63031" />
        ),
    },
    {
      clave: "activo",
      label: "Estado",
      celda: (d) =>
        d.activo ? (
          <Pastilla nombre="Disponible" color="#22c55e" />
        ) : (
          <Pastilla nombre="Apagado" color="#64748b" />
        ),
    },
  ];

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13.5px] text-muted-foreground">
          Artes listos para producir sobre venta. Cuando cae un pedido con uno de estos diseños, se
          liga desde el detalle del pedido y Eduardo lo descarga él solo.
        </p>
        <Button variant="outline" className="gap-1.5" onClick={() => setNuevo(true)}>
          <Plus className="size-4" />
          Diseño
        </Button>
      </div>

      <TablaSimple
        cols="grid-cols-[minmax(200px,1.4fr)_160px_minmax(160px,1fr)_140px]"
        columnas={columnas}
        datos={disenos}
        filaKey={(d) => d.id}
        minW="min-w-[760px]"
        vacio="La biblioteca está vacía. Aquí van los diseños de colección listos para imprimir."
        onRowClick={setEditando}
      />

      {(nuevo || editando) && (
        <DisenoDialog
          diseno={editando}
          onClose={() => {
            setNuevo(false);
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

function DisenoDialog({
  diseno,
  onClose,
}: {
  diseno: DisenoMaquila | null;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const archivoRef = useRef<HTMLInputElement>(null);
  const [nombre, setNombre] = useState(diseno?.nombre ?? "");
  const [coleccion, setColeccion] = useState(diseno?.coleccion ?? "");
  const [acabado, setAcabado] = useState<AcabadoMaquilaId | null>(diseno?.acabado ?? null);
  const [notas, setNotas] = useState(diseno?.notas ?? "");
  const [activo, setActivo] = useState(diseno?.activo ?? true);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>{diseno ? "Editar diseño" : "Nuevo diseño"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="dis-nombre">Nombre</Label>
            <Input
              id="dis-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Batman"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="dis-coleccion">Colección</Label>
              <Input
                id="dis-coleccion"
                value={coleccion}
                onChange={(e) => setColeccion(e.target.value)}
                placeholder="Septiembre 2026"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Acabado</Label>
              <Select
                value={acabado ?? SIN_VALOR}
                onValueChange={(v) =>
                  setAcabado(v === SIN_VALOR ? null : (v as AcabadoMaquilaId))
                }
              >
                <SelectTrigger>
                  <SelectValue>
                    {(v: string) => obtenerAcabadoMaquila(v)?.nombre ?? "Cualquiera"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_VALOR}>Cualquiera</SelectItem>
                  {ACABADOS_MAQUILA.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="dis-archivo">Arte para imprenta</Label>
            <Input id="dis-archivo" ref={archivoRef} type="file" className="cursor-pointer" />
            {diseno?.archivo_nombre && (
              <p className="text-[12px] text-muted-foreground">
                Ahora tiene <strong>{diseno.archivo_nombre}</strong>; si subes otro, lo reemplaza.
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="dis-notas">Notas para producción</Label>
            <Textarea
              id="dis-notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2 text-[13.5px]">
            <input
              type="checkbox"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
              className="size-4"
            />
            Disponible para producir (Eduardo lo ve)
          </label>
        </div>
        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={diseno ? "Guardar cambios" : "Crear diseño"}
          onCancelar={onClose}
          onGuardar={() =>
            ejecutar(
              () =>
                guardarDisenoMaquila(
                  { nombre, coleccion, acabado, notas, activo },
                  diseno?.id,
                ),
              {
                error: "No se pudo guardar. Revisa tu conexión.",
                /* El arte se sube DESPUÉS de tener id: la ruta del bucket
                   cuelga de él, igual que en personalizados. */
                alExito: async (r) => {
                  const file = archivoRef.current?.files?.[0];
                  if (file) {
                    const fd = new FormData();
                    fd.append("file", file);
                    const sub = await subirArchivoDiseno(r.datos.id, fd);
                    if ("error" in sub) {
                      toast.error(`Se guardó el diseño, pero el arte no: ${sub.error}`);
                      onClose();
                      return;
                    }
                  }
                  toast.success(diseno ? "Diseño actualizado." : "Diseño agregado a la biblioteca.");
                  onClose();
                },
              },
            )
          }
        />
      </DialogContent>
    </Dialog>
  );
}
