/* La frase que hay que teclear para vaciar el módulo de tareas. Vive aquí y no
   en la server action porque un archivo "use server" solo puede exportar
   funciones async, y la pantalla y la acción tienen que leer LA MISMA frase. */
export const FRASE_PURGA = "BORRAR TODO";
