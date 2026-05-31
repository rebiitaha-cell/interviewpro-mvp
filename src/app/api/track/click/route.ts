import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { countryCode, source, referrer } = body as {
      countryCode?: string;
      source?: string;
      referrer?: string;
    };

    if (!countryCode) {
      return NextResponse.json({ ok: false, error: 'countryCode is required' }, { status: 400 });
    }

    const code = countryCode.toUpperCase();
    const userAgent = req.headers.get('user-agent') ?? undefined;
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
      req.headers.get('x-real-ip') ??
      undefined;

    const country = await prisma.country.findUnique({ where: { code } });
    if (!country) {
      return NextResponse.json({ ok: false, error: `Country ${code} not found` }, { status: 404 });
    }

    const [click] = await prisma.$transaction([
      prisma.clickEvent.create({
        data: { countryId: country.id, source, referrer, userAgent, ip },
      }),
      prisma.pipeline.updateMany({
        where: { countryId: country.id, status: 'active' },
        data: { clicks: { increment: 1 } },
      }),
    ]);

    return NextResponse.json({ ok: true, clickId: click.id, country: code }, { status: 201 });
  } catch (err) {
    console.error('[track/click]', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
