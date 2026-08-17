// Catalogue français. Doit couvrir exactement le même ensemble de clés que ja.ts (imposé par le type).
import type { TranslationKey } from "./ja";

export const fr: Record<TranslationKey, string> = {
  // App name: the single-kanji display name (guideline 00), identical in every locale.
  "app.name": "巡",

  // common
  "common.close": "Fermer",
  "common.cancel": "Annuler",
  "common.ok": "OK",

  // kind
  "kind.video": "Vidéo",
  "kind.image": "Image",

  // sort
  "sort.added": "Ajout",
  "sort.name": "Nom",
  "sort.rating": "Note",
  "sort.captured": "Date de prise",
  "sort.accessed": "Vu récemment",
  "sort.hash": "Hachage du fichier",
  "sort.asc": "Croissant",
  "sort.desc": "Décroissant",

  // settings
  "settings.title": "Paramètres",
  "settings.appearance": "Apparence",
  "settings.appearanceDesc":
    "Basculer entre clair et sombre (la palette du thème est conservée).",
  "settings.light": "Clair",
  "settings.dark": "Sombre",
  "settings.theme": "Thème",

  // Appearance toggle (header)
  "theme.switchToLight": "Passer au mode clair",
  "theme.switchToDark": "Passer au mode sombre",

  "settings.language": "Langue",
  "settings.languageDesc": "Changer la langue d'affichage de l'interface.",
  "settings.scenes": "Miniatures de scène",
  "settings.scenesDesc":
    "Nombre de miniatures de scène à générer sur l'écran de détail.",
  "settings.hoverPreview": "Aperçu au survol",
  "settings.hoverPreviewDesc":
    "Affiche la scène sous le curseur au survol de la miniature d'une vidéo.",
  "settings.frameQuality": "Qualité des aperçus",
  "settings.frameQualityDesc":
    "Qualité des aperçus au survol et de la rangée de scènes dans Découverte. Plus elle est élevée, plus la génération est lente.",
  "settings.frameQualityLow": "Basse (240px)",
  "settings.frameQualityStandard": "Standard (480px)",
  "settings.frameQualityHigh": "Haute (960px)",
  "settings.emojiStyle": "Style des émojis",
  "settings.emojiStyleDesc":
    "Change l'apparence des icônes emoji et des émojis dans le texte.",
  "settings.emojiStyleNative": "Par défaut du système",
  "settings.emojiStyleTwemoji": "Twemoji",
  "settings.emojiStyleNoto": "Noto Emoji",
  "settings.emojiStyleOpenmoji": "OpenMoji",
  "settings.logo": "Logo de l'application",
  "settings.logoDesc": "S'applique aux icônes de la fenêtre et de la barre d'état.",
  "logo.dark": "Foncé",
  "logo.light": "Clair",
  "settings.keybinding": "Raccourcis clavier",
  "settings.keybindingDesc":
    "Raccourcis pour déplacer le focus dans la liste, naviguer entre les fichiers, faire défiler et cibler la recherche.",
  "settings.support": "Soutenir le développement",
  "settings.supportDesc":
    "Si vous aimez cette application, envisagez de soutenir son développement.",
  "settings.buyMeCoffee": "Buy Me a Coffee",
  "settings.hideSupport": "Masquer le lien de soutien",
  "settings.update": "Mises à jour",
  "settings.updateDesc": "Vérifier si une version plus récente est disponible.",
  "settings.updateCheckNow": "Vérifier maintenant",
  "settings.updateAuto": "Vérifier automatiquement au démarrage",
  "update.available": "La version {version} est disponible",
  "update.availableDesc": "Version actuelle : {current}",
  "update.view": "Ouvrir la version",
  "update.skip": "Ignorer cette version",
  "update.checking": "Vérification…",
  "update.checkFailed":
    "Impossible de vérifier (vous êtes peut-être hors ligne).",
  "update.upToDate": "Vous êtes à jour ({version}).",
  "settings.about": "À propos",
  "about.version": "{name} version {version}",
  "about.appLicense": "{name} est publié sous licence MIT.",
  "about.ossTitle": "Licences open source",
  "about.ossDesc":
    "Cette application inclut les logiciels open source suivants.",
  "about.ffmpegNotice":
    "Les binaires FFmpeg / FFprobe inclus sont sous licence GPL v3. Le texte complet de la licence et le code source sont disponibles via les liens ci-dessous.",
  "about.license": "Licence",
  "about.source": "Source",
  "about.fullDependencies": "Voir toutes les dépendances (package.json)",
  "keybinding.normal": "Normal",
  "keybinding.vim": "Vim",
  "keybinding.emacs": "Emacs",

  // home
  "home.noDirectory": "(Aucun dossier sélectionné)",
  "home.scan": "Analyser",
  "home.initError": "Erreur d'initialisation : {msg}",
  "home.initErrorSchemaMismatchHelp":
    "Le format de la base de données ne correspond peut-être pas à cette version de l'application. Supprimez cet espace de travail depuis la barre latérale gauche, puis enregistrez-le à nouveau.",
  "home.removeChip": "Retirer ce filtre",
  "home.clearAll": "Tout effacer",
  "home.noWorkspace": "Aucun dossier vidéo n'a été ajouté.",
  "home.addDirectory": "Ajouter un dossier",
  "home.addFromSidebar":
    "Vous pouvez aussi ajouter ou changer depuis la barre latérale gauche.",
  "home.scanWithDeleted": "Resynchroniser en incluant les éléments supprimés",
  "home.rebuildIndex": "Reconstruire l’index",
  "home.rebuildConfirm":
    "Supprime la liste des fichiers et les miniatures, puis relance une analyse complète. Les favoris, les notes, les tags et l’historique de lecture sont conservés, mais les fichiers que vous avez retirés de l’index réapparaîtront. Continuer ?",
  "home.scanComplete": "Analyse terminée",
  "home.resyncComplete": "Resynchronisation terminée",
  "home.rebuildComplete": "Reconstruction de l’index terminée",
  "home.scanCompleteDetail":
    "Ajoutés {inserted}, mis à jour {updated}, déplacés {moved}, supprimés {deleted}.",
  "home.scanCanceled": "Scan annulé",
  "home.escCloseHint": "Appuyez à nouveau sur Échap pour fermer la fenêtre",
  "home.scanError": "Une erreur s'est produite pendant le scan",
  "home.scanStartFailed": "Impossible de démarrer le scan",
  "home.scanAlreadyRunning": "Un scan est déjà en cours",

  // command menu
  "command.title": "Menu de commandes",
  "command.placeholder": "Rechercher des commandes...",
  "command.empty": "Aucune commande correspondante.",
  "command.groupNavigation": "Navigation",
  "command.groupWorkspace": "Espace de travail",
  "command.groupView": "Affichage",
  "command.focusSearch": "Cibler la recherche",
  "command.openDevTools": "Ouvrir la console développeur",
  "command.shortcutHint": "Ouvrir avec {shortcut}",

  // filter
  "filter.searchHint":
    'Recherche dans les noms de fichiers et les tags. Utilisez tag:plage ou tag:4k pour une correspondance exacte, sur vos tags comme sur ceux du scan. Mettez les valeurs avec espaces entre guillemets : tag:"maison de plage".',
  "filter.searchPlaceholder": "Rechercher un nom de fichier ou des tags",
  "filter.tagSuggestions": "Suggestions de tags",
  "filter.all": "Tout",
  "filter.played": "Lu",
  "filter.unplayed": "Non lu",
  "filter.sortLabel": "{label}",
  "filter.ratingFilter": "Filtrer par note minimale",
  "filter.btime": "Date de création",
  "filter.dateFrom": "Du",
  "filter.dateTo": "Au",
  "filter.more": "Autres critères",
  "filter.moreActive": "Autres critères ({count} actifs)",
  "filter.kindFilter": "Filtrer par type",
  "filter.playState": "État de lecture",
  "filter.sortSection": "Tri",
  "filter.otherSection": "Autres",

  // smart collections
  "smartCollection.title": "Collections intelligentes",
  "smartCollection.shortTitle": "Filtres",
  "smartCollection.saveCurrent": "Enregistrer les filtres actuels",
  "smartCollection.empty": "Aucune recherche enregistrée.",
  "smartCollection.delete": "Supprimer la collection",
  "smartCollection.saveTitle": "Enregistrer les filtres",
  "smartCollection.namePlaceholder": "Nom de la collection",
  "smartCollection.save": "Enregistrer",
  "smartCollection.allMedia": "Tous les médias",
  "smartCollection.defaultFavorites": "Favoris",
  "smartCollection.defaultRating": "★{rating}+",
  "smartCollection.defaultUnplayed": "Non lus",
  "smartCollection.defaultName": "Nouvelle collection",

  // media detail
  "media.notFound": "Fichier introuvable.",
  "media.openExternal": "Ouvrir avec une application externe",
  "media.openFolder": "Ouvrir le dossier",
  "media.copyFilePath": "Copier le chemin du fichier",
  "media.copyImage": "Copier l'image",
  "media.imageCopied": "Image copiée dans le presse-papiers",
  "media.imageCopyFailed": "Échec de la copie de l'image",
  "media.invertImageBackground": "Inverser l'arrière-plan de l'image",
  "media.modalMaximize": "Agrandir la fenêtre",
  "media.modalMinimize": "Réduire la fenêtre",
  "media.deleteFromIndex": "Supprimer de l'index",
  "media.deleteFromIndexConfirm":
    "Supprimer cet élément de l'index ?\nIl ne sera pas réenregistré lors des prochaines analyses.",
  "media.moreActions": "Autres actions",
  "media.prev": "Fichier précédent",
  "media.next": "Fichier suivant",
  "shortcuts.title": "Raccourcis clavier",
  "shortcuts.sectionList": "Liste",
  "shortcuts.sectionDetail": "Détail et lecteur",
  "shortcuts.commandMenu": "Ouvrir le menu de commandes",
  "shortcuts.search": "Cibler la recherche",
  "shortcuts.scrollDown": "Défiler vers le bas",
  "shortcuts.scrollUp": "Défiler vers le haut",
  "shortcuts.moveFocus": "Déplacer le focus (haut/bas/gauche/droite)",
  "shortcuts.openFocused": "Ouvrir l'élément ciblé",
  "shortcuts.help": "Cette aide",
  "shortcuts.playPause": "Lecture / pause",
  "shortcuts.skip5": "Reculer / avancer 5 s",
  "shortcuts.skip10": "Reculer / avancer 10 s",
  "shortcuts.volume": "Monter / baisser le volume",
  "shortcuts.mute": "Activer/couper le son",
  "shortcuts.fullscreen": "Basculer en plein écran",
  "shortcuts.seekStart": "Aller au début",
  "media.rating": "Note",
  "media.tags": "Tags",
  "media.metaWorkspace": "Espace de travail",
  "media.metaKind": "Type",
  "media.metaResolution": "Résolution",
  "media.metaSize": "Taille",
  "media.metaDuration": "Durée",
  "media.metaCodec": "Codec",
  "media.metaFps": "IPS",
  "media.playHistory": "Historique de lecture",
  "media.scenes": "Scènes",
  "media.bookmarks": "Marque-pages",
  "media.bookmarkRemove": "Supprimer le marque-page",
  "media.thumbSet": "Définir comme miniature principale",
  "media.thumbClear": "Revenir à la miniature automatique",
  "media.thumbApplying": "Application de la miniature principale…",
  "media.currentMainThumb": "Miniature principale actuelle :",

  // player controls
  "player.play": "Lecture",
  "player.playKey": "Lecture (Space)",
  "player.pauseKey": "Pause (Space)",
  "player.back10": "Reculer de 10 s (J)",
  "player.forward10": "Avancer de 10 s (L)",
  "player.mute": "Couper le son (M)",
  "player.unmute": "Réactiver le son (M)",
  "player.fullscreen": "Plein écran (F)",
  "player.volume": "Volume",
  "player.seek": "Position",
  "player.playFailed": "Impossible de lire dans le lecteur intégré.",
  "player.openExternal": "Ouvrir dans un lecteur externe",
  "player.reload": "Recharger",
  "player.bookmarkAdd": "Ajouter un marque-page à la position actuelle",
  "player.bookmarkRemove": "Supprimer le marque-page à {time}",
  "player.exportFrame": "Enregistrer l'image actuelle",
  "player.frameExported": "Image enregistrée",
  "player.frameExportFailed": "Échec de l'enregistrement de l'image",

  // playback errors
  "player.errAborted": "Le chargement a été interrompu (MEDIA_ERR_ABORTED)",
  "player.errNetwork": "Erreur réseau (MEDIA_ERR_NETWORK)",
  "player.errDecode":
    "Échec du décodage — le codec n'est peut-être pas pris en charge (MEDIA_ERR_DECODE)",
  "player.errSrcNotSupported":
    "Ce format ne peut pas être lu (MEDIA_ERR_SRC_NOT_SUPPORTED)",
  "player.errUnknown": "Erreur inconnue",
  "player.errCode": "Code d'erreur {code}",

  // scenes
  "scene.seekTo": "Aller à {time}",
  "scene.alt": "Scène {time}",

  // scan progress
  "scan.phaseWalk": "Énumération des fichiers",
  "scan.phaseHash": "Vérification des fichiers",
  "scan.phaseIndex": "Création de l'index",
  "scan.phaseThumbnail": "Génération des miniatures",
  "scan.phaseTags": "Étiquetage",
  "scan.cancel": "Annuler le scan",

  // tag editor
  "tag.none": "Aucun tag",
  "tag.addPlaceholder": "Ajoutez un tag et appuyez sur Entrée",
  "tag.remove": "Supprimer le tag",
  "tag.addFailed": "Impossible d'ajouter le tag",

  // media grid
  "grid.empty": "Aucun média à afficher.",
  "grid.emptyHint":
    "Lancez « Analyser » pour lister ici les vidéos et les images.",
  "grid.searchByTag": "Filtrer par « {name} »",
  "view.grid": "Vue en grille",
  "view.list": "Vue en liste",
  "view.table": "Vue en tableau",
  "table.name": "Nom",

  // discovery (random recommendations)
  "discover.title": "Découverte",
  "discover.reshuffle": "Mélanger à nouveau",
  "discover.play": "Lecture",
  "discover.open": "Ouvrir",
  "discover.progress": "{current} / {total}",
  "discover.empty": "Aucun média à recommander.",
  "discover.emptyHint":
    "Lancez « Analyser » pour importer des vidéos et des images ; elles seront recommandées ici au hasard.",
  "discover.sceneHint":
    "Survolez pour agrandir · cliquez pour lire à partir de ce point",
  "discover.moreScenes": "+{count}",

  // Historique de lecture
  "history.title": "Historique de lecture",
  "history.empty": "Aucun historique de lecture pour l'instant.",
  "history.emptyHint":
    "Lisez des vidéos ou des images et elles apparaîtront ici.",
  "history.clear": "Effacer l'historique",
  "history.clearAction": "Effacer",
  "history.clearConfirm":
    "Supprimer tout l'historique de lecture ? Cette action est irréversible.",
  "history.playCount": "{count} lectures",
  "history.viaBrowser": "Dans l'application",
  "history.viaExternal": "Lecteur externe",
  "history.today": "Aujourd'hui",
  "history.yesterday": "Hier",

  "duplicates.title": "Fichiers en double",
  "duplicates.empty": "Aucun fichier en double trouvé.",
  "duplicates.emptyHint":
    "Les fichiers au contenu identique (hachage et taille correspondants) apparaîtront ici.",
  "duplicates.summary":
    "{groups} groupes / {files} fichiers / {size} en double",
  "duplicates.fileCount": "{count} fichiers",
  "duplicates.truncated":
    "Trop de groupes ; seuls les {max} premiers sont affichés.",
  "duplicates.filter": "Afficher uniquement les fichiers en double",
  "duplicates.chip": "Doublons",

  // Écran de gestion des tags
  "tags.title": "Tags",
  "tags.summary": "{tags} tags / {assignments} attributions",
  "tags.empty": "Aucun tag pour l'instant.",
  "tags.emptyHint":
    "Ajoutez des tags depuis la vue détaillée et ils apparaîtront ici.",
  "tags.searchPlaceholder": "Filtrer les tags",
  "tags.noMatch": "Aucun tag correspondant.",
  "tags.truncated": "Trop de tags : affichage des {max} premiers.",
  "tags.fileCount": "{count} fichiers",
  "tags.sortByName": "Par nom",
  "tags.sortByCount": "Par nombre",
  "tags.groupManual": "Tags manuels",
  "tags.readOnly": "Lecture seule",
  "tags.readOnlyHint":
    "Attribués automatiquement lors de l'analyse. Ils ne peuvent être ni modifiés ni supprimés.",
  "tags.filterByTag": "Filtrer par ce tag",
  "tags.source.manual": "Manuel",
  "tags.source.autoMeta": "Automatique",
  "tags.selected": "{count} sélectionnés",
  "tags.clearSelection": "Annuler la sélection",
  "tags.rename": "Renommer",
  "tags.renameTitle": "Renommer le tag",
  "tags.renamePlaceholder": "Nouveau nom",
  "tags.renameAction": "Renommer",
  "tags.renamed": "« {from} » renommé en « {to} »",
  "tags.renameFailed": "Impossible de renommer le tag",
  "tags.renameConflict": "« {name} » existe déjà. Fusionner les deux tags ?",
  "tags.merge": "Fusionner",
  "tags.mergeTitle": "Fusionner les tags",
  "tags.mergeDescription":
    "Les {count} tags sélectionnés sont regroupés dans la cible. Les autres sont supprimés.",
  "tags.mergeTarget": "Fusionner dans",
  "tags.mergeAction": "Fusionner",
  "tags.merged": "{count} tags fusionnés",
  "tags.mergeFailed": "Impossible de fusionner les tags",
  "tags.delete": "Supprimer",
  "tags.deleteAction": "Supprimer",
  "tags.deleteConfirm":
    "Le tag « {name} » sera retiré de {count} fichiers. Continuer ?",
  "tags.deleteConfirmMany":
    "Les {count} tags sélectionnés seront supprimés. Continuer ?",
  "tags.deleted": "Tag supprimé",
  "tags.deleteFailed": "Impossible de supprimer le tag",
  "tags.addFailedReserved":
    "« {prefix}: » est réservé aux tags automatiques. Choisissez un autre nom.",
  "tags.nameTooLong": "Un nom de tag ne peut pas dépasser {max} caractères.",
  "tags.ns.res": "Résolution",
  "tags.ns.dur": "Durée",
  "tags.ns.codec": "Codec",
  "tags.ns.orient": "Orientation",
  "tags.value.durShort": "Courte",
  "tags.value.durMedium": "Moyenne",
  "tags.value.durLong": "Longue",
  "tags.value.orientVertical": "Portrait",
  "tags.value.orientHorizontal": "Paysage",
  "tags.value.orientSquare": "Carré",

  // workspace rail
  "workspace.all": "Tout",
  "workspace.settings": "Paramètres",
  "workspace.edit": "Modifier l'espace de travail",
  "workspace.editAction": "Enregistrer",
  "workspace.pathReadonly": "Le chemin ne peut pas être modifié.",
  "workspace.addDirectory": "Ajouter un dossier vidéo",
  "workspace.removeFromSidebar": "Supprimer l'espace de travail",
  "workspace.removeTitle": "Supprimer l'espace de travail",
  "workspace.removeConfirm":
    "Supprimer « {label} » ?\nSa base de données et ses miniatures seront aussi supprimées (les fichiers multimédias eux-mêmes sont conservés).",
  "workspace.removeAction": "Supprimer",
  "workspace.addedToast": "Espace de travail ajouté",
  "workspace.removedToast": "Espace de travail supprimé",
  "workspace.removedToastDetail": "« {label} » a été supprimé.",

  // user collections
  "collection.create": "Créer une collection",
  "collection.createAction": "Créer",
  "collection.edit": "Modifier la collection",
  "collection.editAction": "Enregistrer",
  "collection.createFailed": "Impossible de créer la collection",
  "collection.namePrompt": "Nom de la collection",
  "collection.removeFromSidebar": "Supprimer la collection",
  "collection.removeTitle": "Supprimer la collection",
  "collection.removeConfirm":
    "Supprimer « {name} » ?\nLes fichiers multimédias sont conservés.",
  "collection.removeAction": "Supprimer",
  "collection.removedToast": "Collection supprimée",
  "collection.removedToastDetail": "« {name} » a été supprimée.",
  "collection.addToMenu": "Ajouter à une collection",
  "collection.addTo": "Ajouter à « {name} »",
  "collection.removeFrom": "Retirer de « {name} »",
  "collection.addedToast": "Ajouté à « {name} »",
  "collection.removedFromToast": "Retiré de « {name} »",
  "collection.actionFailed": "Impossible de mettre à jour la collection",

  // À regarder plus tard (collection intégrée)
  "watchLater.name": "À regarder plus tard",
  "watchLater.add": "Ajouter à À regarder plus tard",
  "watchLater.remove": "Retirer de À regarder plus tard",
  "watchLater.addedToast": "Ajouté à À regarder plus tard",
  "watchLater.removedToast": "Retiré de À regarder plus tard",
  "watchLater.actionFailed": "Impossible de mettre à jour À regarder plus tard",
  "watchLater.empty": "À regarder plus tard est vide.",
  "watchLater.emptyHint":
    "Appuyez sur l’icône d’horloge d’un média pour le retrouver ici. Les éléments quittent la liste dès que vous les lisez.",

  // icône emoji
  "emoji.choose": "Choisir un emoji",
  "emoji.remove": "Retirer l'emoji",
  "emoji.set": "Définir un emoji",
  "collection.empty": "Aucune collection",

  // rating
  "rating.star": "{n} étoiles",

  // favorite
  "favorite.add": "Ajouter aux favoris",
  "favorite.remove": "Retirer des favoris",
  "favorite.filter": "Afficher uniquement les favoris",
  "favorite.chip": "Favoris",

  // status bar
  "statusbar.label": "Barre d'état",
  "statusbar.lastScan": "Dernier scan",
  "statusbar.lastScanNever": "Jamais",
  "statusbar.fileCount": "{count} fichiers",
  "statusbar.status": "État",
  "statusbar.scanning": "Analyse en cours",
  "statusbar.idle": "Inactif",
};
