import { NextRequest, NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { countryCode, clickId, type, value } = body as {
      countryCode?: string;
      clickId?: number;
      type?: string;
      value?: number;
    };

    if (!countryCode || !type) {
      return NextResponse.json(
        { ok: false, error: 'countryCode and type are required' },
        { status: 400 },
      );
    }

    const code = countryCode.toUpperCase();
    const validTypes = ['enrollment', 'application', 'signup', 'contact'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { ok: false, error: `type must be one of: ${validTypes.join(', ')}` },
        { status: 400 },
      );
    }

    const country = await prisma.country.findUnique({ where: { code } });
    if (!country) {
      return NextResponse.json({ ok: false, error: `Country ${code} not found` }, { status: 404 });
    }

    const [conversion] = await prisma.$transaction([
      prisma.conversionEvent.create({
        data: {
          countryId: country.id,
          clickEventId: clickId ?? null,
          type,
          value: value ?? null,
        },
      }),
      prisma.pipeline.updateMany({
        where: { countryId: country.id, status: 'active' },
        data: { conversions: { increment: 1 } },
      }),
    ]);

    return NextResponse.json(
      { ok: true, conversionId: conversion.id, country: code, type },
      { status: 201 },
    );
  } catch (err) {
    console.error('[track/conversion]', err);
    return NextResponse.json({ ok: false, error: 'Internal server error' }, { status: 500 });
  } finally {
    await prisma.$disconnect();
  }
}
