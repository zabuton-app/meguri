// 한국어 카탈로그. ja.ts 와 완전히 동일한 키 집합을 다뤄야 함 (타입으로 강제).
import type { TranslationKey } from "./ja";

export const ko: Record<TranslationKey, string> = {
  // common
  "common.close": "닫기",
  "common.cancel": "취소",
  "common.ok": "확인",

  // kind
  "kind.video": "동영상",
  "kind.image": "이미지",

  // sort
  "sort.added": "추가순",
  "sort.name": "이름",
  "sort.rating": "평점",
  "sort.captured": "촬영 일시",
  "sort.accessed": "최근 본 순",
  "sort.asc": "오름차순",
  "sort.desc": "내림차순",

  // settings
  "settings.title": "설정",
  "settings.appearance": "외관",
  "settings.appearanceDesc": "라이트 / 다크를 전환합니다 (테마 색상은 유지).",
  "settings.light": "라이트",
  "settings.dark": "다크",
  "settings.theme": "테마",
  "settings.language": "언어",
  "settings.languageDesc": "UI 표시 언어를 전환합니다.",
  "settings.scenes": "장면 썸네일 수",
  "settings.scenesDesc": "상세 화면에서 생성할 장면 썸네일 수입니다.",
  "settings.hoverPreview": "호버 미리보기",
  "settings.hoverPreviewDesc":
    "동영상 썸네일 위 커서 위치에 해당하는 장면을 미리보기로 표시합니다.",
  "settings.keybinding": "키 바인딩",
  "settings.keybindingDesc":
    "목록 포커스 이동·파일 이동·스크롤·검색 포커스의 키 할당입니다.",
  "settings.support": "개발 응원하기",
  "settings.supportDesc": "이 앱이 마음에 드신다면 개발 지원을 고려해 주세요.",
  "settings.buyMeCoffee": "Buy Me a Coffee",
  "settings.hideSupport": "지원 링크 숨기기",
  "settings.update": "업데이트",
  "settings.updateDesc": "새 버전이 있는지 확인합니다.",
  "settings.updateCheckNow": "지금 확인",
  "settings.updateAuto": "시작할 때 자동으로 확인",
  "update.available": "버전 {version}을(를) 사용할 수 있습니다",
  "update.availableDesc": "현재 버전: {current}",
  "update.view": "릴리스 열기",
  "update.skip": "이 버전 건너뛰기",
  "update.checking": "확인 중…",
  "update.checkFailed": "확인할 수 없습니다(오프라인일 수 있습니다).",
  "update.upToDate": "최신 버전입니다 ({version}).",
  "settings.about": "정보",
  "about.version": "버전 {version}",
  "about.appLicense": "Meguri는 MIT License로 공개되어 있습니다.",
  "about.ossTitle": "오픈소스 라이선스",
  "about.ossDesc": "이 앱은 다음 오픈소스 소프트웨어를 포함합니다.",
  "about.ffmpegNotice":
    "동봉된 FFmpeg / FFprobe 바이너리는 GPL v3 라이선스입니다. 라이선스 전문과 소스 코드는 아래 링크에서 확인할 수 있습니다.",
  "about.license": "라이선스",
  "about.source": "소스",
  "about.fullDependencies": "모든 의존성 보기 (package.json)",
  "keybinding.normal": "표준",
  "keybinding.vim": "Vim",
  "keybinding.emacs": "Emacs",

  // home
  "home.noDirectory": "(디렉터리 미선택)",
  "home.scan": "스캔",
  "home.initError": "초기화 오류: {msg}",
  "home.initErrorSchemaMismatchHelp":
    "데이터베이스 형식이 현재 앱 버전과 일치하지 않을 수 있습니다. 왼쪽 사이드바에서 이 워크스페이스를 삭제한 후 다시 등록해 주세요.",
  "home.removeChip": "이 조건 제거",
  "home.clearAll": "모두 지우기",
  "home.noWorkspace": "동영상 디렉터리가 추가되지 않았습니다.",
  "home.addDirectory": "디렉터리 추가",
  "home.addFromSidebar": "왼쪽 사이드바에서도 추가하거나 전환할 수 있습니다.",
  "home.scanWithDeleted": "삭제된 항목 포함 재동기화",
  "home.rebuildIndex": "인덱스 다시 빌드",
  "home.rebuildConfirm":
    "파일 목록과 썸네일을 폐기하고 처음부터 다시 스캔합니다. 즐겨찾기, 평점, 태그, 재생 기록은 유지되지만 인덱스에서 삭제한 파일은 다시 표시됩니다. 계속할까요?",
  "home.scanComplete": "스캔이 완료되었습니다",
  "home.resyncComplete": "재동기화가 완료되었습니다",
  "home.rebuildComplete": "인덱스 다시 빌드가 완료되었습니다",
  "home.scanCompleteDetail":
    "추가 {inserted}, 업데이트 {updated}, 이동 {moved}, 삭제 {deleted}.",
  "home.scanCanceled": "스캔을 취소했습니다",
  "home.escCloseHint": "Esc 키를 한 번 더 누르면 창이 닫힙니다",
  "home.scanError": "스캔 중 오류가 발생했습니다",
  "home.scanStartFailed": "스캔을 시작할 수 없습니다",
  "home.scanAlreadyRunning": "스캔이 이미 실행 중입니다",

  // command menu
  "command.title": "명령 메뉴",
  "command.placeholder": "명령 검색...",
  "command.empty": "일치하는 명령이 없습니다.",
  "command.groupNavigation": "이동",
  "command.groupWorkspace": "워크스페이스",
  "command.groupView": "보기",
  "command.focusSearch": "검색에 포커스",
  "command.openDevTools": "개발자 콘솔 열기",
  "command.shortcutHint": "{shortcut} 로 열기",

  // filter
  "filter.searchPlaceholder": "파일 이름·태그 검색",
  "filter.all": "전체",
  "filter.playAny": "시청 상태",
  "filter.played": "시청함",
  "filter.unplayed": "미시청",
  "filter.sortLabel": "{label}",
  "filter.ratingFilter": "최소 평점으로 필터링",

  // smart collections
  "smartCollection.title": "스마트 컬렉션",
  "smartCollection.shortTitle": "필터",
  "smartCollection.saveCurrent": "현재 조건 저장",
  "smartCollection.empty": "저장된 검색이 아직 없습니다.",
  "smartCollection.delete": "컬렉션 삭제",
  "smartCollection.saveTitle": "검색 조건 저장",
  "smartCollection.namePlaceholder": "컬렉션 이름",
  "smartCollection.save": "저장",
  "smartCollection.allMedia": "전체 미디어",
  "smartCollection.defaultFavorites": "즐겨찾기",
  "smartCollection.defaultRating": "★{rating}+",
  "smartCollection.defaultUnplayed": "미시청",
  "smartCollection.defaultName": "새 컬렉션",

  // media detail
  "media.notFound": "파일을 찾을 수 없습니다.",
  "media.openExternal": "외부에서 열기",
  "media.openFolder": "폴더 열기",
  "media.copyFilePath": "파일 경로 복사",
  "media.copyImage": "이미지 복사",
  "media.imageCopied": "이미지를 클립보드에 복사했습니다",
  "media.imageCopyFailed": "이미지 복사에 실패했습니다",
  "media.invertImageBackground": "이미지 배경색 반전",
  "media.modalMaximize": "모달 확대",
  "media.modalMinimize": "모달 축소",
  "media.deleteFromIndex": "인덱스에서 삭제",
  "media.deleteFromIndexConfirm":
    "이 항목을 인덱스에서 삭제하시겠습니까?\n이후 스캔해도 다시 등록되지 않습니다.",
  "media.moreActions": "기타 작업",
  "media.prev": "이전 파일",
  "media.next": "다음 파일",
  "shortcuts.title": "키보드 단축키",
  "shortcuts.sectionList": "목록",
  "shortcuts.sectionDetail": "상세·플레이어",
  "shortcuts.commandMenu": "명령 메뉴 열기",
  "shortcuts.search": "검색에 포커스",
  "shortcuts.scrollDown": "아래로 스크롤",
  "shortcuts.scrollUp": "위로 스크롤",
  "shortcuts.moveFocus": "포커스 이동(상하좌우)",
  "shortcuts.openFocused": "선택한 항목 열기",
  "shortcuts.help": "이 도움말",
  "shortcuts.playPause": "재생 / 일시정지",
  "shortcuts.skip5": "5초 뒤로 / 앞으로",
  "shortcuts.skip10": "10초 뒤로 / 앞으로",
  "shortcuts.volume": "볼륨 올리기 / 내리기",
  "shortcuts.mute": "음소거 전환",
  "shortcuts.fullscreen": "전체 화면 전환",
  "shortcuts.seekStart": "처음으로 이동",
  "media.rating": "평가",
  "media.tags": "태그",
  "media.metaWorkspace": "워크스페이스",
  "media.metaKind": "종류",
  "media.metaResolution": "해상도",
  "media.metaSize": "크기",
  "media.metaDuration": "길이",
  "media.metaCodec": "코덱",
  "media.metaFps": "FPS",
  "media.playHistory": "재생 기록",
  "media.scenes": "장면",
  "media.bookmarks": "장면 북마크",
  "media.bookmarkRemove": "북마크 삭제",
  "media.thumbSet": "메인 썸네일로 설정",
  "media.thumbClear": "자동 썸네일로 되돌리기",
  "media.thumbApplying": "메인 썸네일 적용 중…",
  "media.currentMainThumb": "현재 메인 썸네일:",

  // player controls
  "player.play": "재생",
  "player.playKey": "재생 (Space)",
  "player.pauseKey": "일시정지 (Space)",
  "player.back10": "10초 뒤로 (J)",
  "player.forward10": "10초 앞으로 (L)",
  "player.mute": "음소거 (M)",
  "player.unmute": "음소거 해제 (M)",
  "player.fullscreen": "전체화면 (F)",
  "player.volume": "음량",
  "player.seek": "탐색",
  "player.playFailed": "내장 플레이어로 재생할 수 없습니다.",
  "player.openExternal": "외부 플레이어로 열기",
  "player.bookmarkAdd": "현재 위치에 북마크 추가",
  "player.bookmarkRemove": "{time}의 북마크 삭제",

  // playback errors
  "player.errAborted": "로드가 중단되었습니다 (MEDIA_ERR_ABORTED)",
  "player.errNetwork": "네트워크 오류 (MEDIA_ERR_NETWORK)",
  "player.errDecode":
    "디코딩에 실패했습니다 — 코덱 미지원 가능성 (MEDIA_ERR_DECODE)",
  "player.errSrcNotSupported":
    "이 형식은 재생할 수 없습니다 (MEDIA_ERR_SRC_NOT_SUPPORTED)",
  "player.errUnknown": "알 수 없는 오류",
  "player.errCode": "오류 코드 {code}",

  // scenes
  "scene.seekTo": "{time} 로 이동",
  "scene.alt": "장면 {time}",

  // scan progress
  "scan.phaseWalk": "파일 열거",
  "scan.phaseHash": "파일 대조",
  "scan.phaseIndex": "인덱스 생성",
  "scan.phaseThumbnail": "썸네일 생성",
  "scan.cancel": "스캔 취소",

  // tag editor
  "tag.none": "태그 없음",
  "tag.addPlaceholder": "태그를 입력하고 Enter",
  "tag.remove": "태그 삭제",

  // media grid
  "grid.empty": "표시할 미디어가 없습니다.",
  "grid.emptyHint":
    "「스캔」을 실행하면 하위의 동영상·이미지가 여기에 표시됩니다.",
  "grid.searchByTag": "「{name}」(으)로 검색",
  "view.grid": "그리드 보기",
  "view.list": "리스트 보기",
  "view.table": "테이블 보기",
  "table.name": "이름",

  // discovery (random recommendations)
  "discover.title": "디스커버리",
  "discover.reshuffle": "다시 뽑기",
  "discover.play": "재생",
  "discover.open": "열기",
  "discover.progress": "{current} / {total}",
  "discover.empty": "추천할 미디어가 없습니다.",
  "discover.emptyHint":
    "「스캔」으로 동영상과 이미지를 가져오면 여기에서 무작위로 추천됩니다.",
  "discover.sceneHint": "마우스를 올리면 확대 · 클릭하면 해당 지점부터 재생",
  "discover.moreScenes": "+{count}",

  // 재생 기록
  "history.title": "재생 기록",
  "history.empty": "재생 기록이 아직 없습니다.",
  "history.emptyHint": "동영상이나 이미지를 재생하면 여기에 기록이 표시됩니다.",
  "history.clear": "기록 지우기",
  "history.clearAction": "지우기",
  "history.clearConfirm":
    "재생 기록을 모두 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.",
  "history.playCount": "{count}회 재생",
  "history.viaBrowser": "앱 내",
  "history.viaExternal": "외부 플레이어",
  "history.today": "오늘",
  "history.yesterday": "어제",

  // workspace rail
  "workspace.all": "전체",
  "workspace.settings": "설정",
  "workspace.edit": "워크스페이스 편집",
  "workspace.editAction": "저장",
  "workspace.pathReadonly": "경로는 변경할 수 없습니다.",
  "workspace.addDirectory": "동영상 디렉터리 추가",
  "workspace.removeFromSidebar": "워크스페이스 삭제",
  "workspace.removeTitle": "워크스페이스 삭제",
  "workspace.removeConfirm":
    "「{label}」을(를) 삭제하시겠습니까?\n데이터베이스와 썸네일도 삭제됩니다 (미디어 파일 자체는 삭제되지 않습니다).",
  "workspace.removeAction": "삭제",
  "workspace.addedToast": "워크스페이스를 추가했습니다",
  "workspace.removedToast": "워크스페이스를 삭제했습니다",
  "workspace.removedToastDetail": "「{label}」을(를) 삭제했습니다.",

  // user collections
  "collection.create": "사용자 컬렉션 만들기",
  "collection.createAction": "만들기",
  "collection.edit": "컬렉션 편집",
  "collection.editAction": "저장",
  "collection.createFailed": "컬렉션을 만들 수 없습니다",
  "collection.namePrompt": "컬렉션 이름",
  "collection.removeFromSidebar": "컬렉션 삭제",
  "collection.removeTitle": "컬렉션 삭제",
  "collection.removeConfirm":
    "「{name}」을(를) 삭제하시겠습니까?\n미디어 파일 자체는 삭제되지 않습니다.",
  "collection.removeAction": "삭제",
  "collection.removedToast": "컬렉션을 삭제했습니다",
  "collection.removedToastDetail": "「{name}」을(를) 삭제했습니다.",
  "collection.addToMenu": "컬렉션에 추가",
  "collection.addTo": "「{name}」에 추가",
  "collection.removeFrom": "「{name}」에서 삭제",
  "collection.addedToast": "「{name}」에 추가했습니다",
  "collection.removedFromToast": "「{name}」에서 삭제했습니다",
  "collection.actionFailed": "컬렉션을 업데이트하지 못했습니다",

  // 이모지 아이콘
  "emoji.choose": "이모지 선택",
  "emoji.remove": "이모지 삭제",
  "emoji.set": "이모지 설정",
  "collection.empty": "컬렉션 없음",

  // rating
  "rating.star": "별 {n}개",

  // favorite
  "favorite.add": "즐겨찾기에 추가",
  "favorite.remove": "즐겨찾기에서 제거",
  "favorite.filter": "즐겨찾기만 표시",
  "favorite.chip": "즐겨찾기",

  // status bar
  "statusbar.label": "상태 표시줄",
  "statusbar.lastScan": "마지막 스캔",
  "statusbar.lastScanNever": "스캔 안 됨",
  "statusbar.fileCount": "{count}개",
  "statusbar.status": "상태",
  "statusbar.scanning": "스캔 중",
  "statusbar.idle": "대기 중",
};
