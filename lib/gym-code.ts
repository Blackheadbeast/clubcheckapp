import crypto from 'crypto'
import { prisma } from '@/lib/prisma'

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I,L,O,0,1

function generate(): string {
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += CHARS.charAt(crypto.randomInt(CHARS.length))
  }
  return code
}

export async function generateUniqueGymCode(): Promise<string> {
  let code = generate()
  let attempts = 0
  while (attempts < 10) {
    const existing = await prisma.owner.findUnique({
      where: { gymCode: code },
      select: { id: true },
    })
    if (!existing) return code
    code = generate()
    attempts++
  }
  return code
}
