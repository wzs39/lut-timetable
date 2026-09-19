import { describe, expect, it } from 'vitest'
import { htmlToText } from '../lib/html'

describe('htmlToText', () => {
  it('decodes common ASCII entities', () => {
    expect(htmlToText('A &amp; B &lt;tag&gt;')).toBe('A & B <tag>')
  })

  it('decodes non-ASCII entities (raquo breadcrumb in LUT forum bodies)', () => {
    expect(htmlToText('Forums &raquo; Announcements &raquo; Assignment 1')).toBe(
      'Forums » Announcements » Assignment 1',
    )
  })

  it('decodes numeric entities', () => {
    expect(htmlToText('&#8212; dash')).toBe('— dash')
  })

  it('strips tags and collapses whitespace', () => {
    expect(htmlToText('<p>Hello<br>world</p>  again')).toBe('Hello world again')
  })

  it('respects max length', () => {
    expect(htmlToText('abcdefghij', 5)).toBe('abcd…')
  })
})
