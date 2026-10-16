export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    // FastAPI puts a readable message in `detail` for errors we raise ourselves
    const body = await res.json().catch(() => null)
    const detail = typeof body?.detail === 'string' ? body.detail : `${res.status} ${res.statusText}`
    throw new Error(detail)
  }
  return res.status === 204 ? null : res.json()
}
