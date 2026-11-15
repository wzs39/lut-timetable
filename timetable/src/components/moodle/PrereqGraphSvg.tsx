import { useMemo, useState } from 'react'
import { COURSE_FACTS } from '../../lib/sisuCourseFacts'
import type { SisuPlanItem } from '../../lib/sisuStudyPlan'
import { normalizeCourseCode } from '../../lib/ics'
import { useI18n } from '../../i18n'
import Icon from '../Icon'

interface PrereqNode {
  code: string
  title: string
  completed: boolean
  missingPrereqs: string[]
  prereqs: string[]
  depth: number
  x: number
  y: number
}

interface PrereqEdge {
  from: string
  to: string
  satisfied: boolean
}

const NODE_W = 104
const NODE_H = 38
const COL_GAP = 148
const ROW_GAP = 54
const PAD = 16

export default function PrereqGraphSvg({
  items,
  onInspectCourse,
}: {
  items: SisuPlanItem[]
  onInspectCourse?: (code: string) => void
}) {
  const { t } = useI18n()
  const [selectedCode, setSelectedCode] = useState<string | null>(null)

  const { nodes, edges, width, height } = useMemo(() => {
    const itemByCode = new Map<string, SisuPlanItem>()
    for (const it of items) {
      if (!it.courseCode) continue
      const norm = normalizeCourseCode(it.courseCode)
      if (!norm) continue
      const existing = itemByCode.get(norm)
      if (!existing || (!existing.completed && it.completed)) {
        itemByCode.set(norm, it)
      }
    }

    // Collect course codes that participate in at least one prerequisite edge
    const edgeList: PrereqEdge[] = []
    const relevantCodes = new Set<string>()
    for (const [code, item] of itemByCode.entries()) {
      const fact = COURSE_FACTS[code]
      const prereqs = (fact?.formalPrerequisites ?? []).map((p) => normalizeCourseCode(p)).filter(Boolean)
      for (const p of prereqs) {
        if (p === code) continue
        // Include edges to catalog courses even if not yet planned
        relevantCodes.add(p)
        relevantCodes.add(code)
        const pItem = itemByCode.get(p)
        edgeList.push({
          from: p,
          to: code,
          satisfied: Boolean(pItem?.completed || item.completed),
        })
      }
    }

    if (edgeList.length === 0) {
      return { nodes: [] as PrereqNode[], edges: [] as PrereqEdge[], width: 320, height: 80 }
    }

    // Compute topological depth (longest path from root)
    const depthMap = new Map<string, number>()
    const visiting = new Set<string>()
    const getDepth = (c: string): number => {
      if (depthMap.has(c)) return depthMap.get(c)!
      if (visiting.has(c)) return 0
      visiting.add(c)
      const incoming = edgeList.filter((e) => e.to === c)
      const d = incoming.length === 0 ? 0 : 1 + Math.max(...incoming.map((e) => getDepth(e.from)))
      visiting.delete(c)
      depthMap.set(c, d)
      return d
    }
    for (const c of relevantCodes) getDepth(c)

    const byDepth = new Map<number, string[]>()
    for (const c of [...relevantCodes].sort()) {
      const d = depthMap.get(c) ?? 0
      byDepth.set(d, [...(byDepth.get(d) ?? []), c])
    }

    const maxCols = Math.max(1, ...[...byDepth.keys()].map((d) => d + 1))
    const maxRows = Math.max(1, ...[...byDepth.values()].map((arr) => arr.length))

    const builtNodes: PrereqNode[] = []
    for (const [depth, codes] of byDepth.entries()) {
      codes.forEach((code, rowIdx) => {
        const planItem = itemByCode.get(code)
        const fact = COURSE_FACTS[code]
        const incoming = edgeList.filter((e) => e.to === code)
        const missingPrereqs = incoming.filter((e) => !e.satisfied).map((e) => e.from)
        builtNodes.push({
          code,
          title: planItem?.title ?? fact?.name ?? code,
          completed: Boolean(planItem?.completed),
          missingPrereqs,
          prereqs: incoming.map((e) => e.from),
          depth,
          x: PAD + depth * COL_GAP,
          y: PAD + rowIdx * ROW_GAP,
        })
      })
    }

    return {
      nodes: builtNodes,
      edges: edgeList,
      width: Math.max(360, PAD * 2 + (maxCols - 1) * COL_GAP + NODE_W),
      height: Math.max(110, PAD * 2 + (maxRows - 1) * ROW_GAP + NODE_H),
    }
  }, [items])

  const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.code, n])), [nodes])
  const selectedNode = selectedCode ? nodeMap.get(selectedCode) ?? null : null

  return (
    <section data-testid="sisu-prereq-graph" className="app-card p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="app-card-label inline-flex items-center gap-1.5">
          <Icon name="compass" size={12} /> {t('prereqGraphTitle')}
        </h4>
        {selectedNode && onInspectCourse && (
          <button
            type="button"
            onClick={() => onInspectCourse(selectedNode.code)}
            className="app-btn px-2 py-0.5 text-[10px]"
          >
            {selectedNode.code} · {t('coursesOpenDossier')}
          </button>
        )}
      </div>

      {nodes.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-[var(--text-3)]">
          {t('prereqGraphEmpty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/50 p-1">
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block min-w-full"
          >
            <defs>
              <marker
                id="prereq-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 1 L 10 5 L 0 9 z" fill="var(--text-3)" />
              </marker>
            </defs>
            {edges.map((edge) => {
              const fromNode = nodeMap.get(edge.from)
              const toNode = nodeMap.get(edge.to)
              if (!fromNode || !toNode) return null
              const x1 = fromNode.x + NODE_W
              const y1 = fromNode.y + NODE_H / 2
              const x2 = toNode.x
              const y2 = toNode.y + NODE_H / 2
              const mx = (x1 + x2) / 2
              const highlighted =
                selectedCode != null && (selectedCode === edge.from || selectedCode === edge.to)
              return (
                <path
                  key={`${edge.from}->${edge.to}`}
                  d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={
                    highlighted
                      ? 'var(--info)'
                      : edge.satisfied
                        ? 'var(--ok)'
                        : 'var(--due)'
                  }
                  strokeWidth={highlighted ? 2 : 1.3}
                  strokeDasharray={edge.satisfied ? undefined : '4 2'}
                  opacity={selectedCode && !highlighted ? 0.25 : 0.85}
                  markerEnd="url(#prereq-arrow)"
                />
              )
            })}
            {nodes.map((node) => {
              const isSelected = selectedCode === node.code
              const isRelated =
                selectedCode != null &&
                (isSelected ||
                  edges.some(
                    (e) =>
                      (e.from === selectedCode && e.to === node.code) ||
                      (e.to === selectedCode && e.from === node.code),
                  ))
              const stroke = isSelected
                ? 'var(--accent)'
                : node.completed
                  ? 'var(--ok)'
                  : node.missingPrereqs.length > 0
                    ? 'var(--due)'
                    : 'var(--line)'
              return (
                <g
                  key={node.code}
                  transform={`translate(${node.x}, ${node.y})`}
                  onClick={() => setSelectedCode(isSelected ? null : node.code)}
                  className="cursor-pointer"
                  opacity={selectedCode && !isRelated ? 0.45 : 1}
                >
                  <rect
                    width={NODE_W}
                    height={NODE_H}
                    rx={6}
                    fill="var(--surface-1)"
                    stroke={stroke}
                    strokeWidth={isSelected ? 1.8 : 1}
                  />
                  <text
                    x={8}
                    y={15}
                    fontSize="10"
                    fontWeight="600"
                    fontFamily="monospace"
                    fill={node.completed ? 'var(--ok)' : 'var(--text-1)'}
                  >
                    {node.code}
                  </text>
                  <text x={8} y={29} fontSize="8.5" fill="var(--text-3)">
                    {node.title.length > 14 ? `${node.title.slice(0, 14)}…` : node.title}
                  </text>
                </g>
              )
            })}
          </svg>
        </div>
      )}
    </section>
  )
}
