import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MyDashboardService } from './my-dashboard.service';

@Controller('my-dashboard')
@UseGuards(JwtAuthGuard)
export class MyDashboardController {
  constructor(private readonly svc: MyDashboardService) {}

  @Get()
  getMyDashboard(@Req() req: any) {
    return this.svc.getMyDashboard(req.user.id);
  }
}
