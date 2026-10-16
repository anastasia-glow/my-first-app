import { useEffect, useMemo, useState } from 'react'
import { api } from './api.js'

const MIN_ENTRIES = 14

function todayLocal() {
  const d = new Date()
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
}

function formatDate(isoDate) {
  return new Date(`${isoDate}T00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function ratingClass(rating) {
  if (rating >= 7) return 'rating good'
  if (rating >= 4) return 'rating ok'
  return 'rating bad'
}

const emptyForm = {
  rating: null,
  morning_products: [],
  evening_products: [],
  food: '',
  sleep_hours: '',
  notes: '',
}

function formFromEntry(entry) {
  return {
    rating: entry.rating,
    morning_products: entry.morning_products,
    evening_products: entry.evening_products,
    food: entry.food,
    sleep_hours: String(entry.sleep_hours),
    notes: entry.notes,
  }
}

// Products as removable tags. Enter or comma adds one; suggestions come from
// past entries so the same product keeps the same name (which analysis relies on).
function ProductInput({ id, label, products, onChange, suggestions }) {
  const [text, setText] = useState('')

  function add() {
    const name = text.trim().replace(/,$/, '').trim()
    if (name && !products.some((p) => p.toLowerCase() === name.toLowerCase())) {
      onChange([...products, name])
    }
    setText('')
  }

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="tags">
        {products.map((p) => (
          <span key={p} className="tag">
            {p}
            <button
              type="button"
              aria-label={`Remove ${p}`}
              onClick={() => onChange(products.filter((x) => x !== p))}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          id={id}
          list={`${id}-suggestions`}
          value={text}
          placeholder={products.length ? 'Add another…' : 'Type a product, press Enter'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              add()
            } else if (e.key === 'Backspace' && !text && products.length) {
              onChange(products.slice(0, -1))
            }
          }}
          onBlur={add}
          maxLength={100}
        />
        <datalist id={`${id}-suggestions`}>
          {suggestions
            .filter((s) => !products.includes(s))
            .map((s) => (
              <option key={s} value={s} />
            ))}
        </datalist>
      </div>
    </div>
  )
}

function EntryForm({ entries, date, setDate, onSaved }) {
  const existing = entries.find((e) => e.entry_date === date)
  const [form, setForm] = useState(emptyForm)
  const [copiedRoutine, setCopiedRoutine] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [saved, setSaved] = useState(false)

  const suggestions = useMemo(() => {
    const names = new Map()
    for (const e of entries) {
      for (const p of [...e.morning_products, ...e.evening_products]) {
        if (!names.has(p.toLowerCase())) names.set(p.toLowerCase(), p)
      }
    }
    return [...names.values()].sort((a, b) => a.localeCompare(b))
  }, [entries])

  // Load the entry for the chosen date, or start a new one with the last routine copied over
  useEffect(() => {
    setError(null)
    setSaved(false)
    if (existing) {
      setForm(formFromEntry(existing))
      setCopiedRoutine(false)
      return
    }
    const last = entries.find((e) => e.entry_date < date) ?? entries[0]
    setForm({
      ...emptyForm,
      morning_products: last?.morning_products ?? [],
      evening_products: last?.evening_products ?? [],
    })
    setCopiedRoutine(Boolean(last))
    // Only reload when the date changes or the entry for it appears/disappears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, existing?.updated_at])

  const set = (key) => (value) => {
    setSaved(false)
    setForm((f) => ({ ...f, [key]: value }))
  }

  const sleep = Number(form.sleep_hours)
  const sleepValid = form.sleep_hours !== '' && sleep >= 0 && sleep <= 24
  const canSave = form.rating != null && sleepValid && date && !saving

  async function save(e) {
    e.preventDefault()
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const entry = await api(`/entries/${date}`, {
        method: 'PUT',
        body: JSON.stringify({ ...form, sleep_hours: sleep }),
      })
      onSaved(entry)
      setSaved(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="card entry-form" onSubmit={save}>
      <div className="form-header">
        <h2>{existing ? 'Edit entry' : 'Log your day'}</h2>
        <input
          type="date"
          aria-label="Entry date"
          value={date}
          max={todayLocal()}
          onChange={(e) => setDate(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <span className="label">Skin today (1 = worst, 10 = best)</span>
        <div className="rating-picker" role="radiogroup" aria-label="Skin rating">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={form.rating === n}
              className={form.rating === n ? `${ratingClass(n)} selected` : 'rating-option'}
              onClick={() => set('rating')(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <ProductInput
        id="morning"
        label="Morning products"
        products={form.morning_products}
        onChange={set('morning_products')}
        suggestions={suggestions}
      />
      <ProductInput
        id="evening"
        label="Evening products"
        products={form.evening_products}
        onChange={set('evening_products')}
        suggestions={suggestions}
      />
      {copiedRoutine && !existing && (
        <p className="hint">Products copied from your last entry. Edit them if today was different.</p>
      )}

      <div className="field">
        <label htmlFor="food">What you ate</label>
        <textarea
          id="food"
          rows={2}
          value={form.food}
          onChange={(e) => set('food')(e.target.value)}
          placeholder="e.g. oats, chicken salad, pizza, chocolate"
          maxLength={2000}
        />
      </div>

      <div className="field">
        <label htmlFor="sleep">Hours slept</label>
        <input
          id="sleep"
          type="number"
          inputMode="decimal"
          min={0}
          max={24}
          step={0.5}
          value={form.sleep_hours}
          onChange={(e) => set('sleep_hours')(e.target.value)}
          className="sleep-input"
          required
        />
      </div>

      <div className="field">
        <label htmlFor="notes">
          Notes <span className="muted">(optional)</span>
        </label>
        <textarea
          id="notes"
          rows={2}
          value={form.notes}
          onChange={(e) => set('notes')(e.target.value)}
          placeholder="Breakouts, dryness, stress, period, weather…"
          maxLength={2000}
        />
      </div>

      {error && <p className="error">Couldn't save: {error}</p>}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={!canSave}>
          {saving ? 'Saving…' : existing ? 'Save changes' : 'Save entry'}
        </button>
        {saved && <span className="muted">Saved ✓</span>}
        {form.rating == null && <span className="muted">Pick a skin rating to save</span>}
      </div>
    </form>
  )
}

function EntryCard({ entry, onEdit, onDelete }) {
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="card entry">
      <div className="entry-top">
        <span className={ratingClass(entry.rating)} title="Skin rating">
          {entry.rating}
        </span>
        <strong>{formatDate(entry.entry_date)}</strong>
        <span className="muted">😴 {entry.sleep_hours}h</span>
        <div className="entry-actions">
          {confirming ? (
            <>
              <button className="danger" onClick={() => onDelete(entry)}>
                Delete
              </button>
              <button onClick={() => setConfirming(false)}>Cancel</button>
            </>
          ) : (
            <>
              <button onClick={() => onEdit(entry)}>Edit</button>
              <button onClick={() => setConfirming(true)} aria-label="Delete entry">
                ✕
              </button>
            </>
          )}
        </div>
      </div>
      {entry.morning_products.length > 0 && (
        <p>
          <span className="label">☀️ Morning</span> {entry.morning_products.join(', ')}
        </p>
      )}
      {entry.evening_products.length > 0 && (
        <p>
          <span className="label">🌙 Evening</span> {entry.evening_products.join(', ')}
        </p>
      )}
      {entry.food && (
        <p>
          <span className="label">🍽️ Ate</span> {entry.food}
        </p>
      )}
      {entry.notes && <p className="notes">{entry.notes}</p>}
    </li>
  )
}

function PatternList({ title, patterns }) {
  if (patterns.length === 0) return null
  return (
    <div className="patterns">
      <h4>{title}</h4>
      <ul>
        {patterns.map((p, i) => (
          <li key={i} className={`pattern ${p.effect}`}>
            <div className="pattern-top">
              <strong>{p.factor}</strong>
              <span className="chip">{p.kind}</span>
              <span className={`chip confidence-${p.confidence}`}>{p.confidence} confidence</span>
            </div>
            <p>{p.evidence}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}

function Analysis({ entryCount }) {
  const [analysis, setAnalysis] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api('/analyses/latest')
      .then(setAnalysis)
      .catch(() => {})
  }, [])

  async function analyze() {
    setRunning(true)
    setError(null)
    try {
      setAnalysis(await api('/analyze', { method: 'POST' }))
    } catch (err) {
      setError(err.message)
    } finally {
      setRunning(false)
    }
  }

  const needed = MIN_ENTRIES - entryCount
  const result = analysis?.result

  return (
    <section className="card analysis">
      <div className="form-header">
        <h2>Patterns</h2>
        <button className="primary" onClick={analyze} disabled={running || needed > 0}>
          {running ? 'Analyzing…' : analysis ? 'Analyze again' : 'Analyze'}
        </button>
      </div>
      {needed > 0 ? (
        <p className="muted">
          Log {needed} more day{needed === 1 ? '' : 's'} to unlock analysis. Claude looks at your
          last 90 days of entries to find which products, foods and sleep habits line up with
          better or worse skin.
        </p>
      ) : (
        !analysis &&
        !running && (
          <p className="muted">
            Claude will look at your last 90 days of entries for products, foods and sleep habits
            that line up with better or worse skin.
          </p>
        )
      )}
      {running && <p className="muted">Reading your diary… this can take a minute.</p>}
      {error && <p className="error">{error}</p>}

      {result && (
        <div className="analysis-result">
          {analysis.model === 'placeholder' && (
            <p className="placeholder-banner">
              <strong>Placeholder results.</strong> These patterns are randomly generated to
              preview the layout. They are not based on your skin. Real analysis by Claude turns
              on once an API key is connected.
            </p>
          )}
          <p className="muted small">
            Based on {analysis.entry_count} entries, {formatDate(analysis.date_from)} –{' '}
            {formatDate(analysis.date_to)} · analyzed{' '}
            {new Date(analysis.created_at).toLocaleString(undefined, {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
          </p>
          <p>{result.summary}</p>
          <PatternList
            title="Lines up with better skin"
            patterns={result.patterns.filter((p) => p.effect === 'better')}
          />
          <PatternList
            title="Lines up with worse skin"
            patterns={result.patterns.filter((p) => p.effect === 'worse')}
          />
          {result.patterns.length === 0 && <p className="muted">No clear patterns yet.</p>}
          {result.suggestions.length > 0 && (
            <>
              <h4>Things to try</h4>
              <ul className="suggestions">
                {result.suggestions.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </>
          )}
          {result.caveats && <p className="caveats">{result.caveats}</p>}
        </div>
      )}
    </section>
  )
}

export default function SkinDiary() {
  const [entries, setEntries] = useState([])
  const [date, setDate] = useState(todayLocal())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    api('/entries')
      .then(setEntries)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  function onSaved(entry) {
    setEntries((es) =>
      [...es.filter((e) => e.entry_date !== entry.entry_date), entry].sort((a, b) =>
        b.entry_date.localeCompare(a.entry_date),
      ),
    )
  }

  async function onDelete(entry) {
    try {
      await api(`/entries/${entry.entry_date}`, { method: 'DELETE' })
      setEntries((es) => es.filter((e) => e.entry_date !== entry.entry_date))
    } catch (e) {
      setError(e.message)
    }
  }

  function onEdit(entry) {
    setDate(entry.entry_date)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="diary">
      {loading ? (
        <p>Loading…</p>
      ) : (
        <EntryForm entries={entries} date={date} setDate={setDate} onSaved={onSaved} />
      )}

      {!loading && <Analysis entryCount={entries.length} />}

      <section>
        <h2>History</h2>
        {error && <p className="error">Something went wrong: {error}</p>}
        {!loading && entries.length === 0 && (
          <p className="muted">No entries yet. Log your first day above.</p>
        )}
        <ul className="entries">
          {entries.map((entry) => (
            <EntryCard key={entry.entry_date} entry={entry} onEdit={onEdit} onDelete={onDelete} />
          ))}
        </ul>
      </section>
    </div>
  )
}
