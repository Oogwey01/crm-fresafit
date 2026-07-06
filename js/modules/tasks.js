/* ============================================================================
   modules/tasks.js  —  Módulo de Tareas (tablero Kanban)  —  Fresafit CRM
   ----------------------------------------------------------------------------
   Este archivo dibuja y maneja el tablero de tareas: las columnas, las tarjetas,
   el formulario para crear/editar, arrastrar y soltar, y los filtros.

   Es un MÓDULO independiente. Se conecta con el resto de la app por dos puntos:
     1) Lee/guarda datos SOLO a través de "Storage" (storage.js).
     2) Expone un objeto "ModuloTareas" con una función render(contenedor) que
        app.js llama cuando el usuario abre la sección "Tareas".

   Los módulos futuros (clientes, pedidos, etc.) se harán con esta misma forma:
   un objeto con render(contenedor). Así se suman sin tocar los demás.
   ============================================================================ */

const ModuloTareas = (function () {

  /* Estado interno de la vista (filtros activos y el contenedor donde dibujar). */
  let contenedorRaiz = null;
  let filtroResponsable = "todos";
  let filtroArea = "todas";

  /* ------------------------------------------------------------------
     Pequeños ayudantes para crear elementos HTML sin escribir texto
     crudo (más seguro y más claro).
     ------------------------------------------------------------------ */
  function crear(etiqueta, opciones) {
    opciones = opciones || {};
    const el = document.createElement(etiqueta);
    if (opciones.clase)  el.className = opciones.clase;
    if (opciones.texto)  el.textContent = opciones.texto;
    if (opciones.html)   el.innerHTML = opciones.html;
    if (opciones.attrs)  Object.keys(opciones.attrs).forEach(function (k) {
      el.setAttribute(k, opciones.attrs[k]);
    });
    return el;
  }

  /* Genera un id único simple para cada tarea nueva. */
  function nuevoId() {
    return "t_" + Date.now() + "_" + Math.floor(Math.random() * 10000);
  }

  /* ------------------------------------------------------------------
     Datos de ejemplo: solo se cargan la PRIMERA vez que se abre la app,
     para que Armando vea el tablero funcionando de inmediato.
     Se usa una marca en el navegador para no volver a cargarlos nunca
     (así, si borra las tareas de ejemplo, no reaparecen).
     ------------------------------------------------------------------ */
  function sembrarEjemplosSiEsPrimeraVez() {
    if (localStorage.getItem("fresafit_ejemplos_cargados")) return;

    const hoy = new Date();
    function enDias(d) {
      const f = new Date(hoy);
      f.setDate(f.getDate() + d);
      return f.toISOString().slice(0, 10);
    }

    const ejemplos = [
      { titulo: "Reponer stock de guantes talla M", descripcion: "Revisar inventario y hacer pedido al proveedor.", responsable: "rene", estado: "por_hacer", prioridad: "alta", area: "inventario", fechaLimite: enDias(3) },
      { titulo: "Campaña de Instagram para lanzamiento", descripcion: "Preparar 5 posts y 3 reels.", responsable: "aaron", estado: "en_progreso", prioridad: "media", area: "marketing", fechaLimite: enDias(5) },
      { titulo: "Contactar clientes mayoristas", descripcion: "Seguimiento a los 10 prospectos de la feria.", responsable: "emiliano", estado: "en_progreso", prioridad: "alta", area: "ventas", fechaLimite: enDias(2) },
      { titulo: "Revisar diseño del CRM interno", descripcion: "Validar la Fase 1 del sistema de tareas.", responsable: "armando", estado: "en_revision", prioridad: "media", area: "general", fechaLimite: enDias(7) },
      { titulo: "Definir metas de ventas del mes", descripcion: "", responsable: "armando", estado: "hecho", prioridad: "media", area: "finanzas", fechaLimite: enDias(-1) },
    ];

    const tareas = ejemplos.map(function (t) {
      t.id = nuevoId();
      t.fechaCreacion = hoy.toISOString().slice(0, 10);
      return t;
    });

    Storage.guardarTareas(tareas);
    localStorage.setItem("fresafit_ejemplos_cargados", "si");
  }

  /* ------------------------------------------------------------------
     PUNTO DE ENTRADA: app.js llama a esto para dibujar la sección.
     ------------------------------------------------------------------ */
  function render(contenedor) {
    contenedorRaiz = contenedor;
    sembrarEjemplosSiEsPrimeraVez();
    redibujar();
  }

  /* Vuelve a dibujar toda la sección desde cero (se llama tras cualquier cambio). */
  function redibujar() {
    contenedorRaiz.innerHTML = "";
    contenedorRaiz.appendChild(construirBarraSuperior());
    contenedorRaiz.appendChild(construirTablero());
  }

  /* ------------------------------------------------------------------
     Barra superior: título, botón "Nueva tarea" y filtros.
     ------------------------------------------------------------------ */
  function construirBarraSuperior() {
    const barra = crear("div", { clase: "barra-modulo" });

    const izq = crear("div", { clase: "barra-izq" });
    izq.appendChild(crear("h1", { clase: "titulo-modulo", texto: "Tareas del equipo" }));
    izq.appendChild(crear("p", { clase: "subtitulo-modulo", texto: "Quién hace qué y en qué va cada cosa." }));
    barra.appendChild(izq);

    const der = crear("div", { clase: "barra-der" });

    // Filtro por responsable
    const selResp = crear("select", { clase: "filtro" });
    selResp.appendChild(new Option("Todos los responsables", "todos"));
    EQUIPO.forEach(function (p) { selResp.appendChild(new Option(p.nombre, p.id)); });
    selResp.value = filtroResponsable;
    selResp.addEventListener("change", function () {
      filtroResponsable = selResp.value;
      redibujar();
    });
    der.appendChild(selResp);

    // Filtro por área
    const selArea = crear("select", { clase: "filtro" });
    selArea.appendChild(new Option("Todas las áreas", "todas"));
    AREAS.forEach(function (a) { selArea.appendChild(new Option(a.nombre, a.id)); });
    selArea.value = filtroArea;
    selArea.addEventListener("change", function () {
      filtroArea = selArea.value;
      redibujar();
    });
    der.appendChild(selArea);

    // Botón nueva tarea
    const btnNueva = crear("button", { clase: "btn btn-principal", texto: "+ Nueva tarea" });
    btnNueva.addEventListener("click", function () { abrirFormulario(null); });
    der.appendChild(btnNueva);

    barra.appendChild(der);
    return barra;
  }

  /* Aplica los filtros activos a la lista de tareas. */
  function tareasFiltradas() {
    return Storage.obtenerTareas().filter(function (t) {
      const okResp = filtroResponsable === "todos" || t.responsable === filtroResponsable;
      const okArea = filtroArea === "todas" || t.area === filtroArea;
      return okResp && okArea;
    });
  }

  /* ------------------------------------------------------------------
     El tablero: una columna por cada estado.
     ------------------------------------------------------------------ */
  function construirTablero() {
    const tablero = crear("div", { clase: "tablero" });
    const tareas = tareasFiltradas();

    ESTADOS.forEach(function (estado) {
      const delEstado = tareas.filter(function (t) { return t.estado === estado.id; });

      const columna = crear("div", { clase: "columna" });
      columna.dataset.estado = estado.id;

      // Encabezado de la columna con contador
      const cab = crear("div", { clase: "columna-cabecera" });
      cab.appendChild(crear("span", { clase: "columna-titulo", texto: estado.nombre }));
      cab.appendChild(crear("span", { clase: "columna-contador", texto: String(delEstado.length) }));
      columna.appendChild(cab);

      // Zona donde caen las tarjetas
      const lista = crear("div", { clase: "columna-lista" });

      if (delEstado.length === 0) {
        lista.appendChild(crear("div", { clase: "columna-vacia", texto: "Sin tareas" }));
      } else {
        delEstado.forEach(function (t) { lista.appendChild(construirTarjeta(t)); });
      }

      // --- Arrastrar y soltar: permitir soltar tarjetas aquí ---
      lista.addEventListener("dragover", function (e) {
        e.preventDefault();
        columna.classList.add("columna-resaltada");
      });
      lista.addEventListener("dragleave", function () {
        columna.classList.remove("columna-resaltada");
      });
      lista.addEventListener("drop", function (e) {
        e.preventDefault();
        columna.classList.remove("columna-resaltada");
        const idTarea = e.dataTransfer.getData("text/plain");
        moverTarea(idTarea, estado.id);
      });

      columna.appendChild(lista);
      tablero.appendChild(columna);
    });

    return tablero;
  }

  /* ------------------------------------------------------------------
     Una tarjeta de tarea.
     ------------------------------------------------------------------ */
  function construirTarjeta(t) {
    const persona = obtenerPersona(t.responsable);
    const prioridad = obtenerPrioridad(t.prioridad);
    const area = obtenerArea(t.area);

    const tarjeta = crear("div", { clase: "tarjeta" });
    tarjeta.setAttribute("draggable", "true");
    tarjeta.dataset.id = t.id;

    // Franja de color según prioridad (a la izquierda de la tarjeta)
    if (prioridad) tarjeta.style.borderLeftColor = prioridad.color;

    // Al empezar a arrastrar, guardamos qué tarjeta es
    tarjeta.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData("text/plain", t.id);
      tarjeta.classList.add("arrastrando");
    });
    tarjeta.addEventListener("dragend", function () {
      tarjeta.classList.remove("arrastrando");
    });

    // Título
    tarjeta.appendChild(crear("div", { clase: "tarjeta-titulo", texto: t.titulo }));

    // Etiquetas (prioridad + área)
    const etiquetas = crear("div", { clase: "tarjeta-etiquetas" });
    if (prioridad) {
      const et = crear("span", { clase: "etiqueta etiqueta-prioridad", texto: prioridad.nombre });
      et.style.backgroundColor = prioridad.color;
      etiquetas.appendChild(et);
    }
    if (area) {
      etiquetas.appendChild(crear("span", { clase: "etiqueta etiqueta-area", texto: area.nombre }));
    }
    tarjeta.appendChild(etiquetas);

    // Pie: responsable + fecha límite
    const pie = crear("div", { clase: "tarjeta-pie" });
    if (persona) {
      const resp = crear("span", { clase: "tarjeta-responsable" });
      const punto = crear("span", { clase: "punto-color" });
      punto.style.backgroundColor = persona.color;
      resp.appendChild(punto);
      resp.appendChild(document.createTextNode(persona.nombre));
      pie.appendChild(resp);
    }
    if (t.fechaLimite) {
      const venceHoy = t.fechaLimite < new Date().toISOString().slice(0, 10) && t.estado !== "hecho";
      const fecha = crear("span", {
        clase: "tarjeta-fecha" + (venceHoy ? " fecha-vencida" : ""),
        texto: formatearFecha(t.fechaLimite),
      });
      pie.appendChild(fecha);
    }
    tarjeta.appendChild(pie);

    // Botones de mover (respaldo por si no quiere arrastrar) + editar
    const acciones = crear("div", { clase: "tarjeta-acciones" });

    const idx = ESTADOS.findIndex(function (e) { return e.id === t.estado; });
    if (idx > 0) {
      const btnIzq = crear("button", { clase: "btn-mover", texto: "◀", attrs: { title: "Mover a " + ESTADOS[idx - 1].nombre } });
      btnIzq.addEventListener("click", function (ev) { ev.stopPropagation(); moverTarea(t.id, ESTADOS[idx - 1].id); });
      acciones.appendChild(btnIzq);
    }
    if (idx < ESTADOS.length - 1) {
      const btnDer = crear("button", { clase: "btn-mover", texto: "▶", attrs: { title: "Mover a " + ESTADOS[idx + 1].nombre } });
      btnDer.addEventListener("click", function (ev) { ev.stopPropagation(); moverTarea(t.id, ESTADOS[idx + 1].id); });
      acciones.appendChild(btnDer);
    }

    const btnEditar = crear("button", { clase: "btn-mover btn-editar", texto: "Editar" });
    btnEditar.addEventListener("click", function (ev) { ev.stopPropagation(); abrirFormulario(t); });
    acciones.appendChild(btnEditar);

    tarjeta.appendChild(acciones);

    // Clic en la tarjeta = editar
    tarjeta.addEventListener("click", function () { abrirFormulario(t); });

    return tarjeta;
  }

  /* Convierte "2026-07-10" en algo legible como "10 jul". */
  function formatearFecha(iso) {
    const meses = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
    const partes = iso.split("-"); // [AAAA, MM, DD]
    return parseInt(partes[2], 10) + " " + meses[parseInt(partes[1], 10) - 1];
  }

  /* ------------------------------------------------------------------
     Mover una tarea a otro estado (por arrastrar o por botón).
     ------------------------------------------------------------------ */
  function moverTarea(idTarea, nuevoEstado) {
    const tareas = Storage.obtenerTareas();
    const t = tareas.find(function (x) { return x.id === idTarea; });
    if (!t) return;
    t.estado = nuevoEstado;
    Storage.guardarTareas(tareas);
    redibujar();
  }

  /* ------------------------------------------------------------------
     Formulario para crear (tarea = null) o editar (tarea = objeto).
     Se muestra en una ventana emergente (modal).
     ------------------------------------------------------------------ */
  function abrirFormulario(tarea) {
    const esNueva = !tarea;

    const fondo = crear("div", { clase: "modal-fondo" });
    const modal = crear("div", { clase: "modal" });

    modal.appendChild(crear("h2", { clase: "modal-titulo", texto: esNueva ? "Nueva tarea" : "Editar tarea" }));

    // Campo: título
    modal.appendChild(campoEtiqueta("Título"));
    const inTitulo = crear("input", { clase: "campo", attrs: { type: "text", placeholder: "¿Qué hay que hacer?" } });
    inTitulo.value = esNueva ? "" : tarea.titulo;
    modal.appendChild(inTitulo);

    // Campo: descripción
    modal.appendChild(campoEtiqueta("Descripción (opcional)"));
    const inDesc = crear("textarea", { clase: "campo", attrs: { rows: "3", placeholder: "Detalles, notas, links..." } });
    inDesc.value = esNueva ? "" : (tarea.descripcion || "");
    modal.appendChild(inDesc);

    // Fila: responsable + área
    const fila1 = crear("div", { clase: "modal-fila" });
    const grResp = crear("div", { clase: "modal-grupo" });
    grResp.appendChild(campoEtiqueta("Responsable"));
    const selResp = crear("select", { clase: "campo" });
    EQUIPO.forEach(function (p) { selResp.appendChild(new Option(p.nombre, p.id)); });
    selResp.value = esNueva ? "armando" : tarea.responsable;
    grResp.appendChild(selResp);
    fila1.appendChild(grResp);

    const grArea = crear("div", { clase: "modal-grupo" });
    grArea.appendChild(campoEtiqueta("Área"));
    const selArea = crear("select", { clase: "campo" });
    AREAS.forEach(function (a) { selArea.appendChild(new Option(a.nombre, a.id)); });
    selArea.value = esNueva ? "general" : tarea.area;
    grArea.appendChild(selArea);
    fila1.appendChild(grArea);
    modal.appendChild(fila1);

    // Fila: prioridad + estado + fecha
    const fila2 = crear("div", { clase: "modal-fila" });

    const grPrio = crear("div", { clase: "modal-grupo" });
    grPrio.appendChild(campoEtiqueta("Prioridad"));
    const selPrio = crear("select", { clase: "campo" });
    PRIORIDADES.forEach(function (p) { selPrio.appendChild(new Option(p.nombre, p.id)); });
    selPrio.value = esNueva ? "media" : tarea.prioridad;
    grPrio.appendChild(selPrio);
    fila2.appendChild(grPrio);

    const grEstado = crear("div", { clase: "modal-grupo" });
    grEstado.appendChild(campoEtiqueta("Estado"));
    const selEstado = crear("select", { clase: "campo" });
    ESTADOS.forEach(function (e) { selEstado.appendChild(new Option(e.nombre, e.id)); });
    selEstado.value = esNueva ? "por_hacer" : tarea.estado;
    grEstado.appendChild(selEstado);
    fila2.appendChild(grEstado);

    const grFecha = crear("div", { clase: "modal-grupo" });
    grFecha.appendChild(campoEtiqueta("Fecha límite"));
    const inFecha = crear("input", { clase: "campo", attrs: { type: "date" } });
    inFecha.value = esNueva ? "" : (tarea.fechaLimite || "");
    grFecha.appendChild(inFecha);
    fila2.appendChild(grFecha);

    modal.appendChild(fila2);

    // Botones del formulario
    const acciones = crear("div", { clase: "modal-acciones" });

    // Borrar (solo al editar)
    if (!esNueva) {
      const btnBorrar = crear("button", { clase: "btn btn-peligro", texto: "Borrar" });
      btnBorrar.addEventListener("click", function () {
        if (confirm("¿Seguro que quieres borrar esta tarea? No se puede deshacer.")) {
          borrarTarea(tarea.id);
          cerrar();
        }
      });
      acciones.appendChild(btnBorrar);
    }

    const espacio = crear("div", { clase: "modal-espacio" });
    acciones.appendChild(espacio);

    const btnCancelar = crear("button", { clase: "btn btn-secundario", texto: "Cancelar" });
    btnCancelar.addEventListener("click", cerrar);
    acciones.appendChild(btnCancelar);

    const btnGuardar = crear("button", { clase: "btn btn-principal", texto: "Guardar" });
    btnGuardar.addEventListener("click", function () {
      const titulo = inTitulo.value.trim();
      if (!titulo) { alert("La tarea necesita un título."); inTitulo.focus(); return; }

      const tareas = Storage.obtenerTareas();
      if (esNueva) {
        tareas.push({
          id: nuevoId(),
          titulo: titulo,
          descripcion: inDesc.value.trim(),
          responsable: selResp.value,
          area: selArea.value,
          prioridad: selPrio.value,
          estado: selEstado.value,
          fechaLimite: inFecha.value,
          fechaCreacion: new Date().toISOString().slice(0, 10),
        });
      } else {
        const t = tareas.find(function (x) { return x.id === tarea.id; });
        t.titulo = titulo;
        t.descripcion = inDesc.value.trim();
        t.responsable = selResp.value;
        t.area = selArea.value;
        t.prioridad = selPrio.value;
        t.estado = selEstado.value;
        t.fechaLimite = inFecha.value;
      }
      Storage.guardarTareas(tareas);
      cerrar();
      redibujar();
    });
    acciones.appendChild(btnGuardar);

    modal.appendChild(acciones);

    fondo.appendChild(modal);
    document.body.appendChild(fondo);
    inTitulo.focus();

    // Cerrar al hacer clic fuera del modal o con la tecla Escape
    fondo.addEventListener("click", function (e) { if (e.target === fondo) cerrar(); });
    function alPresionarEsc(e) { if (e.key === "Escape") cerrar(); }
    document.addEventListener("keydown", alPresionarEsc);

    function cerrar() {
      document.removeEventListener("keydown", alPresionarEsc);
      if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
    }
  }

  function campoEtiqueta(texto) {
    return crear("label", { clase: "campo-etiqueta", texto: texto });
  }

  function borrarTarea(idTarea) {
    const tareas = Storage.obtenerTareas().filter(function (t) { return t.id !== idTarea; });
    Storage.guardarTareas(tareas);
    redibujar();
  }

  /* Lo que este módulo ofrece a app.js. */
  return { render: render };
})();
