import { useEffect, useState } from 'react'
import SkinDiary from './SkinDiary.jsx'
import TodoLists from './TodoLists.jsx'

const pages = { diary: 'Skin diary', todos: 'To-dos' }

// The page lives in the URL hash (#diary, #todos) so links and refreshes keep it
function pageFromHash() {
  const page = window.location.hash.slice(1)
  return page in pages ? page : 'diary'
}

export default function App() {
  const [page, setPage] = useState(pageFromHash)

  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <main>
      <header className="app-header">
        <h1>Anastasiabeauty</h1>
        <nav className="page-nav">
          {Object.entries(pages).map(([key, label]) => (
            <a key={key} href={`#${key}`} className={page === key ? 'active' : ''}>
              {label}
            </a>
          ))}
        </nav>
      </header>
      {page === 'diary' ? <SkinDiary /> : <TodoLists />}
    </main>
  )
}
