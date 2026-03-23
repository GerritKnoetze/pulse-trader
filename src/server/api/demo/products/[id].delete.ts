export default defineEventHandler((event) => {
  requireDemoAuth(event)

  const id = getRouterParam(event, 'id')
  const idx = demoProducts.findIndex((p) => p.id === id)

  if (idx === -1) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `Product with id "${id}" not found.`,
    })
  }

  demoProducts.splice(idx, 1)

  return { success: true, message: `Product "${id}" has been deleted.` }
})
