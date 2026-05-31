import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { countryCode } = body as { countryCode?: string };

    if (!countryCode || typeof countryCode !== 'string') {
      return NextResponse.json({ ok: false, error: 'countryCode is required' }, { status: 400 });
    }

    const code = countryCode.toUpperCase();

    const country = await prisma.country.findUnique({ where: { code } });
    if (!country) {
      return NextResponse.json({ ok: false, error: `Country ${code} not found` }, { status: 404 });
    }

    const pipeline = await prisma.pipeline.upsert({
      where: { countryId: country.id },
      update: { status: 'active', updatedAt: new Date() },
      create: { countryId: country.id, status: 'active', clicks: 0, conversions: 0 },
      include: { country: { select: { code: true, name: true } } },
    });

    return NextResponse.json({
      ok: true,
      message: `Pipeline activated for ${country.name}`,
      pipeline: { id: pipeline.id, country: pipeline.country, status: pipeline.status },
    });
  } catch (err) {
    console.error('[pipeline/activate]', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
