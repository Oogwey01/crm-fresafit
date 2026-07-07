===========================================================
   FRESAFIT · SISTEMA INTERNO (CRM)
   Fase 1 — Módulo de Tareas del equipo
===========================================================

¡Hola Armando! Esto es tu tablero de tareas. Es 100% tuyo y
local: vive en esta computadora, NO usa internet, NO tiene
nube y NO pide contraseñas. Nadie más lo ve.


-----------------------------------------------------------
CÓMO ABRIRLO (súper fácil)
-----------------------------------------------------------
1. Entra a esta carpeta (09_CRM).
2. Haz DOBLE CLIC en el archivo llamado:  index.html
3. Se abrirá en Microsoft Edge y verás tu tablero.

Consejo: para tenerlo siempre a la mano, cuando esté abierto
en Edge puedes hacer clic derecho en la pestaña o usar el
menú "..." > "Más herramientas" > "Guardar como acceso
directo / anclar a la barra de tareas".


-----------------------------------------------------------
CÓMO USARLO
-----------------------------------------------------------
• El tablero tiene 4 columnas que muestran en qué va cada tarea:
     POR HACER  →  EN PROGRESO  →  EN REVISIÓN  →  HECHO

• CREAR una tarea:  botón  "+ Nueva tarea"  (arriba a la derecha).
     Le pones título, responsable, área, prioridad y fecha límite.

• MOVER una tarea de columna:
     - Arrástrala con el mouse de una columna a otra, O
     - Usa las flechas  ◀  ▶  de la tarjeta.

• EDITAR o BORRAR una tarea:
     Haz clic en la tarjeta (o en "Editar"). Ahí puedes
     cambiar todo o borrarla.

• FILTRAR:  arriba puedes ver solo las tareas de una persona
     o de un área específica.


-----------------------------------------------------------
TUS DATOS Y CÓMO CUIDARLOS (importante)
-----------------------------------------------------------
Las tareas se guardan solas en este navegador (Edge) de esta
computadora. Se quedan aunque cierres y vuelvas a abrir.

Para no perderlas nunca, usa los botones de abajo a la izquierda:

• "💾 Respaldar datos": descarga un archivo con TODAS tus tareas.
     Hazlo de vez en cuando (por ejemplo, cada semana) y guarda
     ese archivo en un lugar seguro (o en tu OneDrive).

• "📂 Restaurar respaldo": si cambias de computadora o algo se
     borra, carga ese archivo y recuperas todo.


-----------------------------------------------------------
QUÉ SIGUE (las otras fases)
-----------------------------------------------------------
En el menú de la izquierda ya se ven las otras 5 áreas del
sistema (Clientes, Pedidos, Inventario, Métricas, Finanzas)
marcadas como "Pronto". Se construirán en la Fase 2.

La Fase 3 agregará usuarios, contraseñas y niveles de acceso
(la parte de "nube" y seguridad). El sistema ya está armado
por dentro para que todo eso se sume SIN rehacer lo de hoy.


-----------------------------------------------------------
NOTA TÉCNICA (para quien lleve la parte de programación)
-----------------------------------------------------------
App estática (HTML/CSS/JS puro, sin build, sin dependencias).
- js/data.js       : catálogos (equipo, estados, prioridades, áreas, módulos).
- js/storage.js    : ÚNICA capa de persistencia (hoy localStorage, clave
                     "fresafit_crm", con schemaVersion + migraciones).
                     Punto único a migrar para servidor/BD/auth en Fase 3.
- js/modules/*.js  : cada módulo expone { render(contenedor) }.
- js/app.js        : shell + navegación; registrar módulos nuevos en
                     REGISTRO_MODULOS y poner "activo: true" en data.js.
===========================================================
