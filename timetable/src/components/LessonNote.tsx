/** Baris catatan kursus (📝) yang dipakai di kartu pelajaran lintas tampilan. */
export default function LessonNote({ note }: { note?: string }) {
  if (!note) return null
  return (
    <div
      className="mt-0.5 truncate text-[10px] leading-tight text-amber-300/90"
      title={note}
    >
      📝 {note}
    </div>
  )
}