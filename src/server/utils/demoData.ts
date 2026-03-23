export interface DemoProduct {
  id: string
  name: string
  price: number
  category: string
  description: string
  inStock: boolean
  createdAt: string
  updatedAt: string
}

// In-memory store — resets on server restart (demo only)
export const demoProducts: DemoProduct[] = [
  {
    id: '1',
    name: 'Widget Pro',
    price: 29.99,
    category: 'Widgets',
    description: 'A professional-grade widget for everyday use.',
    inStock: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  },
  {
    id: '2',
    name: 'Gadget Elite',
    price: 99.99,
    category: 'Gadgets',
    description: 'Top-tier gadget designed for power users.',
    inStock: true,
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
  },
  {
    id: '3',
    name: 'Doohickey Standard',
    price: 14.99,
    category: 'Accessories',
    description: 'Reliable standard doohickey for any scenario.',
    inStock: false,
    createdAt: '2026-02-01T00:00:00Z',
    updatedAt: '2026-02-01T00:00:00Z',
  },
  {
    id: '4',
    name: 'Thingamajig Plus',
    price: 49.99,
    category: 'Widgets',
    description: 'Enhanced thingamajig with extended capabilities.',
    inStock: true,
    createdAt: '2026-02-15T00:00:00Z',
    updatedAt: '2026-02-15T00:00:00Z',
  },
  {
    id: '5',
    name: 'Doodad Lite',
    price: 9.99,
    category: 'Accessories',
    description: 'A lightweight doodad for simple tasks.',
    inStock: true,
    createdAt: '2026-03-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
  },
]

let _nextId = 6
export function nextDemoId(): string {
  return String(_nextId++)
}
