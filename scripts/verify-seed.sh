#!/bin/bash
set -e
cd /var/www/interviewpro-v2

echo '=== DB Schema Push ==='
npx prisma db push --skip-generate

echo '=== Running Seed ==='
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed.ts 2>/dev/null || \
  npx prisma db seed 2>/dev/null || \
  node -r ts-node/register prisma/seed.ts

echo '=== Verification ==='
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
Promise.all([
  p.country.count(),
  p.city.count(),
  p.university.count(),
]).then(([countries, cities, universities]) => {
  console.log('Countries   :', countries);
  console.log('Cities      :', cities);
  console.log('Universities:', universities);
  if (countries === 0) { console.error('ERROR: No countries found'); process.exit(1); }
  console.log('OK - Seed verified');
}).finally(() => p.\$disconnect());
"
