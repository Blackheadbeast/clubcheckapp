import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

const prismaClientSingleton = () => {
  const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    // Each serverless instance keeps a small pool. Requests that fan out to many
    // parallel queries queue here instead of exhausting the database's connection limit.
    max: Number(process.env.DATABASE_POOL_MAX) || 5,
  })
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })
}

export const prisma = globalForPrisma.prisma ?? prismaClientSingleton()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

// Graceful shutdown
process.on('beforeExit', async () => {
  await prisma.$disconnect()
})
