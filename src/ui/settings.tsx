// Building blocks of the settings sheets: groups with an icon, choices drawn
// as pictures, sliders with marks at both ends, and switch rows.

import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import './settings.css'

export function SettingGroup({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="setting-group" aria-labelledby={id}>
      <h3 id={id} className="setting-group-title">
        <span className="setting-group-icon">{icon}</span>
        {title}
      </h3>
      <div className="setting-group-body">{children}</div>
    </section>
  )
}

export interface Choice<T> {
  value: T
  label: string
  /** A drawing of what the choice does; without one the label is the face. */
  picture?: ReactNode
}

/** One of a few choices, each a tile with a drawing above its name. */
export function VisualChoice<T extends string | number>({
  name,
  hint,
  choices,
  value,
  onChange,
}: {
  name: string
  hint?: string
  choices: ReadonlyArray<Choice<T>>
  value: T
  onChange: (value: T) => void
}) {
  const id = useId()
  return (
    <div className="setting-row">
      <p id={id} className="setting-label">
        {name}
      </p>
      <div className="choice-tiles" role="group" aria-labelledby={id} style={{ '--count': choices.length } as CSSProperties}>
        {choices.map((choice) => (
          <button
            key={String(choice.value)}
            type="button"
            className="choice-tile"
            aria-pressed={choice.value === value}
            onClick={() => onChange(choice.value)}
          >
            {choice.picture}
            <span className="choice-tile-label">{choice.label}</span>
          </button>
        ))}
      </div>
      {hint && <p className="setting-hint">{hint}</p>}
    </div>
  )
}

/**
 * A slider with a mark at each end showing which way is which. With
 * `commitOnRelease` the value is only passed on when the finger lifts, for
 * settings that are costly to apply (zoom redraws every page).
 */
export function Slider({
  name,
  min,
  max,
  step = 1,
  endStep = step,
  value,
  valueText,
  lower,
  upper,
  lowerLabel,
  upperLabel,
  commitOnRelease = false,
  onValueClick,
  valueClickLabel,
  onChange,
}: {
  name: string
  min: number
  max: number
  step?: number
  /** How far the end marks move it, when that is more than one step of the slider. */
  endStep?: number
  value: number
  valueText: (value: number) => string
  lower: ReactNode
  upper: ReactNode
  lowerLabel: string
  upperLabel: string
  commitOnRelease?: boolean
  /** Makes the value a button, as for resetting the zoom. */
  onValueClick?: () => void
  valueClickLabel?: string
  onChange: (value: number) => void
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value

  // The browser's own "change" event fires when the slider is let go (or moved by a key).
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  })
  useEffect(() => {
    const element = input.current
    if (!element || !commitOnRelease) return
    const commit = () => {
      latest.current(Number(element.value))
      setDraft(null)
    }
    element.addEventListener('change', commit)
    return () => element.removeEventListener('change', commit)
  }, [commitOnRelease])

  const fill = max > min ? ((shown - min) / (max - min)) * 100 : 0
  const text = valueText(shown)

  return (
    <div className="setting-row">
      <div className="slider-head">
        <label htmlFor={id} className="setting-label">
          {name}
        </label>
        {onValueClick ? (
          <button type="button" className="slider-value is-button" aria-label={valueClickLabel} onClick={onValueClick}>
            {text}
          </button>
        ) : (
          <span className="slider-value" aria-hidden="true">
            {text}
          </span>
        )}
      </div>
      <div className="slider">
        <button
          type="button"
          className="slider-end"
          aria-label={lowerLabel}
          disabled={shown <= min}
          onClick={() => onChange(Math.max(min, shown - endStep))}
        >
          {lower}
        </button>
        <input
          ref={input}
          id={id}
          className="slider-input"
          type="range"
          min={min}
          max={max}
          step={step}
          value={shown}
          aria-valuetext={text}
          style={{ '--fill': `${fill}%` } as CSSProperties}
          onChange={(event) => {
            const next = Number(event.target.value)
            if (commitOnRelease) setDraft(next)
            else onChange(next)
          }}
        />
        <button
          type="button"
          className="slider-end"
          aria-label={upperLabel}
          disabled={shown >= max}
          onClick={() => onChange(Math.min(max, shown + endStep))}
        >
          {upper}
        </button>
      </div>
    </div>
  )
}

/** A setting that is on or off, with an icon and a line saying what it does. */
export function SwitchRow({
  icon,
  name,
  hint,
  checked,
  onChange,
}: {
  icon?: ReactNode
  name: string
  hint?: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  const id = useId()
  return (
    <div className="setting-row switch-row">
      {icon && <span className="switch-row-icon">{icon}</span>}
      <div className="switch-row-text">
        <p id={id} className="setting-label">
          {name}
        </p>
        {hint && <p className="setting-hint">{hint}</p>}
      </div>
      <button type="button" className="switch" role="switch" aria-checked={checked} aria-labelledby={id} onClick={() => onChange(!checked)}>
        <span className="switch-thumb" />
      </button>
    </div>
  )
}
