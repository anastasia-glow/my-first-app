import { useEffect, useState } from 'react'

async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.status === 204 ? null : res.json()
}

export default function App() {
  const [todos, setTodos] = useState([])
  const [title, setTitle] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/todos')
      .then(setTodos)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  async function addTodo(e) {
    e.preventDefault()
    if (!title.trim()) return
    try {
      const todo = await api('/todos', { method: 'POST', body: JSON.stringify({ title }) })
      setTodos((t) => [...t, todo])
      setTitle('')
    } catch (e) {
      setError(e.message)
    }
  }

  async function toggleTodo(todo) {
    try {
      const updated = await api(`/todos/${todo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ done: !todo.done }),
      })
      setTodos((t) => t.map((x) => (x.id === updated.id ? updated : x)))
    } catch (e) {
      setError(e.message)
    }
  }

  async function deleteTodo(todo) {
    try {
      await api(`/todos/${todo.id}`, { method: 'DELETE' })
      setTodos((t) => t.filter((x) => x.id !== todo.id))
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <main>
      <h1>my-first-app</h1>

      <form onSubmit={addTodo}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs doing?"
          maxLength={200}
        />
        <button type="submit">Add</button>
      </form>

      {error && <p className="error">Something went wrong: {error}</p>}
      {loading && <p>Loading…</p>}
      {!loading && todos.length === 0 && <p className="muted">Nothing to do yet.</p>}

      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <label className={todo.done ? 'done' : ''}>
              <input type="checkbox" checked={todo.done} onChange={() => toggleTodo(todo)} />
              {todo.title}
            </label>
            <button className="delete" onClick={() => deleteTodo(todo)} aria-label="Delete">
              ✕
            </button>
          </li>
        ))}
      </ul>
    </main>
  )
}
