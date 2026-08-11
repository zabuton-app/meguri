// 日本語カタログ（原典）。キーはドット区切りのフラット構造。
// 補間は {name} 形式。en.ts はこのキー集合と同型でなければならない（型で強制）。
export const ja = {
  // 共通
  "common.close": "閉じる",
  "common.cancel": "キャンセル",
  "common.ok": "OK",

  // 種別
  "kind.video": "動画",
  "kind.image": "画像",

  // 並び順
  "sort.added": "追加順",
  "sort.name": "名前",
  "sort.rating": "レーティング",
  "sort.captured": "撮影日時",
  "sort.accessed": "最終表示順",
  "sort.hash": "ファイルハッシュ",
  "sort.asc": "昇順",
  "sort.desc": "降順",

  // 設定画面
  "settings.title": "設定",
  "settings.appearance": "外観",
  "settings.appearanceDesc":
    "ライト / ダークを切り替えます（テーマの色合いは維持）。",
  "settings.light": "ライト",
  "settings.dark": "ダーク",
  "settings.theme": "テーマ",

  // 外観トグル（ヘッダー）
  "theme.switchToLight": "ライトモードに切り替え",
  "theme.switchToDark": "ダークモードに切り替え",

  "settings.language": "言語",
  "settings.languageDesc": "UI の表示言語を切り替えます。",
  "settings.scenes": "シーンサムネ枚数",
  "settings.scenesDesc": "動画詳細でシーンサムネを何枚生成するか。",
  "settings.hoverPreview": "ホバープレビュー",
  "settings.hoverPreviewDesc":
    "動画サムネ上のカーソル位置に応じたシーンをプレビュー表示します。",
  "settings.frameQuality": "プレビュー画質",
  "settings.frameQualityDesc":
    "ディスカバリーのホバープレビューとシーンレールの画質。高いほど生成が遅くなります。",
  "settings.frameQualityLow": "低 (240px)",
  "settings.frameQualityStandard": "標準 (480px)",
  "settings.frameQualityHigh": "高 (960px)",
  "settings.keybinding": "キーバインド",
  "settings.keybindingDesc":
    "一覧のフォーカス移動・ファイルの前後移動・スクロール・検索フォーカスのキー割り当て。",
  "settings.support": "開発を応援",
  "settings.supportDesc":
    "このアプリが気に入ったら、開発の支援をご検討ください。",
  "settings.buyMeCoffee": "Buy Me a Coffee",
  "settings.hideSupport": "サポートリンクを非表示にする",
  "settings.update": "アップデート",
  "settings.updateDesc": "新しいバージョンが公開されていないか確認します。",
  "settings.updateCheckNow": "今すぐ確認",
  "settings.updateAuto": "起動時に自動で確認する",
  "update.available": "新しいバージョン {version} が利用可能です",
  "update.availableDesc": "現在のバージョン: {current}",
  "update.view": "リリースを開く",
  "update.skip": "このバージョンをスキップ",
  "update.checking": "確認しています…",
  "update.checkFailed":
    "確認できませんでした（オフラインの可能性があります）。",
  "update.upToDate": "最新です（{version}）。",
  "settings.about": "このアプリについて",
  "about.version": "バージョン {version}",
  "about.appLicense": "Meguri は MIT License の下で公開されています。",
  "about.ossTitle": "オープンソースライセンス",
  "about.ossDesc": "本アプリは以下のオープンソースソフトウェアを含んでいます。",
  "about.ffmpegNotice":
    "FFmpeg / FFprobe は GPL v3 でライセンスされたバイナリを同梱しています。ライセンス全文とソースコードは各リンクから参照できます。",
  "about.license": "ライセンス",
  "about.source": "ソース",
  "about.fullDependencies": "すべての依存パッケージを見る (package.json)",
  "keybinding.normal": "標準",
  "keybinding.vim": "Vim",
  "keybinding.emacs": "Emacs",

  // 一覧画面（Home）
  "home.noDirectory": "（ディレクトリ未選択）",
  "home.scan": "スキャン",
  "home.initError": "初期化エラー: {msg}",
  "home.initErrorSchemaMismatchHelp":
    "データベースの形式が現在のアプリと一致しない可能性があります。左のサイドバーからこのワークスペースを削除して、再登録してください。",
  "home.removeChip": "この条件を削除",
  "home.clearAll": "すべてクリア",
  "home.noWorkspace": "動画ディレクトリが追加されていません。",
  "home.addDirectory": "ディレクトリを追加",
  "home.addFromSidebar": "左のサイドバーからも追加・切り替えできます。",
  "home.scanWithDeleted": "削除したものを含めて再同期",
  "home.rebuildIndex": "インデックスを再構築",
  "home.rebuildConfirm":
    "ファイル一覧とサムネイルを破棄して最初から再スキャンします。お気に入り・評価・タグ・再生履歴は保持されますが、「インデックスから削除」したファイルは再び表示されます。続行しますか？",
  "home.scanComplete": "スキャンが完了しました",
  "home.resyncComplete": "再同期が完了しました",
  "home.rebuildComplete": "インデックスの再構築が完了しました",
  "home.scanCompleteDetail":
    "追加 {inserted}、更新 {updated}、移動 {moved}、削除 {deleted}。",
  "home.scanCanceled": "スキャンをキャンセルしました",
  "home.escCloseHint": "もう一度 Esc を押すとウィンドウを閉じます",
  "home.scanError": "スキャン中にエラーが発生しました",
  "home.scanStartFailed": "スキャンを開始できませんでした",
  "home.scanAlreadyRunning": "スキャンは既に実行中です",

  // コマンドメニュー
  "command.title": "コマンドメニュー",
  "command.placeholder": "コマンドを検索...",
  "command.empty": "該当するコマンドがありません。",
  "command.groupNavigation": "移動",
  "command.groupWorkspace": "ワークスペース",
  "command.groupView": "表示",
  "command.focusSearch": "検索にフォーカス",
  "command.openDevTools": "開発者コンソールを開く",
  "command.shortcutHint": "{shortcut} で開けます",

  // フィルタ（FilterBar / 条件バッジ）
  "filter.searchHint":
    'ファイル名とタグを検索します。tag:旅行 や tag:4k で、手動タグも自動タグも完全一致で絞り込めます。空白を含むタグは tag:"夏 旅行" のように引用符で囲みます。',
  "filter.searchPlaceholder": "ファイル名・タグを検索",
  "filter.tagSuggestions": "タグの候補",
  "filter.all": "すべて",
  "filter.playAny": "視聴状態",
  "filter.played": "視聴済み",
  "filter.unplayed": "未視聴",
  "filter.sortLabel": "{label}",
  "filter.ratingFilter": "最低レーティングで絞り込み",
  "filter.btime": "作成日",
  "filter.btimeFilter": "作成日で絞り込み",
  "filter.dateFrom": "開始日",
  "filter.dateTo": "終了日",
  "filter.dateClear": "クリア",

  // スマートコレクション
  "smartCollection.title": "スマートコレクション",
  "smartCollection.shortTitle": "フィルター",
  "smartCollection.saveCurrent": "現在の条件を保存",
  "smartCollection.empty": "保存済みの検索はまだありません。",
  "smartCollection.delete": "コレクションを削除",
  "smartCollection.saveTitle": "検索条件を保存",
  "smartCollection.namePlaceholder": "コレクション名",
  "smartCollection.save": "保存",
  "smartCollection.allMedia": "すべてのメディア",
  "smartCollection.defaultFavorites": "お気に入り",
  "smartCollection.defaultRating": "★{rating}以上",
  "smartCollection.defaultUnplayed": "未視聴",
  "smartCollection.defaultName": "新しいコレクション",

  // メディア詳細（MediaDetail）
  "media.notFound": "ファイルが見つかりません。",
  "media.openExternal": "外部で開く",
  "media.openFolder": "フォルダを開く",
  "media.copyFilePath": "ファイルパスをコピー",
  "media.copyImage": "画像をコピー",
  "media.imageCopied": "画像をクリップボードにコピーしました",
  "media.imageCopyFailed": "画像のコピーに失敗しました",
  "media.invertImageBackground": "画像の背景色を反転",
  "media.modalMaximize": "モーダルを拡大",
  "media.modalMinimize": "モーダルを縮小",
  "media.deleteFromIndex": "インデックスから削除",
  "media.deleteFromIndexConfirm":
    "この項目をインデックスから削除しますか？\n今後スキャンしても再登録されません。",
  "media.moreActions": "その他の操作",
  "media.prev": "前のファイル",
  "media.next": "次のファイル",
  "shortcuts.title": "キーボードショートカット",
  "shortcuts.sectionList": "一覧",
  "shortcuts.sectionDetail": "詳細・プレイヤー",
  "shortcuts.commandMenu": "コマンドメニューを開く",
  "shortcuts.search": "検索にフォーカス",
  "shortcuts.scrollDown": "下へスクロール",
  "shortcuts.scrollUp": "上へスクロール",
  "shortcuts.moveFocus": "フォーカス移動（上下左右）",
  "shortcuts.openFocused": "選択中の項目を開く",
  "shortcuts.help": "このヘルプ",
  "shortcuts.playPause": "再生 / 一時停止",
  "shortcuts.skip5": "5秒 戻る / 進む",
  "shortcuts.skip10": "10秒 戻る / 進む",
  "shortcuts.volume": "音量 上げ / 下げ",
  "shortcuts.mute": "ミュート切替",
  "shortcuts.fullscreen": "全画面切替",
  "shortcuts.seekStart": "先頭へ移動",
  "media.rating": "評価",
  "media.tags": "タグ",
  "media.metaWorkspace": "ワークスペース",
  "media.metaKind": "種別",
  "media.metaResolution": "解像度",
  "media.metaSize": "サイズ",
  "media.metaDuration": "長さ",
  "media.metaCodec": "コーデック",
  "media.metaFps": "FPS",
  "media.playHistory": "再生履歴",
  "media.scenes": "シーン",
  "media.bookmarks": "シーンブックマーク",
  "media.bookmarkRemove": "ブックマークを削除",
  "media.thumbSet": "メインサムネに設定",
  "media.thumbClear": "メインサムネを自動に戻す",
  "media.thumbApplying": "メインサムネを適用中…",
  "media.currentMainThumb": "現在のメインサムネ:",

  // プレイヤー操作
  "player.play": "再生",
  "player.playKey": "再生 (Space)",
  "player.pauseKey": "一時停止 (Space)",
  "player.back10": "10秒戻る (J)",
  "player.forward10": "10秒進む (L)",
  "player.mute": "ミュート (M)",
  "player.unmute": "ミュート解除 (M)",
  "player.fullscreen": "全画面 (F)",
  "player.volume": "音量",
  "player.seek": "シーク",
  "player.playFailed": "内蔵プレイヤーで再生できませんでした。",
  "player.openExternal": "外部プレイヤーで開く",
  "player.reload": "再読み込み",
  "player.bookmarkAdd": "現在位置にブックマークを追加",
  "player.bookmarkRemove": "{time} のブックマークを削除",
  "player.exportFrame": "現在のフレームを画像として保存",
  "player.frameExported": "フレームを画像として保存しました",
  "player.frameExportFailed": "フレームの保存に失敗しました",

  // 再生エラー
  "player.errAborted": "読み込みが中断されました (MEDIA_ERR_ABORTED)",
  "player.errNetwork": "ネットワークエラー (MEDIA_ERR_NETWORK)",
  "player.errDecode":
    "デコードに失敗しました — コーデック未対応の可能性 (MEDIA_ERR_DECODE)",
  "player.errSrcNotSupported":
    "この形式は再生できません (MEDIA_ERR_SRC_NOT_SUPPORTED)",
  "player.errUnknown": "不明なエラー",
  "player.errCode": "エラーコード {code}",

  // シーン
  "scene.seekTo": "{time} へシーク",
  "scene.alt": "シーン {time}",

  // スキャン進捗
  "scan.phaseWalk": "ファイル列挙",
  "scan.phaseHash": "ファイル照合",
  "scan.phaseIndex": "インデックス作成",
  "scan.phaseThumbnail": "サムネイル生成",
  "scan.phaseTags": "タグ付与",
  "scan.cancel": "スキャンをキャンセル",

  // タグ編集
  "tag.none": "タグなし",
  "tag.addPlaceholder": "タグを追加して Enter",
  "tag.remove": "タグ削除",
  "tag.addFailed": "タグを追加できませんでした",

  // メディアグリッド
  "grid.empty": "表示できるメディアがありません。",
  "grid.emptyHint":
    "「スキャン」を実行すると、配下の動画・画像がここに並びます。",
  "grid.searchByTag": "「{name}」で絞り込み",
  "view.grid": "グリッド表示",
  "view.list": "リスト表示",
  "view.table": "テーブル表示",
  "table.name": "名前",

  // ディスカバリー（ランダムおすすめ）
  "discover.title": "ディスカバリー",
  "discover.reshuffle": "引き直す",
  "discover.play": "再生",
  "discover.open": "開く",
  "discover.progress": "{current} / {total}",
  "discover.empty": "おすすめできるメディアがありません。",
  "discover.emptyHint":
    "「スキャン」で動画や画像を取り込むと、ここでランダムにおすすめされます。",
  "discover.sceneHint": "ホバーで拡大 · クリックでその時点から再生",
  "discover.moreScenes": "+{count}",

  // 再生履歴
  "history.title": "再生履歴",
  "history.empty": "再生履歴はまだありません。",
  "history.emptyHint": "動画や画像を再生すると、ここに履歴が表示されます。",
  "history.clear": "履歴をクリア",
  "history.clearAction": "クリア",
  "history.clearConfirm":
    "再生履歴をすべて削除しますか？この操作は取り消せません。",
  "history.playCount": "{count} 回再生",
  "history.viaBrowser": "アプリ内",
  "history.viaExternal": "外部プレーヤー",
  "history.today": "今日",
  "history.yesterday": "昨日",

  "duplicates.title": "重複ファイル",
  "duplicates.empty": "重複ファイルは見つかりませんでした。",
  "duplicates.emptyHint":
    "内容が同一（ハッシュとサイズが一致）のファイルが複数あるとここに表示されます。",
  "duplicates.summary": "{groups} グループ / {files} ファイル / 重複 {size}",
  "duplicates.fileCount": "{count} 件",
  "duplicates.truncated":
    "グループ数が多いため上位 {max} 件のみ表示しています。",
  "duplicates.filter": "重複ファイルのみ表示",
  "duplicates.chip": "重複",

  // タグ管理画面
  "tags.title": "タグ管理",
  "tags.summary": "{tags} タグ / 付与 {assignments} 件",
  "tags.empty": "タグはまだありません。",
  "tags.emptyHint": "詳細画面でタグを追加すると、ここに一覧が表示されます。",
  "tags.searchPlaceholder": "タグを絞り込み",
  "tags.noMatch": "一致するタグがありません。",
  "tags.truncated": "タグ数が多いため上位 {max} 件のみ表示しています。",
  "tags.fileCount": "{count} ファイル",
  "tags.sortByName": "名前順",
  "tags.sortByCount": "件数順",
  "tags.groupManual": "手動タグ",
  "tags.readOnly": "読み取り専用",
  "tags.readOnlyHint":
    "スキャン時に自動付与されるタグです。編集・削除はできません。",
  "tags.filterByTag": "このタグで絞り込む",
  "tags.source.manual": "手動",
  "tags.source.autoMeta": "自動",
  "tags.selected": "{count} 件選択中",
  "tags.clearSelection": "選択を解除",
  "tags.rename": "名前を変更",
  "tags.renameTitle": "タグ名を変更",
  "tags.renamePlaceholder": "新しいタグ名",
  "tags.renameAction": "変更",
  "tags.renamed": "「{from}」を「{to}」に変更しました",
  "tags.renameFailed": "タグ名の変更に失敗しました",
  "tags.renameConflict":
    "「{name}」は既に存在します。2 つのタグを統合しますか?",
  "tags.merge": "統合",
  "tags.mergeTitle": "タグを統合",
  "tags.mergeDescription":
    "選択した {count} 個のタグを統合先にまとめます。統合元のタグは削除されます。",
  "tags.mergeTarget": "統合先",
  "tags.mergeAction": "統合する",
  "tags.merged": "{count} 個のタグを統合しました",
  "tags.mergeFailed": "タグの統合に失敗しました",
  "tags.delete": "削除",
  "tags.deleteAction": "削除",
  "tags.deleteConfirm":
    "タグ「{name}」を {count} ファイルから削除します。よろしいですか?",
  "tags.deleteConfirmMany":
    "選択した {count} 個のタグを削除します。よろしいですか?",
  "tags.deleted": "タグを削除しました",
  "tags.deleteFailed": "タグの削除に失敗しました",
  "tags.addFailedReserved":
    "「{prefix}:」は自動タグ用の予約語です。別の名前を指定してください。",
  "tags.ns.res": "解像度",
  "tags.ns.dur": "長さ",
  "tags.ns.codec": "コーデック",
  "tags.ns.orient": "向き",
  "tags.value.durShort": "短尺",
  "tags.value.durMedium": "中尺",
  "tags.value.durLong": "長尺",
  "tags.value.orientVertical": "縦長",
  "tags.value.orientHorizontal": "横長",
  "tags.value.orientSquare": "正方形",

  // ワークスペースレール
  "workspace.all": "すべて",
  "workspace.settings": "設定",
  "workspace.edit": "ワークスペースを編集",
  "workspace.editAction": "保存",
  "workspace.pathReadonly": "パスは変更できません",
  "workspace.addDirectory": "動画ディレクトリを追加",
  "workspace.removeFromSidebar": "ワークスペースを削除",
  "workspace.removeTitle": "ワークスペースを削除",
  "workspace.removeConfirm":
    "「{label}」を削除しますか？\nデータベースとサムネイルも削除されます（メディアファイル自体は削除されません）",
  "workspace.removeAction": "削除",
  "workspace.addedToast": "ワークスペースを追加しました",
  "workspace.removedToast": "ワークスペースを削除しました",
  "workspace.removedToastDetail": "「{label}」を削除しました。",

  // ユーザコレクション
  "collection.create": "ユーザコレクションを作成",
  "collection.createAction": "作成",
  "collection.edit": "コレクションを編集",
  "collection.editAction": "保存",
  "collection.createFailed": "コレクションを作成できませんでした",
  "collection.namePrompt": "コレクション名",
  "collection.removeFromSidebar": "コレクションを削除",
  "collection.removeTitle": "コレクションを削除",
  "collection.removeConfirm":
    "「{name}」を削除しますか？\nメディアファイル自体は削除されません。",
  "collection.removeAction": "削除",
  "collection.removedToast": "コレクションを削除しました",
  "collection.removedToastDetail": "「{name}」を削除しました。",
  "collection.addToMenu": "コレクションに追加",
  "collection.addTo": "「{name}」に追加",
  "collection.removeFrom": "「{name}」から削除",
  "collection.addedToast": "「{name}」に追加しました",
  "collection.removedFromToast": "「{name}」から削除しました",
  "collection.actionFailed": "コレクションの更新に失敗しました",

  // 絵文字アイコン
  "emoji.choose": "絵文字を選択",
  "emoji.remove": "絵文字を削除",
  "emoji.set": "絵文字を設定",
  "collection.empty": "コレクションなし",

  // レーティング
  "rating.star": "{n} つ星",

  // お気に入り
  "favorite.add": "お気に入りに追加",
  "favorite.remove": "お気に入りから外す",
  "favorite.filter": "お気に入りのみ表示",
  "favorite.chip": "お気に入り",

  // ステータスバー
  "statusbar.label": "ステータスバー",
  "statusbar.lastScan": "最終スキャン",
  "statusbar.lastScanNever": "未スキャン",
  "statusbar.fileCount": "{count} 件",
  "statusbar.status": "処理状況",
  "statusbar.scanning": "スキャン中",
  "statusbar.idle": "待機中",
} as const;

export type TranslationKey = keyof typeof ja;
