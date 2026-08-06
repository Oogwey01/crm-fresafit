/* Tamaños de lote para hablar con PostgREST. Son dos límites distintos:

   - Un `.in(...)` viaja en la URL (los selects son GET). Con el catálogo
     entero —1.100+ UUIDs— la URL pasa de 40 KB y el edge de Supabase contesta
     un 400 pelón antes de llegar a la base. TAM_LOTE_IN cabe siempre.
   - Los upserts viajan en el body, sin ese techo, pero PostgREST arma UNA
     sentencia por petición: un lote gigante la hace lenta y el reintento caro.
     TAM_LOTE_UPSERT es el tamaño que los importadores de ventas llevan años
     usando sin sustos.

   Antes cada módulo llevaba su propio número (150, 200, 300…) para el mismo
   límite; los que se pasaban eran 400s latentes que solo aparecerían al crecer
   el catálogo. El LOTE=40 de lib/storage.ts no es de PostgREST sino de la API
   de Storage (createSignedUrls): ese vive allá a propósito. */

export const TAM_LOTE_IN = 150;
export const TAM_LOTE_UPSERT = 200;
