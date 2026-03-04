/**
 * VideoPlayer 常量定义
 */

// 观看时长追踪间隔（秒）
export const WATCH_TIME_INTERVAL = 10;

// 播放位置保存防抖时间（毫秒）
export const POSITION_SAVE_DEBOUNCE = 5000;

// 播放位置恢复提示的阈值（秒）
export const RESUME_THRESHOLD_START = 10;
export const RESUME_THRESHOLD_END = 10;

// ASS 双语字幕样式调整参数
export const ASS_BASE_MARGIN_V = 20; // 底部字幕边距
export const ASS_LINE_HEIGHT = 45; // 每行字幕的高度间隔
export const ASS_MIN_MARGIN_GAP = 30; // 最小边距差距

// 视频扩展名到 MIME 类型的映射
export const VIDEO_MIME_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  mov: "video/quicktime",
  webm: "video/webm",
  flv: "video/x-flv",
  ts: "video/mp2t",
};

// Plyr 中文国际化配置
export const PLYR_I18N = {
  speed: "速度",
  normal: "正常",
  quality: "画质",
  captions: "字幕",
  settings: "设置",
  pip: "画中画",
  play: "播放",
  pause: "暂停",
  mute: "静音",
  unmute: "取消静音",
  enterFullscreen: "全屏",
  exitFullscreen: "退出全屏",
  currentTime: "当前时间",
  duration: "总时长",
  volume: "音量",
  seek: "跳转",
  enableCaptions: "开启字幕",
  disableCaptions: "关闭字幕",
};

// 卡顿检测配置
export const STALL_CHECK_INTERVAL = 1000; // 每秒检查一次
export const STALL_TIMEOUT = 3; // 3秒无进度视为卡顿
