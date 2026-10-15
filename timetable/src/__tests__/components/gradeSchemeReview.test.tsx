// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nProvider } from '../../i18n'
import GradeSchemeReview from '../../components/GradeSchemeReview'
import { activeSchemeWeights, clearGradeSchemeMemoryCacheForTest, loadGradeSchemes } from '../../lib/gradeScheme'
import { KEYS } from '../../lib/storage'

const course = { courseId: 808, courseCode: 'KE00DA03', weights: [{ label: 'Assignment 1', weight: 25 }] }

afterEach(() => {
  cleanup()
  localStorage.removeItem(KEYS.gradeSchemes)
  clearGradeSchemeMemoryCacheForTest()
})

describe('GradeSchemeReview', () => {
  it('saves editable preview as inert draft until explicit confirmation', () => {
    const onConfirmed = vi.fn()
    render(<I18nProvider><GradeSchemeReview {...course} onConfirmed={onConfirmed} /></I18nProvider>)
    expect(screen.getByText('课程说明权重预览')).toBeTruthy()
    const weight = screen.getByRole('spinbutton', { name: /Assignment 1/ })
    fireEvent.change(weight, { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: '保存草稿' }))
    expect(loadGradeSchemes()[808].weights[0].weight).toBe(30)
    expect(activeSchemeWeights(808)).toBeNull()
    expect(onConfirmed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认应用' }))
    expect(activeSchemeWeights(808)).toEqual([{ label: 'Assignment 1', weight: 30 }])
    expect(onConfirmed).toHaveBeenCalledTimes(1)
  })
})
