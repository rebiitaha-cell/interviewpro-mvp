import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const COUNTRIES = [
  { code: 'FR', name: 'France', language: 'french' },
  { code: 'DE', name: 'Germany', language: 'german' },
  { code: 'GB', name: 'United Kingdom', language: 'english' },
  { code: 'ES', name: 'Spain', language: 'spanish' },
  { code: 'IT', name: 'Italy', language: 'italian' },
  { code: 'MA', name: 'Morocco', language: 'arabic' },
  { code: 'DZ', name: 'Algeria', language: 'arabic' },
  { code: 'TN', name: 'Tunisia', language: 'arabic' },
  { code: 'SN', name: 'Senegal', language: 'french' },
  { code: 'CM', name: 'Cameroon', language: 'french' },
  { code: 'CA', name: 'Canada', language: 'english' },
  { code: 'US', name: 'United States', language: 'english' },
  { code: 'BE', name: 'Belgium', language: 'dutch' },
  { code: 'CH', name: 'Switzerland', language: 'german' },
  { code: 'NL', name: 'Netherlands', language: 'dutch' },
  { code: 'PT', name: 'Portugal', language: 'portuguese' },
  { code: 'BR', name: 'Brazil', language: 'portuguese' },
  { code: 'MX', name: 'Mexico', language: 'spanish' },
  { code: 'TR', name: 'Turkey', language: 'turkish' },
  { code: 'PL', name: 'Poland', language: 'polish' },
];

const CITIES_BY_COUNTRY: Record<string, string[]> = {
  FR: ['Paris', 'Lyon', 'Marseille', 'Bordeaux', 'Lille'],
  DE: ['Berlin', 'Munich', 'Hamburg', 'Frankfurt', 'Cologne'],
  GB: ['London', 'Manchester', 'Birmingham', 'Edinburgh', 'Leeds'],
  ES: ['Madrid', 'Barcelona', 'Seville', 'Valencia', 'Bilbao'],
  IT: ['Rome', 'Milan', 'Naples', 'Turin', 'Florence'],
  MA: ['Casablanca', 'Rabat', 'Fez', 'Marrakech', 'Tangier'],
  DZ: ['Algiers', 'Oran', 'Constantine', 'Annaba', 'Blida'],
  TN: ['Tunis', 'Sfax', 'Sousse', 'Monastir', 'Bizerte'],
  SN: ['Dakar', 'Thiès', 'Saint-Louis', 'Ziguinchor', 'Kaolack'],
  CM: ['Douala', 'Yaoundé', 'Bamenda', 'Garoua', 'Bafoussam'],
  CA: ['Toronto', 'Montreal', 'Vancouver', 'Calgary', 'Ottawa'],
  US: ['New York', 'Los Angeles', 'Chicago', 'Houston', 'Phoenix'],
  BE: ['Brussels', 'Antwerp', 'Ghent', 'Liège', 'Bruges'],
  CH: ['Zurich', 'Geneva', 'Basel', 'Bern', 'Lausanne'],
  NL: ['Amsterdam', 'Rotterdam', 'The Hague', 'Utrecht', 'Eindhoven'],
  PT: ['Lisbon', 'Porto', 'Braga', 'Coimbra', 'Faro'],
  BR: ['São Paulo', 'Rio de Janeiro', 'Brasília', 'Salvador', 'Fortaleza'],
  MX: ['Mexico City', 'Guadalajara', 'Monterrey', 'Puebla', 'Tijuana'],
  TR: ['Istanbul', 'Ankara', 'Izmir', 'Bursa', 'Adana'],
  PL: ['Warsaw', 'Kraków', 'Wrocław', 'Poznań', 'Gdańsk'],
};

const UNIVERSITIES_BY_CITY: Record<string, string[]> = {
  Paris: ['Sorbonne University', 'Paris-Saclay University', 'Sciences Po Paris'],
  Lyon: ['University of Lyon', 'ENS Lyon'],
  Berlin: ['Humboldt University', 'Free University of Berlin', 'TU Berlin'],
  Munich: ['LMU Munich', 'TU Munich'],
  London: ['UCL', 'Imperial College London', 'King\'s College London', 'LSE'],
  Manchester: ['University of Manchester', 'Manchester Metropolitan University'],
  Madrid: ['Complutense University of Madrid', 'Autonomous University of Madrid'],
  Barcelona: ['University of Barcelona', 'Pompeu Fabra University'],
  Rome: ['Sapienza University of Rome', 'University of Rome Tor Vergata'],
  Milan: ['University of Milan', 'Bocconi University', 'Politecnico di Milano'],
  Casablanca: ['Hassan II University', 'ENCG Casablanca'],
  Rabat: ['Mohammed V University', 'UM5 Rabat'],
  Algiers: ['University of Algiers', 'USTHB Algiers'],
  Tunis: ['University of Tunis', 'Tunis El Manar University'],
  Dakar: ['Cheikh Anta Diop University', 'ISM Dakar'],
  Douala: ['University of Douala', 'IUT Douala'],
  Toronto: ['University of Toronto', 'York University', 'Ryerson University'],
  Montreal: ['McGill University', 'Université de Montréal'],
  Zurich: ['ETH Zurich', 'University of Zurich'],
  Amsterdam: ['University of Amsterdam', 'VU Amsterdam'],
};

async function main() {
  console.log('🌍 Seeding countries...');
  for (const c of COUNTRIES) {
    await prisma.country.upsert({
      where: { code: c.code },
      update: { name: c.name, language: c.language },
      create: c,
    });
  }
  const countryCount = await prisma.country.count();
  console.log(`✅ Countries: ${countryCount}`);

  console.log('🏙️  Seeding cities...');
  for (const [code, cities] of Object.entries(CITIES_BY_COUNTRY)) {
    const country = await prisma.country.findUnique({ where: { code } });
    if (!country) continue;
    for (const name of cities) {
      await prisma.city.upsert({
        where: { id: (await prisma.city.findFirst({ where: { name, countryId: country.id } }))?.id ?? -1 },
        update: {},
        create: { name, countryId: country.id },
      }).catch(() => prisma.city.create({ data: { name, countryId: country.id } }));
    }
  }
  const cityCount = await prisma.city.count();
  console.log(`✅ Cities: ${cityCount}`);

  console.log('🎓 Seeding universities...');
  for (const [cityName, univs] of Object.entries(UNIVERSITIES_BY_CITY)) {
    const city = await prisma.city.findFirst({ where: { name: cityName } });
    if (!city) continue;
    for (const name of univs) {
      const exists = await prisma.university.findFirst({ where: { name, cityId: city.id } });
      if (!exists) {
        await prisma.university.create({ data: { name, cityId: city.id } });
      }
    }
  }
  const univCount = await prisma.university.count();
  console.log(`✅ Universities: ${univCount}`);

  console.log('\n📊 Final counts:');
  console.log(`   Countries : ${await prisma.country.count()}`);
  console.log(`   Cities    : ${await prisma.city.count()}`);
  console.log(`   Universities: ${await prisma.university.count()}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
