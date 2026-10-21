// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { I18nProvider } from '../../i18n'
import { MoodleProvider } from '../../hooks/useMoodleData'
import { formatDateTime, formatDateTimeShort } from '../../lib/date'
import type { Task } from '../../lib/tasks'
import type { CourseSection } from '../../lib/contents'
import CourseContentsTree from '../../components/moodle/CourseContentsTree'

const dueAt = new Date(Date.now() + 3 * 86400000).toISOString()
const tasks: Task[] = [{
  id: 'moodle-act:910',
  title: 'Synthetic quiz task',
  dueAt,
  url: 'https://moodle.lut.fi/mod/quiz/view.php?id=39210',
  modtype: 'quiz',
  completed: false,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}]
const sections: CourseSection[] = [{
  id: 1,
  name: 'Week 1',
  visible: true,
  modules: [{
    id: 39210,
    name: 'Synthetic quiz',
    modname: 'quiz',
    url: 'https://moodle.lut.fi/mod/quiz/view.php?id=39210',
    visible: true,
  }],
}]

afterEach(() => {
  cleanup()
  localStorage.clear()
})

describe('CourseContentsTree with MoodleProvider', () => {
  it('joins a synced Moodle quiz task deadline to its course module without a submission record', () => {
    render(
      <I18nProvider>
        <MoodleProvider tasks={tasks} lessons={[]} onTasks={() => {}}>
          <CourseContentsTree sections={sections} onRefresh={() => {}} busy={false} />
        </MoodleProvider>
      </I18nProvider>,
    )
    const locale = document.documentElement.lang || undefined
    const due = screen.getByText(formatDateTimeShort(dueAt, locale))
    expect(due.closest('[title]')?.getAttribute('title')).toContain(formatDateTime(dueAt, locale))
    expect(screen.getByText('Synthetic quiz')).toBeTruthy()
    expect(screen.queryByText(/已提交|已评分/)).toBeNull()
  })
})
