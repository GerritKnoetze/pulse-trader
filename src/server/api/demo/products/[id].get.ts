export default defineEventHandler((event) => {
  requireDemoAuth(event)

  const id = getRouterParam(event, 'id')
  const product = demoProducts.find((p) => p.id === id)

  if (!product) {
    throw createError({
      statusCode: 404,
      statusMessage: 'Not Found',
      message: `Product with id "${id}" not found.`,
    })
  }

  return { data: product }
})
