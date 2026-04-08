import { Test, TestingModule } from '@nestjs/testing';
import { VehiclesService } from '../../src/vehicles/vehicles.service';
import { PrismaService } from '../../src/database/prisma.service';

describe('VehiclesService', () => {
  let service: VehiclesService;
  let prisma: PrismaService;

  const mockPrisma = {
    vehicle: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VehiclesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<VehiclesService>(VehiclesService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('should create a vehicle when plate is unique', async () => {
      mockPrisma.vehicle.findUnique.mockResolvedValue(null);
      mockPrisma.vehicle.create.mockResolvedValue({
        id: 'uuid-1',
        plateNumber: 'ABC-1234',
        brand: 'Toyota',
        model: 'Hilux',
        year: 2023,
      });

      const result = await service.create({
        plateNumber: 'ABC-1234',
        brand: 'Toyota',
        model: 'Hilux',
        year: 2023,
      });

      expect(result.plateNumber).toBe('ABC-1234');
      expect(mockPrisma.vehicle.create).toHaveBeenCalled();
    });
  });

  describe('getFleetSummary', () => {
    it('should return fleet counts', async () => {
      mockPrisma.vehicle.count
        .mockResolvedValueOnce(10)  // total
        .mockResolvedValueOnce(7)   // active
        .mockResolvedValueOnce(2)   // maintenance
        .mockResolvedValueOnce(1);  // inactive

      const result = await service.getFleetSummary();

      expect(result.total).toBe(10);
      expect(result.active).toBe(7);
    });
  });
});
