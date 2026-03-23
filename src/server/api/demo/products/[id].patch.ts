export default defineEventHandler(async (event) => {
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

  const body = await readBody(event)
  const product = demoProducts[idx]

  if (body?.name !== undefined) product.name = String(body.name).trim()
  if (body?.price !== undefined) product.price = Number(body.price)
  if (body?.category !== undefined) product.category = String(body.category).trim()
  if (body?.description !== undefined) product.description = String(body.description).trim()
  if (body?.inStock !== undefined) product.inStock = Boolean(body.inStock)

  product.updatedAt = new Date().toISOString()

  return { data: product }
})
