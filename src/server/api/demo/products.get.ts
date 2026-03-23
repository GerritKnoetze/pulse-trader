export default defineEventHandler((event) => {
  requireDemoAuth(event)

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 10))
  const search = String(query.search || '').toLowerCase().trim()

  let filtered = demoProducts
  if (search) {
    filtered = filtered.filter(
      (p) =>
        p.name.toLowerCase().includes(search) ||
        p.category.toLowerCase().includes(search) ||
        p.description.toLowerCase().includes(search),
    )
  }

  const total = filtered.length
  const items = filtered.slice((page - 1) * limit, page * limit)

  return {
    data: items,
    meta: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  }
})
