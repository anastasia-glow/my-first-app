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
  const [lists, setLists] = useState([])
  const [selectedId, setSelectedId] = useState(null)
  const [todos, setTodos] = useState([])
  const [newListName, setNewListName] = useState('')
  const [title, setTitle] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  const selected = lists.find((l) => l.id === selectedId)

  useEffect(() => {
    api('/lists')
      .then((lists) => {
        setLists(lists)
        setSelectedId(lists[0]?.id ?? null)
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    setRenaming(false)
    setConfirmingDelete(false)
    if (selectedId == null) {
      setTodos([])
      return
    }
    // Ignore a slow response for a list the user has already switched away from
    let current = true
    api(`/lists/${selectedId}/todos`)
      .then((todos) => current && setTodos(todos))
      .catch((e) => current && setError(e.message))
    return () => {
      current = false
    }
  }, [selectedId])

  // Keep the open-count badge on the selected tab in step with its todos
  function updateCounts(listId, nextTodos) {
    setLists((ls) =>
      ls.map((l) =>
        l.id === listId
          ? { ...l, todo_count: nextTodos.length, open_count: nextTodos.filter((t) => !t.done).length }
          : l,
      ),
    )
  }

  function changeTodos(update) {
    setTodos((t) => {
      const next = update(t)
      updateCounts(selectedId, next)
      return next
    })
  }

  async function run(action) {
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(e.message)
    }
  }

  const addList = (e) => {
    e.preventDefault()
    if (!newListName.trim()) return
    run(async () => {
      const list = await api('/lists', { method: 'POST', body: JSON.stringify({ name: newListName }) })
      setLists((ls) => [...ls, list])
      setSelectedId(list.id)
      setNewListName('')
    })
  }

  const renameList = (e) => {
    e.preventDefault()
    if (!renameValue.trim()) return
    run(async () => {
      const updated = await api(`/lists/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: renameValue }),
      })
      setLists((ls) => ls.map((l) => (l.id === updated.id ? { ...l, name: updated.name } : l)))
      setRenaming(false)
    })
  }

  const deleteList = () =>
    run(async () => {
      await api(`/lists/${selectedId}`, { method: 'DELETE' })
      const remaining = lists.filter((l) => l.id !== selectedId)
      setLists(remaining)
      setSelectedId(remaining[0]?.id ?? null)
    })

  const addTodo = (e) => {
    e.preventDefault()
    if (!title.trim()) return
    run(async () => {
      const todo = await api(`/lists/${selectedId}/todos`, {
        method: 'POST',
        body: JSON.stringify({ title }),
      })
      changeTodos((t) => [...t, todo])
      setTitle('')
    })
  }

  const toggleTodo = (todo) =>
    run(async () => {
      const updated = await api(`/todos/${todo.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ done: !todo.done }),
      })
      changeTodos((t) => t.map((x) => (x.id === updated.id ? updated : x)))
    })

  const deleteTodo = (todo) =>
    run(async () => {
      await api(`/todos/${todo.id}`, { method: 'DELETE' })
      changeTodos((t) => t.filter((x) => x.id !== todo.id))
    })

  return (
    <main>
      <h1>my-first-app</h1>

      <nav className="tabs">
        {lists.map((list) => (
          <button
            key={list.id}
            className={list.id === selectedId ? 'tab active' : 'tab'}
            onClick={() => setSelectedId(list.id)}
          >
            {list.name}
            {list.open_count > 0 && <span className="badge">{list.open_count}</span>}
          </button>
        ))}
      </nav>

      <form onSubmit={addList}>
        <input
          value={newListName}
          onChange={(e) => setNewListName(e.target.value)}
          placeholder="New list name"
          maxLength={100}
        />
        <button type="submit">New list</button>
      </form>

      {error && <p className="error">Something went wrong: {error}</p>}
      {loading && <p>Loading…</p>}
      {!loading && lists.length === 0 && (
        <p className="muted">No lists yet. Create one above to get started.</p>
      )}

      {selected && (
        <section>
          <header className="list-header">
            {renaming ? (
              <form onSubmit={renameList}>
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  maxLength={100}
                  autoFocus
                />
                <button type="submit">Save</button>
                <button type="button" onClick={() => setRenaming(false)}>
                  Cancel
                </button>
              </form>
            ) : confirmingDelete ? (
              <div className="confirm">
                <span>
                  Delete “{selected.name}”
                  {selected.todo_count > 0 && ` and its ${selected.todo_count} to-do${selected.todo_count === 1 ? '' : 's'}`}?
                </span>
                <button className="danger" onClick={deleteList}>
                  Delete
                </button>
                <button onClick={() => setConfirmingDelete(false)}>Cancel</button>
              </div>
            ) : (
              <>
                <h2>{selected.name}</h2>
                <div className="actions">
                  <button
                    onClick={() => {
                      setRenameValue(selected.name)
                      setRenaming(true)
                    }}
                  >
                    Rename
                  </button>
                  <button onClick={() => setConfirmingDelete(true)}>Delete list</button>
                </div>
              </>
            )}
          </header>

          <form onSubmit={addTodo}>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="What needs doing?"
              maxLength={200}
            />
            <button type="submit">Add</button>
          </form>

          {todos.length === 0 && <p className="muted">Nothing to do yet.</p>}

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
        </section>
      )}
    </main>
  )
}
