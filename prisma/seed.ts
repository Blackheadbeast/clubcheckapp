import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

const prisma = new PrismaClient()

const DEMO_OWNER_ID = 'demo-owner-00000000-0000-0000-0000'
const DEMO_EMAIL = 'demo@clubcheckapp.com'
const DEMO_PASSWORD = 'demo1234' // Simple password for demo

function generateQrCode(): string {
  return `clubcheck-member-${crypto.randomUUID()}`
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
}

const memberNames = [
  'Alex Johnson', 'Sarah Williams', 'Mike Chen', 'Emily Davis', 'Chris Martinez',
  'Jessica Brown', 'David Wilson', 'Amanda Taylor', 'Ryan Anderson', 'Michelle Thomas',
  'Kevin Lee', 'Rachel Garcia', 'Jason Rodriguez', 'Stephanie Miller', 'Brandon White',
  'Nicole Harris', 'Justin Clark', 'Ashley Lewis', 'Tyler Robinson', 'Samantha Walker',
  'Andrew Hall', 'Lauren Young', 'Matthew King', 'Megan Wright', 'Daniel Scott',
]

async function main() {
  console.log('🌱 Starting seed...')

  // Check if demo owner already exists
  const existingDemo = await prisma.owner.findUnique({
    where: { id: DEMO_OWNER_ID },
  })

  if (existingDemo) {
    console.log('Demo owner already exists, cleaning up old data...')
    // Clean up old demo data
    await prisma.checkin.deleteMany({ where: { ownerId: DEMO_OWNER_ID } })
    await prisma.member.deleteMany({ where: { ownerId: DEMO_OWNER_ID } })
    await prisma.billingEvent.deleteMany({ where: { ownerId: DEMO_OWNER_ID } })
    await prisma.paymentRecord.deleteMany({ where: { ownerId: DEMO_OWNER_ID } })
    await prisma.invoiceRecord.deleteMany({ where: { ownerId: DEMO_OWNER_ID } })
    await prisma.referral.deleteMany({ where: { ownerId: DEMO_OWNER_ID } })
    await prisma.gymProfile.deleteMany({ where: { ownerId: DEMO_OWNER_ID } })
    await prisma.owner.delete({ where: { id: DEMO_OWNER_ID } })
  }

  // Create demo owner
  const hashedPassword = await bcrypt.hash(DEMO_PASSWORD, 10)

  const demoOwner = await prisma.owner.create({
    data: {
      id: DEMO_OWNER_ID,
      email: DEMO_EMAIL,
      password: hashedPassword,
      planType: 'pro',
      subscriptionStatus: 'active',
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
    },
  })

  console.log('✅ Created demo owner:', demoOwner.email)

  // Create gym profile
  await prisma.gymProfile.create({
    data: {
      ownerId: DEMO_OWNER_ID,
      name: 'FitLife Gym',
      address: '123 Fitness Avenue, Workout City, CA 90210',
      billingMode: 'stripe',
      kioskPinHash: await bcrypt.hash('1234', 10), // Demo kiosk PIN: 1234
    },
  })

  console.log('✅ Created gym profile')

  // Create referral
  await prisma.referral.create({
    data: {
      ownerId: DEMO_OWNER_ID,
      referralCode: 'DEMO-FITLIFE',
      creditedMonths: 2,
    },
  })

  console.log('✅ Created referral code')

  // Create members
  const members = []
  const now = new Date()
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)

  for (let i = 0; i < memberNames.length; i++) {
    const name = memberNames[i]
    const email = `${name.toLowerCase().replace(' ', '.')}@example.com`
    const statuses = ['active', 'active', 'active', 'active', 'inactive', 'paused']
    const status = statuses[Math.floor(Math.random() * statuses.length)]
    const createdAt = randomDate(threeMonthsAgo, now)

    const member = await prisma.member.create({
      data: {
        ownerId: DEMO_OWNER_ID,
        name,
        email,
        phone: `555-${String(1000 + i).padStart(4, '0')}`,
        status,
        qrCode: generateQrCode(),
        createdAt,
        lastCheckInAt: status === 'active' ? randomDate(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000), now) : null,
      },
    })
    members.push(member)
  }

  console.log(`✅ Created ${members.length} members`)

  // Create check-ins for the last 30 days
  let checkinCount = 0
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  for (const member of members) {
    if (member.status !== 'active') continue

    // Random number of check-ins per active member (5-20)
    const numCheckins = 5 + Math.floor(Math.random() * 15)

    for (let i = 0; i < numCheckins; i++) {
      const timestamp = randomDate(thirtyDaysAgo, now)
      const sources = ['qr', 'kiosk', 'manual', 'phone']
      const source = sources[Math.floor(Math.random() * sources.length)]

      await prisma.checkin.create({
        data: {
          ownerId: DEMO_OWNER_ID,
          memberId: member.id,
          timestamp,
          source,
        },
      })
      checkinCount++
    }
  }

  console.log(`✅ Created ${checkinCount} check-ins`)

  // Create some billing events
  await prisma.billingEvent.create({
    data: {
      ownerId: DEMO_OWNER_ID,
      type: 'payment_succeeded',
      message: 'Payment of $99.99 succeeded.',
      createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
      resolvedAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000),
    },
  })

  await prisma.billingEvent.create({
    data: {
      ownerId: DEMO_OWNER_ID,
      type: 'referral_credit',
      message: 'You earned 1 free month for referring a new gym!',
      createdAt: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000),
      resolvedAt: new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000),
    },
  })

  console.log('✅ Created billing events')

  console.log('')
  console.log('🎉 Seed completed!')
  console.log('')
  console.log('Demo credentials:')
  console.log(`  Email: ${DEMO_EMAIL}`)
  console.log(`  Password: ${DEMO_PASSWORD}`)
  console.log(`  Kiosk PIN: 1234`)
  console.log('')
}

main()
  .catch((e) => {
    console.error('Seed error:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
