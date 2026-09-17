/**
 * 统一图标集：细描边线性图标，风格一致（替代零散 emoji / 字符字形）。
 * 线条继承 currentColor，尺寸默认 14。
 */
interface IconProps {
  name: IconName
  size?: number
  className?: string
}

export type IconName =
  // navigation / arrows
  | 'arrow-left'
  | 'arrow-right'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'external'
  | 'jump'
  | 'restore'
  | 'menu'
  | 'more'
  | 'close'
  | 'search'
  // status / semantic
  | 'warn'
  | 'clock'
  | 'hourglass'
  | 'live'
  | 'check'
  // domain
  | 'exam'
  | 'assignment'
  | 'book'
  | 'building'
  | 'compass'
  | 'chair'
  | 'pin'
  | 'note'
  | 'graduation'
  | 'settings'
  | 'shield'
  | 'puzzle'
  | 'sync'
  | 'eye-off'
  | 'pencil'
  | 'link'
  | 'trash'
  | 'plus'
  | 'megaphone'

const PATHS: Record<IconName, React.ReactNode> = {
  'arrow-left': <path d="M15 8H2m0 0l4-4M2 8l4 4" />,
  'arrow-right': <path d="M1 8h13m0 0l-4-4m4 4l-4 4" />,
  'chevron-left': <path d="M10 2L4 8l6 6" />,
  'chevron-right': <path d="M6 2l6 6-6 6" />,
  'chevron-down': <path d="M2 6l6 6 6-6" />,
  'chevron-up': <path d="M2 10l6-6 6 6" />,
  external: <path d="M6 2H2v12h12v-4M9 1h6v6m0-6L7 9" />,
  jump: <path d="M2 14V8a6 6 0 016-6h6m0 0l-3-3m3 3l-3 3" transform="translate(1 1) scale(0.8)" />,
  restore: <path d="M2 8a6 6 0 116 6m-6-6V4m0 4h4" />,
  menu: <path d="M2 4h12M2 8h12M2 12h12" />,
  more: <circle cx="3" cy="8" r="1.2" fill="currentColor" stroke="none" />,
  close: <path d="M3 3l10 10M13 3L3 13" />,
  search: <path d="M6.5 11a4.5 4.5 0 100-9 4.5 4.5 0 000 9zM10 10l4 4" />,
  warn: <path d="M8 2L1 14h14L8 2zm0 5v3m0 2v.5" />,
  clock: <path d="M8 14A6 6 0 108 2a6 6 0 000 12zM8 5v3l2 2" />,
  hourglass: <path d="M4 1h8M4 15h8M5 1v3l3 3 3-3V1M5 15v-3l3-3 3 3v3" />,
  live: <path d="M3 2v12M3 8l10-5v10L3 8z" />,
  check: <path d="M2 8.5L6 12l8-9" />,
  exam: <path d="M3 1h10v14H3zM5.5 5h5M5.5 8h5M5.5 11h3" />,
  assignment: <path d="M4 2h8v12H4zM6 5h4M6 8h4M6 11h2" />,
  book: <path d="M2 3h5a2 2 0 012 2v9a2 2 0 00-2-2H2zM14 3H9a2 2 0 00-2 2v9a2 2 0 012-2h5z" />,
  building: <path d="M3 14V2h7v12M13 14V6h-3M2 14h12M5 5h1m2 0h1M5 8h1m2 0h1M5 11h1m2 0h1" />,
  compass: <path d="M8 14A6 6 0 108 2a6 6 0 000 12zM10.5 5.5L9 9l-3.5 1.5L7 7z" />,
  chair: <path d="M5 1v7h6V1M4 8h8v3H4zM5 11v4m6-4v4" />,
  pin: <path d="M8 14s5-4.5 5-8a5 5 0 10-10 0c0 3.5 5 8 5 8zM8 8a2 2 0 100-4 2 2 0 000 4z" />,
  note: <path d="M3 1h10v9l-4 4H3zM9 14v-4h4" />,
  graduation: <path d="M8 2L1 6l7 4 7-4zM4 8v4c0 1 2 2 4 2s4-1 4-2V8" />,
  settings: <path d="M8 10.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM13 8a5 5 0 00-.1-1l2-1.5-2-3.5-2.4 1a5 5 0 00-1.7-1L8.5 1h-4l-.3 2.5a5 5 0 00-1.7 1L.1 3.5" transform="translate(1.5 2) scale(0.82)" />,
  shield: <path d="M8 1L2 3v5c0 4 3 6 6 7 3-1 6-3 6-7V3zM5 8l2 2 4-4" />,
  puzzle: <path d="M6 2h4v2a2 2 0 104 0v0h0v4h-2a2 2 0 100 4h2v2H2V6h2a2 2 0 100-4H6z" transform="scale(0.9) translate(1 1)" />,
  sync: <path d="M13 8a5 5 0 01-9 3m-1-3a5 5 0 019-3M3 4v4h4M13 12V8H9" />,
  'eye-off': <path d="M2 2l12 12M5 5a6 6 0 00-3 3 10 10 0 003 3m3 1a10 10 0 006-4 6 6 0 00-2-2M9 5a6 6 0 00-4-1" />,
  pencil: <path d="M2 14l1-4L11 2l3 3-8 8zM9 4l3 3" />,
  link: <path d="M6 10a3 3 0 010-4l2-2a3 3 0 014 4l-1 1M10 6a3 3 0 010 4l-2 2a3 3 0 01-4-4l1-1" />,
  trash: <path d="M2 4h12M5 4V2h6v2M4 4l1 10h6l1-10M6.5 7v4m3-4v4" />,
  plus: <path d="M8 2v12M2 8h12" />,
  megaphone: <path d="M13 3v8L6 9H3a1 1 0 01-1-1V6a1 1 0 011-1h3l7-2zM5.5 9v4a1.5 1.5 0 003 0V9.5" />,
}

export default function Icon({ name, size = 14, className = '' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={'inline-block shrink-0 align-[-2px] ' + className}
    >
      {PATHS[name]}
    </svg>
  )
}
