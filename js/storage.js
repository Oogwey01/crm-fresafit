/* ============================================================================
   storage.js  —  Capa de guardado (Fresafit CRM)
   ----------------------------------------------------------------------------
   ESTE ES EL ARCHIVO MÁS IMPORTANTE PARA EL FUTURO.

   Es la ÚNICA puerta por la que la app lee y guarda datos. Hoy guarda todo en
   el navegador (localStorage), en tu propia computadora, sin nube.

   El día de mañana (Fase 3, con Ivan), para pasar a servidor + base de datos +
   usuarios, SOLO se reescribe este archivo. Todo lo demás (el tablero, los
   formularios) sigue igual porque siempre llama a estas mismas funciones.

   Los datos se guardan así:
     {
       schemaVersion: 1,        // versión del formato (para migrar a futuro)
       tareas: [ ... ],         // lista de tareas del módulo de tareas
       // Fase 2 agregará aquí: clientes: [...], pedidos: [...], etc.
     }
   ============================================================================ */

const Storage = (function () {

  // Nombre de la "caja" donde el navegador guarda nuestros datos.
  const CLAVE = "fresafit_crm";

  // Versión del formato de datos. Si algún día cambia la estructura, este
  // número sube y aquí se hace la migración sin perder información.
  const VERSION_ACTUAL = 1;

  /* Estructura inicial vacía (cuando se abre por primera vez). */
  function estructuraVacia() {
    return { schemaVersion: VERSION_ACTUAL, tareas: [] };
  }

  /* Lee TODO lo guardado y lo devuelve como objeto.
     Si no hay nada guardado aún, devuelve la estructura vacía. */
  function leerTodo() {
    try {
      const texto = localStorage.getItem(CLAVE);
      if (!texto) return estructuraVacia();
      const datos = JSON.parse(texto);
      return migrarSiHaceFalta(datos);
    } catch (e) {
      // Si algo estuviera corrupto, no rompemos la app: empezamos limpio.
      console.error("No se pudieron leer los datos, empezando vacío.", e);
      return estructuraVacia();
    }
  }

  /* Guarda TODO el objeto de datos de golpe. */
  function guardarTodo(datos) {
    datos.schemaVersion = VERSION_ACTUAL;
    localStorage.setItem(CLAVE, JSON.stringify(datos));
  }

  /* Migraciones a futuro: si los datos guardados son de una versión vieja,
     aquí se irían transformando al formato nuevo. Hoy no hay nada que migrar. */
  function migrarSiHaceFalta(datos) {
    if (!datos || typeof datos !== "object") return estructuraVacia();
    if (!datos.schemaVersion) datos.schemaVersion = VERSION_ACTUAL;
    if (!Array.isArray(datos.tareas)) datos.tareas = [];
    // Ejemplo futuro:
    //   if (datos.schemaVersion === 1) { ...transformar...; datos.schemaVersion = 2; }
    return datos;
  }

  /* ---- Funciones específicas por módulo ----
     Cada módulo pide y guarda solo su parte. El módulo de tareas usa estas. */
  function obtenerTareas() {
    return leerTodo().tareas;
  }
  function guardarTareas(tareas) {
    const datos = leerTodo();
    datos.tareas = tareas;
    guardarTodo(datos);
  }

  /* ---- Respaldo y restauración (a un archivo .json) ----
     "Respaldar" descarga un archivo con TODOS los datos.
     "Restaurar" carga ese archivo y reemplaza los datos actuales.            */
  function exportarRespaldo() {
    const datos = leerTodo();
    const texto = JSON.stringify(datos, null, 2);
    const blob = new Blob([texto], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const fecha = new Date().toISOString().slice(0, 10); // AAAA-MM-DD
    const enlace = document.createElement("a");
    enlace.href = url;
    enlace.download = "respaldo-fresafit-crm-" + fecha + ".json";
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
  }

  /* Recibe el objeto File de un <input type="file"> y devuelve una promesa.
     Si el archivo es válido, reemplaza todos los datos y resuelve.           */
  function importarRespaldo(archivo) {
    return new Promise(function (resolver, rechazar) {
      const lector = new FileReader();
      lector.onload = function () {
        try {
          const datos = migrarSiHaceFalta(JSON.parse(lector.result));
          guardarTodo(datos);
          resolver(datos);
        } catch (e) {
          rechazar(new Error("El archivo no es un respaldo válido."));
        }
      };
      lector.onerror = function () { rechazar(new Error("No se pudo leer el archivo.")); };
      lector.readAsText(archivo);
    });
  }

  /* Lo que este archivo ofrece al resto de la app. */
  return {
    obtenerTareas: obtenerTareas,
    guardarTareas: guardarTareas,
    exportarRespaldo: exportarRespaldo,
    importarRespaldo: importarRespaldo,
  };
})();
