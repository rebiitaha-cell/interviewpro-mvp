import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const countryCode = searchParams.get('country');

    const where = countryCode ? { country: { code: countryCode.toUpperCase() } } : {};

    const pipelines = await prisma.pipeline.findMany({
      where,
      include: {
        country: { select: { code: true, name: true, language: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const [totalClicks, totalConversions] = await Promise.all([
      prisma.clickEvent.count(where.country ? { where: { country: { code: countryCode! } } } : {}),
      prisma.conversionEvent.count(where.country ? { where: { country: { code: countryCode! } } } : {}),
    ]);

    const stats = pipelines.map((p) => ({
      id: p.id,
      country: p.country,
      status: p.status,
      clicks: p.clicks,
      conversions: p.conversions,
      conversionRate:
        p.clicks > 0 ? ((p.conversions / p.clicks) * 100).toFixed(2) + '%' : '0.00%',
      updatedAt: p.updatedAt,
    }));

    return NextResponse.json({
      ok: true,
      total: { pipelines: pipelines.length, clicks: totalClicks, conversions: totalConversions },
      stats,
    });
  } catch (err) {
    console.error('[pipeline/stats]', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
