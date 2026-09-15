/** 常用 LUT 学习平台快捷入口（侧栏 + 作业页共用） */
import type { IconName } from '../components/Icon'

export interface QuickLink {
  key: string
  name: string
  url: string
  icon: IconName
  /** i18n key for the short description */
  hintKey?: string
}

export const QUICK_LINKS: QuickLink[] = [
  { key: 'elut', name: 'eLUT', url: 'https://elut.lut.fi/en', icon: 'building' },
  { key: 'moodle', name: 'Moodle', url: 'https://moodle.lut.fi/my/', icon: 'assignment' },
  { key: 'mooc', name: 'MOOC', url: 'https://mooc.lut.fi/', icon: 'compass' },
  {
    key: 'hebutmoodle',
    name: 'HeBeT Moodle',
    url: 'https://hebut.maisterilms.com/login/index.php',
    icon: 'graduation',
  },
  {
    key: 'timeedit',
    name: 'TimeEdit',
    // Public LUT timetable index — deliberately nobody's personal share link:
    // a personal subscription URL must never be committed to this public repo.
    url: 'https://cloud.timeedit.net/lut-saimia/web/lutpublic/',
    icon: 'clock',
  },
  { key: 'sisu', name: 'SISU', url: 'https://sisu.lut.fi/student/calendar/enrolments', icon: 'book' },
]
