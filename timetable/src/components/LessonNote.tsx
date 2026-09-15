/** Baris catatan kursus yang dipakai di kartu pelajaran lintas tampilan. */
import Icon from './Icon'
export default function LessonNote({ note }: { note?: string }) {
  if (!note) return null
  return (
    <div
      className="mt-0.5 truncate text-[10px] leading-tight text-[var(--due)]"
      title={note}
    >
      <span className="inline-flex items-start gap-1.5"><Icon name="note" size={12} className="mt-0.5 shrink-0" /> {note}</span>
    </div>
  )
}