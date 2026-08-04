import { TabsCanales } from "@/components/canales/tabs-canales";

/* Armazón del módulo Canales. El encabezado y las pestañas viven en el layout
   para que al cambiar de plataforma solo se vuelva a pintar el contenido: las
   páginas de aquí hacen llamadas en vivo a APIs ajenas y no conviene repetir
   ese trabajo por navegar entre pestañas. */
export default function CanalesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[22px] font-bold tracking-[-0.4px]">Canales</h1>
        <p className="mt-0.5 text-[13.5px] text-muted-foreground">
          Cómo nos está tratando cada plataforma: su termómetro, sus plazos y lo que nos
          exige. Lo que se vendió está en Métricas.
        </p>
      </header>
      <TabsCanales />
      {children}
    </div>
  );
}
