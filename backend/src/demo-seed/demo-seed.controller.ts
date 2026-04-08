import { Controller, Post, Get, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DemoSeedService } from './demo-seed.service';

@Controller('demo-seed')
@UseGuards(JwtAuthGuard)
export class DemoSeedController {
  constructor(private readonly service: DemoSeedService) {}

  @Post('activate')
  seedActivity(@Body() body: any) {
    return this.service.seedActivityData();
  }

  @Get('status')
  getStatus() {
    return this.service.getDataStatus();
  }
}
