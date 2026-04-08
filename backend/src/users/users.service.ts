import { Injectable, NotFoundException, ConflictException, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../database/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

const BCRYPT_ROUNDS = 12;

/** Fields returned in list/detail queries (never expose password) */
const USER_SELECT = {
  id: true, email: true, firstName: true, lastName: true,
  role: true, phone: true, isActive: true,
  department: true, jobTitle: true, isCrewLeader: true,
  licenseNumber: true, licenseImageUrl: true, licenseExpiration: true,
  createdAt: true, updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private prisma: PrismaService) {}

  /** Create a new user with hashed password */
  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException(`Email ${dto.email} already registered`);

    const hashedPassword = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        ...dto,
        password: hashedPassword,
        licenseExpiration: dto.licenseExpiration ? new Date(dto.licenseExpiration) : undefined,
      },
      select: USER_SELECT,
    });

    this.logger.log(`User created: ${user.email} (${user.role})`);
    return user;
  }

  /** List all active users (for SUPERADMIN/OPERATIONS) */
  async findAll() {
    return this.prisma.user.findMany({
      where: { deletedAt: null, isActive: true },
      select: {
        ...USER_SELECT,
        assignedVehicle: { select: { id: true, plateNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Get a single user with full details */
  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        ...USER_SELECT,
        assignedVehicle: { select: { id: true, plateNumber: true, brand: true, model: true } },
      },
    });
    if (!user) throw new NotFoundException(`User ${id} not found`);
    return user;
  }

  /** Update user fields (password not changeable here) */
  async update(id: string, dto: UpdateUserDto) {
    await this.findOne(id);

    // If email changed, check uniqueness
    if (dto.email) {
      const existing = await this.prisma.user.findFirst({
        where: { email: dto.email, id: { not: id } },
      });
      if (existing) throw new ConflictException(`Email ${dto.email} already in use`);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data: {
        ...dto,
        licenseExpiration: dto.licenseExpiration ? new Date(dto.licenseExpiration) : undefined,
      },
      select: USER_SELECT,
    });

    this.logger.log(`User ${id} updated`);
    return updated;
  }

  /** Toggle user active status */
  async toggleActive(id: string) {
    const user = await this.findOne(id);
    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive: !user.isActive },
      select: USER_SELECT,
    });
    this.logger.log(`User ${id} ${updated.isActive ? 'activated' : 'deactivated'}`);
    return updated;
  }

  /** Soft-delete a user */
  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
    this.logger.log(`User ${id} soft-deleted`);
  }
}
