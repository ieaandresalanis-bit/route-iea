import { PrismaClient, UserRole, VehicleType, FuelType } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...\n');

  const password = await bcrypt.hash('Admin123!', 12);

  // ── Users ───────────────────────────────────────────────────
  const admin = await prisma.user.upsert({
    where: { email: 'admin@iea.com' },
    update: { role: UserRole.SUPERADMIN },
    create: {
      email: 'admin@iea.com',
      password,
      firstName: 'Andres',
      lastName: 'Alanis',
      role: UserRole.SUPERADMIN,
      phone: '+52 33 1234 5678',
      department: 'Direccion',
      jobTitle: 'Director General',
    },
  });
  console.log(`  User: ${admin.email} (${admin.role})`);

  const operations = await prisma.user.upsert({
    where: { email: 'supervisor@iea.com' },
    update: { role: UserRole.OPERATIONS },
    create: {
      email: 'supervisor@iea.com',
      password,
      firstName: 'Carlos',
      lastName: 'Lopez',
      role: UserRole.OPERATIONS,
      department: 'Operaciones',
      jobTitle: 'Supervisor de Campo',
    },
  });
  console.log(`  User: ${operations.email} (${operations.role})`);

  const operators = await Promise.all(
    [
      {
        email: 'juan.perez@iea.com', firstName: 'Juan', lastName: 'Perez',
        department: 'Campo', jobTitle: 'Tecnico Electricista', isCrewLeader: true,
        licenseNumber: 'LIC-GDL-10001', licenseExpiration: new Date('2027-06-30'),
      },
      {
        email: 'maria.garcia@iea.com', firstName: 'Maria', lastName: 'Garcia',
        department: 'Campo', jobTitle: 'Tecnico Electricista',
        licenseNumber: 'LIC-GDL-10002', licenseExpiration: new Date('2027-03-15'),
      },
      {
        email: 'pedro.martinez@iea.com', firstName: 'Pedro', lastName: 'Martinez',
        department: 'Campo', jobTitle: 'Ayudante General',
        licenseNumber: 'LIC-GDL-10003', licenseExpiration: new Date('2026-12-01'),
      },
    ].map((op) =>
      prisma.user.upsert({
        where: { email: op.email },
        update: { role: UserRole.OPERATOR, department: op.department, jobTitle: op.jobTitle },
        create: { ...op, password, role: UserRole.OPERATOR },
      }),
    ),
  );
  operators.forEach((op) => console.log(`  User: ${op.email} (OPERATOR)`));

  // ── Vehicles ────────────────────────────────────────────────
  const vehicles = await Promise.all(
    [
      { plateNumber: 'JMH-1234', brand: 'Toyota', model: 'Hilux', year: 2023, type: VehicleType.PICKUP, fuelType: FuelType.GASOLINE, tankCapacity: 80, color: 'White', driverId: operators[0].id },
      { plateNumber: 'KRT-5678', brand: 'Nissan', model: 'NP300', year: 2022, type: VehicleType.PICKUP, fuelType: FuelType.DIESEL, tankCapacity: 73, color: 'Silver', driverId: operators[1].id },
      { plateNumber: 'LMN-9012', brand: 'Ford', model: 'Transit', year: 2024, type: VehicleType.VAN, fuelType: FuelType.GASOLINE, tankCapacity: 82, color: 'Blue', driverId: operators[2].id },
      { plateNumber: 'PQR-3456', brand: 'Chevrolet', model: 'Silverado', year: 2023, type: VehicleType.TRUCK, fuelType: FuelType.DIESEL, tankCapacity: 98, color: 'Black' },
      { plateNumber: 'STU-7890', brand: 'Toyota', model: 'Corolla', year: 2024, type: VehicleType.CAR, fuelType: FuelType.HYBRID, tankCapacity: 50, color: 'Red' },
    ].map((v) =>
      prisma.vehicle.upsert({
        where: { plateNumber: v.plateNumber },
        update: {},
        create: v,
      }),
    ),
  );
  vehicles.forEach((v) => console.log(`  Vehicle: ${v.plateNumber} — ${v.brand} ${v.model}`));

  // ── Sample Trip ─────────────────────────────────────────────
  await prisma.trip.deleteMany({});
  const trip = await prisma.trip.create({
    data: {
      title: 'Service call - Zapopan industrial zone',
      description: 'Electrical maintenance at Zapopan factory',
      originLat: 20.6636914,
      originLng: -103.2343897,
      originAddress: 'IEA HQ, Guadalajara',
      destLat: 20.7214,
      destLng: -103.3841,
      destAddress: 'Zona Industrial Zapopan',
      plannedDistanceKm: 25,
      vehicleId: vehicles[0].id,
      driverId: operators[0].id,
    },
  });
  console.log(`  Trip: ${trip.title}`);

  console.log('\nSeed complete.\n');
  console.log('Login credentials:');
  console.log('  Email:    admin@iea.com');
  console.log('  Password: Admin123!\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
