/** 常用 LUT 学习平台快捷入口（侧栏 + 作业页共用） */

export interface QuickLink {
  key: string
  name: string
  url: string
  icon: string
  /** i18n key for the short description */
  hintKey?: string
}

export const QUICK_LINKS: QuickLink[] = [
  { key: 'elut', name: 'eLUT', url: 'https://elut.lut.fi/en', icon: '🏫' },
  { key: 'moodle', name: 'Moodle', url: 'https://moodle.lut.fi/my/', icon: '🟠' },
  { key: 'mooc', name: 'MOOC', url: 'https://mooc.lut.fi/', icon: '🌐' },
  {
    key: 'hebutmoodle',
    name: 'HeBeT Moodle',
    url: 'https://hebut.maisterilms.com/login/index.php',
    icon: '🎓',
  },
  {
    key: 'timeedit',
    name: 'TimeEdit',
    url: 'https://cloud.timeedit.net/lut-saimia/web/lutpublic/ri1Y8X1QQ7wZ16QfQ5079675yYY95Z7.html',
    icon: '🟣',
  },
  { key: 'sisu', name: 'SISU', url: 'https://sisu.lut.fi/student/calendar/enrolments', icon: '🔵' },
]
