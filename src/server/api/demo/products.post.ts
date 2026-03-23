export default defineEventHandler(async (event) => {
  requireDemoAuth(event)

  const body = await readBody(event)

  if (!body?.name || typeof body.name !== 'string' || !body.name.trim()) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Unprocessable Entity',
      message: 'Field "name" is required and must be a non-empty string.',
    })
  }

  if (body.price === undefined || isNaN(Number(body.price))) {
    throw createError({
      statusCode: 422,
      statusMessage: 'Unprocessable Entity',
      message: 'Field "price" is required and must be a number.',
    })
  }

  const now = new Date().toISOString()
  const product: DemoProduct = {
    id: nextDemoId(),
    name: String(body.name).trim(),
    price: Number(body.price),
    category: String(body.category || 'Uncategorized').trim(),
    description: String(body.description || '').trim(),
    inStock: body.inStock !== undefined ? Boolean(body.inStock) : true,
    createdAt: now,
    updatedAt: now,
  }

  demoProducts.push(product)

  setResponseStatus(event, 201)
  return { data: product }
})
