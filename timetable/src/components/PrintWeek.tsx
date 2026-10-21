import type { Lesson } from '../types'
import { useI18n } from '../i18n'
import { addDays, formatDay, formatTime, formatWeekRange, isoWeekNumber, sameDay } from '../lib/date'


/**
 * 打印用的本周课表。屏幕上一律 `display:none`，`@media print` 才出现；
 * 只保留可读信息（代码/名称/时间/教室），不带按钮与交互——
 * 打印纸上的每个像素都要有信息量。
 */
export default function PrintWeek({
  lessons,
  weekStart,
}: {
  lessons: Lesson[]
  weekStart: Date
}) {
  const { t, locale } = useI18n()
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekNum = isoWeekNumber(weekStart)

  return (
    <div className="print-sheet" aria-hidden="true">
      <header className="print-header">
        <h1>{t('appName')}</h1>
        <p>
          {t('weekRange', { w: weekNum, range: formatWeekRange(weekStart, locale) })}
        </p>
      </header>
      <div className="print-grid">
        {days.map((day) => {
          const dayLessons = lessons
            .filter((l) => sameDay(new Date(l.start), day))
            .sort((a, b) => a.start.localeCompare(b.start))
          return (
            <section key={day.toISOString()} className="print-day">
              <h2>{formatDay(day, locale)}</h2>
              {dayLessons.length === 0 ? (
                <p className="print-empty">—</p>
              ) : (
                dayLessons.map((lesson) => (
                  <article key={lesson.id} className="print-lesson">
                    <div className="print-time">
                      {formatTime(lesson.start, locale)}–{formatTime(lesson.end, locale)}
                    </div>
                    <div className="print-title">
                      {lesson.code ? `${lesson.code} · ` : ''}
                      {lesson.title}
                    </div>
                    {lesson.location && (
                      <div className="print-room">{lesson.location}</div>
                    )}
                  </article>
                ))
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}
