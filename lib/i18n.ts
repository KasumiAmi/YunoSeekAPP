// i18n：4 语言本地化（首版仅 zh-CN + ja-JP 核心文案，后续补全）
type Locale = "zh-CN" | "zh-HK" | "zh-TW" | "ja-JP";

const dict: Record<string, Record<Locale, string>> = {
  appName: { "zh-CN": "YunoSeek", "zh-HK": "YunoSeek", "zh-TW": "YunoSeek", "ja-JP": "YunoSeek" },
  newChat: { "zh-CN": "开启新对话", "zh-HK": "開啟新對話", "zh-TW": "開啟新對話", "ja-JP": "新しい会話" },
  send: { "zh-CN": "发送", "zh-HK": "發送", "zh-TW": "發送", "ja-JP": "送信" },
  attach: { "zh-CN": "添加附件", "zh-HK": "添加附件", "zh-TW": "添加附件", "ja-JP": "添付" },
  camera: { "zh-CN": "拍照", "zh-HK": "拍照", "zh-TW": "拍照", "ja-JP": "撮影" },
  gallery: { "zh-CN": "从相册选择", "zh-HK": "從相冊選擇", "zh-TW": "從相簿選擇", "ja-JP": "ギャラリーから選択" },
  settings: { "zh-CN": "设置", "zh-HK": "設置", "zh-TW": "設定", "ja-JP": "設定" },
  search: { "zh-CN": "搜索", "zh-HK": "搜索", "zh-TW": "搜尋", "ja-JP": "検索" },
  history: { "zh-CN": "历史对话", "zh-HK": "歷史對話", "zh-TW": "歷史對話", "ja-JP": "会話履歴" },
  delete: { "zh-CN": "删除", "zh-HK": "刪除", "zh-TW": "刪除", "ja-JP": "削除" },
  rename: { "zh-CN": "重命名", "zh-HK": "重命名", "zh-TW": "重新命名", "ja-JP": "名前変更" },
  pin: { "zh-CN": "置顶", "zh-HK": "置頂", "zh-TW": "置頂", "ja-JP": "ピン留め" },
  unpin: { "zh-CN": "取消置顶", "zh-HK": "取消置頂", "zh-TW": "取消置頂", "ja-JP": "ピン解除" },
  deepThought: { "zh-CN": "深度思考", "zh-HK": "深度思考", "zh-TW": "深度思考", "ja-JP": "深い思考" },
  visionMode: { "zh-CN": "识图模式", "zh-HK": "識圖模式", "zh-TW": "識圖模式", "ja-JP": "画像認識" },
  webSearch: { "zh-CN": "智能搜索", "zh-HK": "智能搜索", "zh-TW": "智能搜尋", "ja-JP": "スマート検索" },
  inputPlaceholder: { "zh-CN": "发消息", "zh-HK": "發消息", "zh-TW": "傳訊息", "ja-JP": "メッセージ" },
  thinking: { "zh-CN": "思考中", "zh-HK": "思考中", "zh-TW": "思考中", "ja-JP": "思考中" },
  error: { "zh-CN": "出错了", "zh-HK": "出錯了", "zh-TW": "發生錯誤", "ja-JP": "エラー" },
  retry: { "zh-CN": "重试", "zh-HK": "重試", "zh-TW": "重試", "ja-JP": "再試行" },
  stop: { "zh-CN": "停止", "zh-HK": "停止", "zh-TW": "停止", "ja-JP": "停止" },
  copy: { "zh-CN": "复制", "zh-HK": "複製", "zh-TW": "複製", "ja-JP": "コピー" },
  copied: { "zh-CN": "已复制", "zh-HK": "已複製", "zh-TW": "已複製", "ja-JP": "コピー済み" },
  serviceStatus: { "zh-CN": "服务状态", "zh-HK": "服務狀態", "zh-TW": "服務狀態", "ja-JP": "サービス状態" },
  archive: { "zh-CN": "知识库", "zh-HK": "知識庫", "zh-TW": "知識庫", "ja-JP": "アーカイブ" },
  schedule: { "zh-CN": "放送日程", "zh-HK": "放送日程", "zh-TW": "放送日程", "ja-JP": "放送スケジュール" },
  aired: { "zh-CN": "已开播", "zh-HK": "已開播", "zh-TW": "已開播", "ja-JP": "放送済み" },
  handoff: { "zh-CN": "引继码", "zh-HK": "引繼碼", "zh-TW": "引繼碼", "ja-JP": "引き継ぎコード" },
  handoffSync: { "zh-CN": "同步", "zh-HK": "同步", "zh-TW": "同步", "ja-JP": "同期" },
  handoffRestore: { "zh-CN": "恢复", "zh-HK": "恢復", "zh-TW": "恢復", "ja-JP": "復元" },
  handoffRotate: { "zh-CN": "更换引继码", "zh-HK": "更換引繼碼", "zh-TW": "更換引繼碼", "ja-JP": "コード更新" },
  announcement: { "zh-CN": "公告", "zh-HK": "公告", "zh-TW": "公告", "ja-JP": "お知らせ" },
  announcementUpdated: { "zh-CN": "更新于 {time}", "zh-HK": "更新於 {time}", "zh-TW": "更新於 {time}", "ja-JP": "更新: {time}" },
  announcementNew: { "zh-CN": "新公告", "zh-HK": "新公告", "zh-TW": "新公告", "ja-JP": "新着" },
  profile: { "zh-CN": "角色资料", "zh-HK": "角色資料", "zh-TW": "角色資料", "ja-JP": "キャラクター" },
  searchResults: { "zh-CN": "搜索结果", "zh-HK": "搜索結果", "zh-TW": "搜尋結果", "ja-JP": "検索結果" },
  noConversations: { "zh-CN": "暂无对话", "zh-HK": "暫無對話", "zh-TW": "暫無對話", "ja-JP": "会話がありません" },
  reasoningEffort: { "zh-CN": "思考强度", "zh-HK": "思考強度", "zh-TW": "思考強度", "ja-JP": "思考強度" },
  low: { "zh-CN": "低", "zh-HK": "低", "zh-TW": "低", "ja-JP": "低" },
  medium: { "zh-CN": "中", "zh-HK": "中", "zh-TW": "中", "ja-JP": "中" },
  high: { "zh-CN": "高", "zh-HK": "高", "zh-TW": "高", "ja-JP": "高" },
  connected: { "zh-CN": "已连接", "zh-HK": "已連接", "zh-TW": "已連線", "ja-JP": "接続済み" },
  disconnected: { "zh-CN": "未连接", "zh-HK": "未連接", "zh-TW": "未連線", "ja-JP": "未接続" },
  routePrimary: { "zh-CN": "主路由", "zh-HK": "主路由", "zh-TW": "主路由", "ja-JP": "メインルート" },
  routeFallback: { "zh-CN": "备用路由", "zh-HK": "備用路由", "zh-TW": "備用路由", "ja-JP": "バックアップルート" },
  routeOutage: { "zh-CN": "通道中断", "zh-HK": "通道中斷", "zh-TW": "通道中斷", "ja-JP": "チャネル不通" },
  routeChecking: { "zh-CN": "检测中", "zh-HK": "檢測中", "zh-TW": "檢測中", "ja-JP": "確認中" },
  spoiler: { "zh-CN": "剧透", "zh-HK": "劇透", "zh-TW": "劇透", "ja-JP": "ネタバレ" },
  spoilerMajor: { "zh-CN": "重度", "zh-HK": "重度", "zh-TW": "重度", "ja-JP": "重度" },
  spoilerMajorWarn: {
    "zh-CN": "本条目包含重度剧透内容",
    "zh-HK": "本條目包含重度劇透內容",
    "zh-TW": "本條目包含重度劇透內容",
    "ja-JP": "この項目には重大なネタバレが含まれています",
  },
  lastUpdated: { "zh-CN": "最后更新", "zh-HK": "最終更新", "zh-TW": "最終更新", "ja-JP": "最終更新" },
  related: { "zh-CN": "相关条目", "zh-HK": "相關條目", "zh-TW": "相關條目", "ja-JP": "関連項目" },
  all: { "zh-CN": "全部", "zh-HK": "全部", "zh-TW": "全部", "ja-JP": "すべて" },
  character: { "zh-CN": "角色", "zh-HK": "角色", "zh-TW": "角色", "ja-JP": "キャラクター" },
  team: { "zh-CN": "乐队", "zh-HK": "樂隊", "zh-TW": "樂團", "ja-JP": "バンド" },
  world: { "zh-CN": "世界观", "zh-HK": "世界觀", "zh-TW": "世界觀", "ja-JP": "ワールド" },
  location: { "zh-CN": "地点", "zh-HK": "地點", "zh-TW": "地點", "ja-JP": "場所" },
  plot: { "zh-CN": "剧情", "zh-HK": "劇情", "zh-TW": "劇情", "ja-JP": "ストーリー" },
  // 新对话页欢迎语（与 web 端 app.js i18n 对齐）
  welcome: { "zh-CN": "嗨！我是YunoSeek", "zh-HK": "嗨！我是YunoSeek", "zh-TW": "嗨！我是YunoSeek", "ja-JP": "こんにちは！YunoSeekです" },
  selfTalkWelcome: {
    "zh-CN": "我有点讨厌自说自话...",
    "zh-HK": "我有點討厭自說自話...",
    "zh-TW": "我有點討厭自說自話...",
    "ja-JP": "独り言は少し嫌いなんだ…",
  },
};

let currentLocale: Locale = "zh-CN";

export function setLocale(locale: string) {
  if (["zh-CN", "zh-HK", "zh-TW", "ja-JP"].includes(locale)) {
    currentLocale = locale as Locale;
  }
}

export function t(key: string): string {
  return dict[key]?.[currentLocale] || dict[key]?.["zh-CN"] || key;
}

export function getLocale(): Locale {
  return currentLocale;
}
