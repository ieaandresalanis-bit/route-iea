import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global database module — PrismaService is available everywhere
 * without needing to import this module in each feature module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
