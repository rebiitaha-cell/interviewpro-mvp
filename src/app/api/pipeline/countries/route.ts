import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { getLanguageForCountry, isRTL } from '@/lib/geoLanguage';

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get('active') !== 'false';
    const withPipeline = searchParams.get('pipeline') === 'true';

    const countries = await prisma.country.findMany({
      where: activeOnly ? { active: true } : {},
      include: withPipeline
        ? { pipeline: { select: { status: true, clicks: true, conversions: true } } }
        : undefined,
      orderBy: { name: 'asc' },
    });

    const enriched = countries.map((c) => ({
      code: c.code,
      name: c.name,
      language: c.language ?? getLanguageForCountry(c.code),
      rtl: isRTL(c.code),
      active: c.active,
      ...(withPipeline && 'pipeline' in c
        ? { pipeline: (c as typeof c & { pipeline: unknown }).pipeline }
        : {}),
    }));

    return NextResponse.json({ ok: true, count: enriched.length, countries: enriched });
  } catch (err) {
    console.error('[pipeline/countries]', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
