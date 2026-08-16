// Catálogo en español. Debe cubrir exactamente el mismo conjunto de claves que ja.ts (forzado por el tipo).
import type { TranslationKey } from "./ja";

export const es: Record<TranslationKey, string> = {
  // common
  "common.close": "Cerrar",
  "common.cancel": "Cancelar",
  "common.ok": "Aceptar",

  // kind
  "kind.video": "Vídeo",
  "kind.image": "Imagen",

  // sort
  "sort.added": "Añadido",
  "sort.name": "Nombre",
  "sort.rating": "Valoración",
  "sort.captured": "Captura",
  "sort.accessed": "Visto por última vez",
  "sort.hash": "Hash del archivo",
  "sort.asc": "Ascendente",
  "sort.desc": "Descendente",

  // settings
  "settings.title": "Ajustes",
  "settings.appearance": "Apariencia",
  "settings.appearanceDesc":
    "Cambia entre claro y oscuro (se conserva la paleta del tema).",
  "settings.light": "Claro",
  "settings.dark": "Oscuro",
  "settings.theme": "Tema",

  // Appearance toggle (header)
  "theme.switchToLight": "Cambiar al modo claro",
  "theme.switchToDark": "Cambiar al modo oscuro",

  "settings.language": "Idioma",
  "settings.languageDesc": "Cambia el idioma de la interfaz.",
  "settings.scenes": "Miniaturas de escena",
  "settings.scenesDesc":
    "Cuántas miniaturas de escena generar en la pantalla de detalles.",
  "settings.hoverPreview": "Vista previa al pasar el cursor",
  "settings.hoverPreviewDesc":
    "Muestra la escena bajo el cursor al pasar sobre la miniatura de un vídeo.",
  "settings.frameQuality": "Calidad de la vista previa",
  "settings.frameQualityDesc":
    "Calidad de las vistas previas al pasar el cursor y de la fila de escenas en Descubrir. Cuanto más alta, más lenta la generación.",
  "settings.frameQualityLow": "Baja (240px)",
  "settings.frameQualityStandard": "Estándar (480px)",
  "settings.frameQualityHigh": "Alta (960px)",
  "settings.keybinding": "Atajos de teclado",
  "settings.keybindingDesc":
    "Asignación de teclas para mover el foco en la lista, navegar archivos, desplazar y enfocar la búsqueda.",
  "settings.support": "Apoyar el desarrollo",
  "settings.supportDesc":
    "Si te gusta esta aplicación, considera apoyar su desarrollo.",
  "settings.buyMeCoffee": "Buy Me a Coffee",
  "settings.hideSupport": "Ocultar el enlace de apoyo",
  "settings.update": "Actualizaciones",
  "settings.updateDesc":
    "Comprueba si hay una versión más reciente disponible.",
  "settings.updateCheckNow": "Comprobar ahora",
  "settings.updateAuto": "Comprobar automáticamente al iniciar",
  "update.available": "La versión {version} está disponible",
  "update.availableDesc": "Versión actual: {current}",
  "update.view": "Abrir versión",
  "update.skip": "Omitir esta versión",
  "update.checking": "Comprobando…",
  "update.checkFailed": "No se pudo comprobar (puede que estés sin conexión).",
  "update.upToDate": "Estás al día ({version}).",
  "settings.about": "Acerca de",
  "about.version": "Versión {version}",
  "about.appLicense": "Meguri se publica bajo la licencia MIT.",
  "about.ossTitle": "Licencias de código abierto",
  "about.ossDesc":
    "Esta aplicación incluye el siguiente software de código abierto.",
  "about.ffmpegNotice":
    "Los binarios de FFmpeg / FFprobe incluidos están licenciados bajo GPL v3. El texto completo de la licencia y el código fuente están disponibles en los enlaces siguientes.",
  "about.license": "Licencia",
  "about.source": "Código fuente",
  "about.fullDependencies": "Ver todas las dependencias (package.json)",
  "keybinding.normal": "Normal",
  "keybinding.vim": "Vim",
  "keybinding.emacs": "Emacs",

  // home
  "home.noDirectory": "(Ningún directorio seleccionado)",
  "home.scan": "Escanear",
  "home.initError": "Error de inicialización: {msg}",
  "home.initErrorSchemaMismatchHelp":
    "El formato de la base de datos puede no coincidir con esta versión de la aplicación. Elimina este espacio de trabajo desde la barra lateral izquierda y vuelve a registrarlo.",
  "home.removeChip": "Quitar este filtro",
  "home.clearAll": "Borrar todo",
  "home.noWorkspace": "No se ha añadido ningún directorio de vídeo.",
  "home.addDirectory": "Añadir directorio",
  "home.addFromSidebar":
    "También puedes añadir o cambiar desde la barra lateral izquierda.",
  "home.scanWithDeleted": "Resincronizar incluyendo elementos eliminados",
  "home.rebuildIndex": "Reconstruir índice",
  "home.rebuildConfirm":
    "Descarta la lista de archivos y las miniaturas y vuelve a escanear desde cero. Se conservan los favoritos, las valoraciones, las etiquetas y el historial de reproducción, pero los archivos que quitaste del índice volverán a aparecer. ¿Continuar?",
  "home.scanComplete": "Escaneo completado",
  "home.resyncComplete": "Resincronización completada",
  "home.rebuildComplete": "Reconstrucción del índice completada",
  "home.scanCompleteDetail":
    "Añadidos {inserted}, actualizados {updated}, movidos {moved}, eliminados {deleted}.",
  "home.scanCanceled": "Escaneo cancelado",
  "home.escCloseHint": "Pulsa Esc de nuevo para cerrar la ventana",
  "home.scanError": "Se produjo un error durante el escaneo",
  "home.scanStartFailed": "No se pudo iniciar el escaneo",
  "home.scanAlreadyRunning": "Ya hay un escaneo en curso",

  // command menu
  "command.title": "Menú de comandos",
  "command.placeholder": "Buscar comandos...",
  "command.empty": "No hay comandos coincidentes.",
  "command.groupNavigation": "Navegación",
  "command.groupWorkspace": "Espacio de trabajo",
  "command.groupView": "Vista",
  "command.focusSearch": "Enfocar búsqueda",
  "command.openDevTools": "Abrir consola de desarrollador",
  "command.shortcutHint": "Abrir con {shortcut}",

  // filter
  "filter.searchHint":
    'Busca en los nombres de archivo y en las etiquetas. Usa tag:playa o tag:4k para coincidir de forma exacta, tanto con las tuyas como con las automáticas. Entrecomilla los valores con espacios: tag:"casa de playa".',
  "filter.searchPlaceholder": "Buscar nombre de archivo o etiquetas",
  "filter.tagSuggestions": "Sugerencias de etiquetas",
  "filter.all": "Todo",
  "filter.played": "Reproducido",
  "filter.unplayed": "No reproducido",
  "filter.sortLabel": "{label}",
  "filter.ratingFilter": "Filtrar por valoración mínima",
  "filter.btime": "Fecha de creación",
  "filter.dateFrom": "Desde",
  "filter.dateTo": "Hasta",
  "filter.more": "Más filtros",
  "filter.moreActive": "Más filtros ({count} activos)",
  "filter.kindFilter": "Filtrar por tipo",
  "filter.playState": "Estado de reproducción",
  "filter.sortSection": "Orden",
  "filter.otherSection": "Otros",

  // smart collections
  "smartCollection.title": "Colecciones inteligentes",
  "smartCollection.shortTitle": "Filtros",
  "smartCollection.saveCurrent": "Guardar filtros actuales",
  "smartCollection.empty": "Aún no hay búsquedas guardadas.",
  "smartCollection.delete": "Eliminar colección",
  "smartCollection.saveTitle": "Guardar filtros de búsqueda",
  "smartCollection.namePlaceholder": "Nombre de la colección",
  "smartCollection.save": "Guardar",
  "smartCollection.allMedia": "Todos los medios",
  "smartCollection.defaultFavorites": "Favoritos",
  "smartCollection.defaultRating": "★{rating}+",
  "smartCollection.defaultUnplayed": "No reproducidos",
  "smartCollection.defaultName": "Nueva colección",

  // media detail
  "media.notFound": "Archivo no encontrado.",
  "media.openExternal": "Abrir externamente",
  "media.openFolder": "Abrir carpeta contenedora",
  "media.copyFilePath": "Copiar ruta del archivo",
  "media.copyImage": "Copiar imagen",
  "media.imageCopied": "Imagen copiada al portapapeles",
  "media.imageCopyFailed": "No se pudo copiar la imagen",
  "media.invertImageBackground": "Invertir fondo de imagen",
  "media.modalMaximize": "Ampliar ventana",
  "media.modalMinimize": "Reducir ventana",
  "media.deleteFromIndex": "Eliminar del índice",
  "media.deleteFromIndexConfirm":
    "¿Eliminar este elemento del índice?\nNo se volverá a registrar en futuros escaneos.",
  "media.moreActions": "Más acciones",
  "media.prev": "Archivo anterior",
  "media.next": "Archivo siguiente",
  "shortcuts.title": "Atajos de teclado",
  "shortcuts.sectionList": "Lista",
  "shortcuts.sectionDetail": "Detalle y reproductor",
  "shortcuts.commandMenu": "Abrir menú de comandos",
  "shortcuts.search": "Enfocar búsqueda",
  "shortcuts.scrollDown": "Desplazar abajo",
  "shortcuts.scrollUp": "Desplazar arriba",
  "shortcuts.moveFocus": "Mover el foco (arriba/abajo/izquierda/derecha)",
  "shortcuts.openFocused": "Abrir el elemento enfocado",
  "shortcuts.help": "Esta ayuda",
  "shortcuts.playPause": "Reproducir / pausar",
  "shortcuts.skip5": "Retroceder / avanzar 5 s",
  "shortcuts.skip10": "Retroceder / avanzar 10 s",
  "shortcuts.volume": "Subir / bajar volumen",
  "shortcuts.mute": "Alternar silencio",
  "shortcuts.fullscreen": "Alternar pantalla completa",
  "shortcuts.seekStart": "Ir al inicio",
  "media.rating": "Valoración",
  "media.tags": "Etiquetas",
  "media.metaWorkspace": "Espacio",
  "media.metaKind": "Tipo",
  "media.metaResolution": "Resolución",
  "media.metaSize": "Tamaño",
  "media.metaDuration": "Duración",
  "media.metaCodec": "Códec",
  "media.metaFps": "FPS",
  "media.playHistory": "Historial de reproducción",
  "media.scenes": "Escenas",
  "media.bookmarks": "Marcadores de escena",
  "media.bookmarkRemove": "Eliminar marcador",
  "media.thumbSet": "Usar como miniatura principal",
  "media.thumbClear": "Volver a la miniatura automática",
  "media.thumbApplying": "Aplicando miniatura principal…",
  "media.currentMainThumb": "Miniatura principal actual:",

  // player controls
  "player.play": "Reproducir",
  "player.playKey": "Reproducir (Space)",
  "player.pauseKey": "Pausar (Space)",
  "player.back10": "Retroceder 10 s (J)",
  "player.forward10": "Avanzar 10 s (L)",
  "player.mute": "Silenciar (M)",
  "player.unmute": "Activar sonido (M)",
  "player.fullscreen": "Pantalla completa (F)",
  "player.volume": "Volumen",
  "player.seek": "Buscar",
  "player.playFailed": "No se pudo reproducir en el reproductor integrado.",
  "player.openExternal": "Abrir en un reproductor externo",
  "player.reload": "Recargar",
  "player.bookmarkAdd": "Marcar la posición actual",
  "player.bookmarkRemove": "Eliminar el marcador en {time}",
  "player.exportFrame": "Guardar el fotograma actual como imagen",
  "player.frameExported": "Fotograma guardado como imagen",
  "player.frameExportFailed": "No se pudo guardar el fotograma",

  // playback errors
  "player.errAborted": "Se canceló la carga (MEDIA_ERR_ABORTED)",
  "player.errNetwork": "Error de red (MEDIA_ERR_NETWORK)",
  "player.errDecode":
    "Error al decodificar — puede que el códec no sea compatible (MEDIA_ERR_DECODE)",
  "player.errSrcNotSupported":
    "Este formato no se puede reproducir (MEDIA_ERR_SRC_NOT_SUPPORTED)",
  "player.errUnknown": "Error desconocido",
  "player.errCode": "Código de error {code}",

  // scenes
  "scene.seekTo": "Ir a {time}",
  "scene.alt": "Escena {time}",

  // scan progress
  "scan.phaseWalk": "Enumerando archivos",
  "scan.phaseHash": "Verificando archivos",
  "scan.phaseIndex": "Creando índice",
  "scan.phaseThumbnail": "Generando miniaturas",
  "scan.phaseTags": "Etiquetando",
  "scan.cancel": "Cancelar escaneo",

  // tag editor
  "tag.none": "Sin etiquetas",
  "tag.addPlaceholder": "Añade una etiqueta y pulsa Enter",
  "tag.remove": "Eliminar etiqueta",
  "tag.addFailed": "No se pudo añadir la etiqueta",

  // media grid
  "grid.empty": "No hay medios que mostrar.",
  "grid.emptyHint":
    "Ejecuta «Escanear» para listar aquí los vídeos e imágenes.",
  "grid.searchByTag": "Filtrar por «{name}»",
  "view.grid": "Vista de cuadrícula",
  "view.list": "Vista de lista",
  "view.table": "Vista de tabla",
  "table.name": "Nombre",

  // discovery (random recommendations)
  "discover.title": "Descubrir",
  "discover.reshuffle": "Volver a mezclar",
  "discover.play": "Reproducir",
  "discover.open": "Abrir",
  "discover.progress": "{current} / {total}",
  "discover.empty": "No hay medios para recomendar.",
  "discover.emptyHint":
    "Ejecuta «Escanear» para importar vídeos e imágenes y se recomendarán aquí al azar.",
  "discover.sceneHint":
    "Pasa el cursor para ampliar · haz clic para reproducir desde ese punto",
  "discover.moreScenes": "+{count}",

  // Historial de reproducción
  "history.title": "Historial de reproducción",
  "history.empty": "Aún no hay historial de reproducción.",
  "history.emptyHint": "Reproduce vídeos o imágenes y aparecerán aquí.",
  "history.clear": "Borrar historial",
  "history.clearAction": "Borrar",
  "history.clearConfirm":
    "¿Eliminar todo el historial de reproducción? Esta acción no se puede deshacer.",
  "history.playCount": "{count} reproducciones",
  "history.viaBrowser": "En la aplicación",
  "history.viaExternal": "Reproductor externo",
  "history.today": "Hoy",
  "history.yesterday": "Ayer",

  "duplicates.title": "Archivos duplicados",
  "duplicates.empty": "No se encontraron archivos duplicados.",
  "duplicates.emptyHint":
    "Los archivos con contenido idéntico (hash y tamaño coincidentes) aparecerán aquí.",
  "duplicates.summary":
    "{groups} grupos / {files} archivos / {size} duplicados",
  "duplicates.fileCount": "{count} archivos",
  "duplicates.truncated":
    "Demasiados grupos; solo se muestran los {max} primeros.",
  "duplicates.filter": "Mostrar solo archivos duplicados",
  "duplicates.chip": "Duplicados",

  // Pantalla de gestión de etiquetas
  "tags.title": "Etiquetas",
  "tags.summary": "{tags} etiquetas / {assignments} asignaciones",
  "tags.empty": "Todavía no hay etiquetas.",
  "tags.emptyHint":
    "Añade etiquetas desde la vista de detalle y aparecerán aquí.",
  "tags.searchPlaceholder": "Filtrar etiquetas",
  "tags.noMatch": "No hay etiquetas coincidentes.",
  "tags.truncated": "Demasiadas etiquetas: se muestran las {max} primeras.",
  "tags.fileCount": "{count} archivos",
  "tags.sortByName": "Por nombre",
  "tags.sortByCount": "Por cantidad",
  "tags.groupManual": "Etiquetas manuales",
  "tags.readOnly": "Solo lectura",
  "tags.readOnlyHint":
    "Se asignan automáticamente durante el escaneo. No se pueden editar ni eliminar.",
  "tags.filterByTag": "Filtrar por esta etiqueta",
  "tags.source.manual": "Manual",
  "tags.source.autoMeta": "Automática",
  "tags.selected": "{count} seleccionadas",
  "tags.clearSelection": "Quitar selección",
  "tags.rename": "Cambiar nombre",
  "tags.renameTitle": "Cambiar nombre de la etiqueta",
  "tags.renamePlaceholder": "Nuevo nombre",
  "tags.renameAction": "Cambiar",
  "tags.renamed": "«{from}» se cambió a «{to}»",
  "tags.renameFailed": "No se pudo cambiar el nombre de la etiqueta",
  "tags.renameConflict": "«{name}» ya existe. ¿Combinar las dos etiquetas?",
  "tags.merge": "Combinar",
  "tags.mergeTitle": "Combinar etiquetas",
  "tags.mergeDescription":
    "Las {count} etiquetas seleccionadas se combinan en la de destino. Las demás se eliminan.",
  "tags.mergeTarget": "Combinar en",
  "tags.mergeAction": "Combinar",
  "tags.merged": "Se combinaron {count} etiquetas",
  "tags.mergeFailed": "No se pudieron combinar las etiquetas",
  "tags.delete": "Eliminar",
  "tags.deleteAction": "Eliminar",
  "tags.deleteConfirm":
    "Se quitará la etiqueta «{name}» de {count} archivos. ¿Continuar?",
  "tags.deleteConfirmMany":
    "Se eliminarán las {count} etiquetas seleccionadas. ¿Continuar?",
  "tags.deleted": "Etiqueta eliminada",
  "tags.deleteFailed": "No se pudo eliminar la etiqueta",
  "tags.addFailedReserved":
    "«{prefix}:» está reservado para las etiquetas automáticas. Elige otro nombre.",
  "tags.nameTooLong":
    "El nombre de una etiqueta puede tener como máximo {max} caracteres.",
  "tags.ns.res": "Resolución",
  "tags.ns.dur": "Duración",
  "tags.ns.codec": "Códec",
  "tags.ns.orient": "Orientación",
  "tags.value.durShort": "Corta",
  "tags.value.durMedium": "Media",
  "tags.value.durLong": "Larga",
  "tags.value.orientVertical": "Vertical",
  "tags.value.orientHorizontal": "Horizontal",
  "tags.value.orientSquare": "Cuadrada",

  // workspace rail
  "workspace.all": "Todo",
  "workspace.settings": "Ajustes",
  "workspace.edit": "Editar espacio de trabajo",
  "workspace.editAction": "Guardar",
  "workspace.pathReadonly": "La ruta no se puede cambiar.",
  "workspace.addDirectory": "Añadir directorio de vídeo",
  "workspace.removeFromSidebar": "Eliminar espacio de trabajo",
  "workspace.removeTitle": "Eliminar espacio de trabajo",
  "workspace.removeConfirm":
    "¿Eliminar «{label}»?\nTambién se eliminarán su base de datos y sus miniaturas (los archivos multimedia se conservan).",
  "workspace.removeAction": "Eliminar",
  "workspace.addedToast": "Espacio de trabajo añadido",
  "workspace.removedToast": "Espacio de trabajo eliminado",
  "workspace.removedToastDetail": "Se eliminó «{label}».",

  // user collections
  "collection.create": "Crear colección",
  "collection.createAction": "Crear",
  "collection.edit": "Editar colección",
  "collection.editAction": "Guardar",
  "collection.createFailed": "No se pudo crear la colección",
  "collection.namePrompt": "Nombre de la colección",
  "collection.removeFromSidebar": "Eliminar colección",
  "collection.removeTitle": "Eliminar colección",
  "collection.removeConfirm":
    "¿Eliminar «{name}»?\nLos archivos multimedia se conservan.",
  "collection.removeAction": "Eliminar",
  "collection.removedToast": "Colección eliminada",
  "collection.removedToastDetail": "Se eliminó «{name}».",
  "collection.addToMenu": "Añadir a una colección",
  "collection.addTo": "Añadir a «{name}»",
  "collection.removeFrom": "Quitar de «{name}»",
  "collection.addedToast": "Añadido a «{name}»",
  "collection.removedFromToast": "Quitado de «{name}»",
  "collection.actionFailed": "No se pudo actualizar la colección",

  // Ver más tarde (colección integrada)
  "watchLater.name": "Ver más tarde",
  "watchLater.add": "Añadir a Ver más tarde",
  "watchLater.remove": "Quitar de Ver más tarde",
  "watchLater.addedToast": "Añadido a Ver más tarde",
  "watchLater.removedToast": "Quitado de Ver más tarde",
  "watchLater.actionFailed": "No se pudo actualizar Ver más tarde",
  "watchLater.empty": "Ver más tarde está vacío.",
  "watchLater.emptyHint":
    "Pulsa el icono de reloj en cualquier medio para reunirlo aquí. Los elementos salen de la lista al reproducirlos.",

  // icono de emoji
  "emoji.choose": "Elegir emoji",
  "emoji.remove": "Quitar emoji",
  "emoji.set": "Establecer emoji",
  "collection.empty": "Sin colecciones",

  // rating
  "rating.star": "{n} estrellas",

  // favorite
  "favorite.add": "Añadir a favoritos",
  "favorite.remove": "Quitar de favoritos",
  "favorite.filter": "Mostrar solo favoritos",
  "favorite.chip": "Favoritos",

  // status bar
  "statusbar.label": "Barra de estado",
  "statusbar.lastScan": "Último escaneo",
  "statusbar.lastScanNever": "Nunca",
  "statusbar.fileCount": "{count} archivos",
  "statusbar.status": "Estado",
  "statusbar.scanning": "Escaneando",
  "statusbar.idle": "Inactivo",
};
