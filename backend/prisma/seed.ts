import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Idempotent seed of realistic Amazon campaigns for local testing (run with
 * `npx prisma db seed`). Fixed ids + upsert, so re-running never duplicates and
 * edits here propagate. Categories are chosen to exercise the return-window
 * policy (electronics 10d, apparel 15d, "home" → default 7d), and one PAUSED
 * campaign proves the list endpoint filters by status.
 *
 * Money is integer paise (₹1,299 = 129900). Amazon only — the launch platform.
 */
const campaigns: Prisma.CampaignCreateInput[] = [
  {
    id: 'c0000000-0000-4000-8000-000000000001',
    platform: 'AMAZON',
    status: 'ACTIVE',
    title: 'Review the boAt Rockerz 255 Pro+',
    productName: 'boAt Rockerz 255 Pro+ Bluetooth Neckband Earphones',
    category: 'electronics',
    productPricePaise: 129900n, // ₹1,299
    payoutPercent: 100,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null, // falls back to the electronics policy (10 days)
    minRating: 4,
    totalSlots: 50,
    asin: 'B08TV2P5QL',
    productUrl: 'https://www.amazon.in/dp/B08TV2P5QL',
    imageUrl: 'https://m.media-amazon.com/images/I/hero-boat.jpg',
  },
  {
    id: 'c0000000-0000-4000-8000-000000000002',
    platform: 'AMAZON',
    status: 'ACTIVE',
    title: 'Review an Amazon Brand cotton T-shirt',
    productName: 'Symbol Men’s Regular Fit Cotton T-Shirt',
    category: 'apparel',
    productPricePaise: 59900n, // ₹599
    payoutPercent: 100,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null, // apparel policy (15 days)
    minRating: 3,
    totalSlots: 100,
    asin: 'B07WHS7MDT',
    productUrl: 'https://www.amazon.in/dp/B07WHS7MDT',
    imageUrl: 'https://m.media-amazon.com/images/I/hero-tshirt.jpg',
  },
  {
    id: 'c0000000-0000-4000-8000-000000000003',
    platform: 'AMAZON',
    status: 'ACTIVE',
    title: 'Review a Milton Thermosteel flask',
    productName: 'Milton Thermosteel Flip Lid Flask, 1 Litre',
    category: 'home', // not in the policy table → default 7-day window
    productPricePaise: 74900n, // ₹749
    payoutPercent: 90, // partial payout with a cap, to exercise the policy maths
    payoutCapPaise: 60000n, // ₹600 ceiling
    ticketCost: 5,
    returnWindowDays: null,
    minRating: 4,
    totalSlots: 30,
    asin: 'B00LREO3QK',
    productUrl: 'https://www.amazon.in/dp/B00LREO3QK',
    imageUrl: 'https://m.media-amazon.com/images/I/hero-flask.jpg',
  },
  {
    // Intentionally PAUSED: it must NOT appear in the active list, but is still
    // fetchable by id (a task on it can still show its campaign).
    id: 'c0000000-0000-4000-8000-000000000004',
    platform: 'AMAZON',
    status: 'PAUSED',
    title: 'Review a Prestige induction cooktop (paused)',
    productName: 'Prestige PIC 20 1600-Watt Induction Cooktop',
    category: 'electronics',
    productPricePaise: 189900n, // ₹1,899
    payoutPercent: 100,
    payoutCapPaise: null,
    ticketCost: 5,
    returnWindowDays: null,
    minRating: 4,
    totalSlots: 20,
    asin: 'B00LZFH3AC',
    productUrl: 'https://www.amazon.in/dp/B00LZFH3AC',
    imageUrl: 'https://m.media-amazon.com/images/I/hero-cooktop.jpg',
  },
];

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const campaign of campaigns) {
      const { id, ...data } = campaign;
      await prisma.campaign.upsert({
        where: { id },
        update: data,
        create: campaign,
      });
    }
    const active = campaigns.filter((c) => c.status === 'ACTIVE').length;
    console.log(
      `Seeded ${campaigns.length} campaigns (${active} active, ${campaigns.length - active} paused).`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
