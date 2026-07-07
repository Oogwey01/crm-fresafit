/* ============================================================================
   app.js  —  El "cascarón" de la aplicación  —  Fresafit CRM
   ----------------------------------------------------------------------------
   Este archivo arma la estructura general de la pantalla:
     - El menú lateral izquierdo (las 6 áreas del CRM).
     - El área principal donde se dibuja el módulo que esté abierto.
     - Los botones de Respaldar / Restaurar.

   Es el "director de orquesta": decide qué módulo mostrar y le cede el área
   principal. Hoy solo "Tareas" está activo; los demás salen como "Próximamente".

   PARA SUMAR UN MÓDULO EN LA FASE 2:
     1) Crear su archivo en js/modules/ (con un objeto que tenga render(cont)).
     2) En data.js, poner su "activo: true".
     3) Aquí abajo, en "REGISTRO DE MÓDULOS", agregar una línea:
          clientes: ModuloClientes,
     ¡Y ya! No hay que tocar nada más.
   ============================================================================ */

/* --- REGISTRO DE MÓDULOS ---
   Conecta el id de cada módulo (de data.js) con su código (el objeto con
   render). Solo aparecen aquí los módulos ya construidos.                    */
const REGISTRO_MODULOS = {
  tareas: ModuloTareas,
  // Fase 2 agregará aquí, por ejemplo:
  //   clientes: ModuloClientes,
  //   pedidos: ModuloPedidos,
};

let moduloActivo = "tareas";

/* Arranque: se ejecuta cuando la página termina de cargar. */
document.addEventListener("DOMContentLoaded", function () {
  construirEsqueleto();
  abrirModulo("tareas");
});

/* ------------------------------------------------------------------
   Construye la estructura fija: barra lateral + área principal.
   ------------------------------------------------------------------ */
function construirEsqueleto() {
  const app = document.getElementById("app");
  app.innerHTML = "";

  app.appendChild(construirBarraLateral());

  const principal = document.createElement("main");
  principal.className = "area-principal";
  principal.id = "area-principal";
  app.appendChild(principal);
}

function construirBarraLateral() {
  const lateral = document.createElement("aside");
  lateral.className = "barra-lateral";

  // Logo / marca
  const marca = document.createElement("div");
  marca.className = "marca";
  marca.innerHTML = '<span class="marca-fresa">🍓</span><span class="marca-texto">Fresafit</span>';
  lateral.appendChild(marca);
  const sub = document.createElement("div");
  sub.className = "marca-sub";
  sub.textContent = "Sistema interno";
  lateral.appendChild(sub);

  // Menú de módulos
  const nav = document.createElement("nav");
  nav.className = "menu";

  MODULOS.forEach(function (m) {
    const item = document.createElement("button");
    item.className = "menu-item" + (m.activo ? "" : " menu-item-inactivo");
    if (m.id === moduloActivo) item.classList.add("menu-item-activo");

    const icono = document.createElement("span");
    icono.className = "menu-icono";
    icono.textContent = m.icono;
    item.appendChild(icono);

    const texto = document.createElement("span");
    texto.className = "menu-texto";
    texto.textContent = m.nombre;
    item.appendChild(texto);

    if (!m.activo) {
      const badge = document.createElement("span");
      badge.className = "menu-badge";
      badge.textContent = "Pronto";
      item.appendChild(badge);
      item.disabled = true;
      item.title = "Se construirá en la Fase 2";
    } else {
      item.addEventListener("click", function () { abrirModulo(m.id); });
    }

    nav.appendChild(item);
  });

  lateral.appendChild(nav);

  // Zona inferior: respaldo y restauración
  const pie = document.createElement("div");
  pie.className = "lateral-pie";

  const btnRespaldar = document.createElement("button");
  btnRespaldar.className = "btn btn-secundario btn-bloque";
  btnRespaldar.textContent = "💾 Respaldar datos";
  btnRespaldar.title = "Descarga un archivo con todas tus tareas, por seguridad.";
  btnRespaldar.addEventListener("click", function () { Storage.exportarRespaldo(); });
  pie.appendChild(btnRespaldar);

  // Restaurar usa un input de archivo oculto
  const inputArchivo = document.createElement("input");
  inputArchivo.type = "file";
  inputArchivo.accept = "application/json";
  inputArchivo.style.display = "none";
  inputArchivo.addEventListener("change", function () {
    if (!inputArchivo.files.length) return;
    if (!confirm("Restaurar reemplazará tus datos actuales por los del archivo. ¿Continuar?")) {
      inputArchivo.value = "";
      return;
    }
    Storage.importarRespaldo(inputArchivo.files[0])
      .then(function () {
        alert("Datos restaurados correctamente.");
        localStorage.setItem("fresafit_ejemplos_cargados", "si"); // no volver a sembrar ejemplos
        abrirModulo(moduloActivo);
      })
      .catch(function (err) { alert("No se pudo restaurar: " + err.message); })
      .then(function () { inputArchivo.value = ""; });
  });
  pie.appendChild(inputArchivo);

  const btnRestaurar = document.createElement("button");
  btnRestaurar.className = "btn btn-secundario btn-bloque";
  btnRestaurar.textContent = "📂 Restaurar respaldo";
  btnRestaurar.title = "Carga un archivo de respaldo que hayas descargado antes.";
  btnRestaurar.addEventListener("click", function () { inputArchivo.click(); });
  pie.appendChild(btnRestaurar);

  const nota = document.createElement("div");
  nota.className = "lateral-nota";
  nota.textContent = "Datos guardados en esta computadora. Fase 1.";
  pie.appendChild(nota);

  lateral.appendChild(pie);
  return lateral;
}

/* ------------------------------------------------------------------
   Abre un módulo: marca su botón como activo y le cede el área principal
   para que se dibuje.
   ------------------------------------------------------------------ */
function abrirModulo(id) {
  const modulo = REGISTRO_MODULOS[id];
  if (!modulo) return;

  moduloActivo = id;

  // Redibujar la barra lateral para actualizar cuál está resaltado
  const app = document.getElementById("app");
  const lateralVieja = app.querySelector(".barra-lateral");
  if (lateralVieja) app.replaceChild(construirBarraLateral(), lateralVieja);

  // Ceder el área principal al módulo
  const principal = document.getElementById("area-principal");
  principal.innerHTML = "";
  modulo.render(principal);
}
