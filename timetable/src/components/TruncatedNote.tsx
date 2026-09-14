import { useState } from 'react'

/** 备注默认折叠为约 3 行，点击展开/收起完整内容。 */
export default function TruncatedNote({ note }: { note: string }) {
  const [open, setOpen] = useState(false)
  return (
    <p
      onClick={(e) => {
        e.stopPropagation()
        setOpen((o) => !o)
      }}
      className={
        'mt-1 cursor-pointer whitespace-pre-wrap text-[11px] text-zinc-400 ' +
        (open ? '' : 'line-clamp-3')
      }
      title={open ? undefined : note}
    >
      {note}
      {!open && ' …'}
    </p>
  )
}
