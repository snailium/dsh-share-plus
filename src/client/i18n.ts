/**
 * Bilingual dictionaries (zh/en) for every UI string.
 */

export type Translate = (key: string, params?: Record<string, string | number>) => string

export const DICT_ZH: Record<string, string> = {
  'button': '分享',
  'dialog.title': '分享此会话',
  'dialog.gen': '生成分享链接',
  'dialog.genBusy': '生成中…',
  'dialog.copy': '复制',
  'dialog.copied': '已复制',
  'dialog.revoke': '停止分享',
  'dialog.open': '打开',
  'dialog.expiry': '有效期',
  'dialog.expiry.never': '永不过期',
  'dialog.expiry.1h': '1 小时',
  'dialog.expiry.24h': '24 小时',
  'dialog.expiry.7d': '7 天',
  'dialog.urlHint': '在局域网内其他设备打开以下链接即可查看（只读快照）：',
  'dialog.existing': '已有的分享',
  'dialog.none': '还没有生成分享链接。',
  'dialog.error': '操作失败',
  'dialog.emptySession': '当前会话还没有内容。',
  'dialog.loopback': '本机',
  'dialog.lan': '局域网',
}

export const DICT_EN: Record<string, string> = {
  'button': 'Share',
  'dialog.title': 'Share this session',
  'dialog.gen': 'Create share link',
  'dialog.genBusy': 'Creating…',
  'dialog.copy': 'Copy',
  'dialog.copied': 'Copied',
  'dialog.revoke': 'Stop sharing',
  'dialog.open': 'Open',
  'dialog.expiry': 'Expires',
  'dialog.expiry.never': 'Never',
  'dialog.expiry.1h': '1 hour',
  'dialog.expiry.24h': '24 hours',
  'dialog.expiry.7d': '7 days',
  'dialog.urlHint': 'Open this link on another device in the LAN (read-only snapshot):',
  'dialog.existing': 'Existing shares',
  'dialog.none': 'No share links yet.',
  'dialog.error': 'Operation failed',
  'dialog.emptySession': 'This session has no content yet.',
  'dialog.loopback': 'Local',
  'dialog.lan': 'LAN',
}
