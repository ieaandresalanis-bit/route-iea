import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

// Core
import configuration from './config/configuration';
import { PrismaModule } from './database/prisma.module';

// Feature modules
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { TripsModule } from './trips/trips.module';
import { GpsModule } from './gps/gps.module';
import { FuelModule } from './fuel/fuel.module';
import { OdometerModule } from './odometer/odometer.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';

// Sales & CRM
import { LeadsModule } from './leads/leads.module';
import { RoutesModule } from './routes/routes.module';
import { VisitsModule } from './visits/visits.module';
import { SalesDashboardModule } from './sales-dashboard/sales-dashboard.module';
import { SalesOpsModule } from './sales-ops/sales-ops.module';
import { WorkPlanModule } from './work-plan/work-plan.module';
import { AutomationEngineModule } from './automation-engine/automation-engine.module';
import { CommercialDirectorModule } from './commercial-director/commercial-director.module';
import { SalesCoachModule } from './sales-coach/sales-coach.module';
import { CommercialPlannerModule } from './commercial-planner/commercial-planner.module';
import { CampaignAttributionModule } from './campaign-attribution/campaign-attribution.module';
import { CampaignIntelligenceModule } from './campaign-intelligence/campaign-intelligence.module';
import { AlertIntelligenceModule } from './alert-intelligence/alert-intelligence.module';
import { ExecutionEngineModule } from './execution-engine/execution-engine.module';
import { FollowUpAutomationModule } from './followup-automation/followup-automation.module';
import { AutomationPerformanceModule } from './automation-performance/automation-performance.module';
import { AiAgentsModule } from './ai-agents/ai-agents.module';
import { ClientLifecycleModule } from './client-lifecycle/client-lifecycle.module';
import { CommercialScoutingModule } from './commercial-scouting/commercial-scouting.module';
import { ZohoSyncModule } from './zoho-sync/zoho-sync.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { DemoSeedModule } from './demo-seed/demo-seed.module';
import { TeamManagementModule } from './team-management/team-management.module';
import { FollowUpIntelligenceModule } from './follow-up-intelligence/follow-up-intelligence.module';
import { ExecutionDisciplineModule } from './execution-discipline/execution-discipline.module';
import { MultiChannelModule } from './multi-channel/multi-channel.module';
import { SupervisorAgentModule } from './supervisor-agent/supervisor-agent.module';
import { ExecutionOrchestrationModule } from './execution-orchestration/execution-orchestration.module';
import { CustomerSuccessModule } from './customer-success/customer-success.module';
import { DealClosingModule } from './deal-closing/deal-closing.module';
import { RevenueIntelligenceModule } from './revenue-intelligence/revenue-intelligence.module';
import { SelfOptimizationModule } from './self-optimization/self-optimization.module';
import { OperationalCommandModule } from './operational-command/operational-command.module';
import { CommandCenterModule } from './command-center/command-center.module';
import { LeadsIntelligenceModule } from './leads-intelligence/leads-intelligence.module';
import { DealsIntelligenceModule } from './deals-intelligence/deals-intelligence.module';
import { AgentLayerModule } from './agent-layer/agent-layer.module';
import { LeadsExplorerModule } from './leads-explorer/leads-explorer.module';
import { DealsExplorerModule } from './deals-explorer/deals-explorer.module';
import { MyDashboardModule } from './my-dashboard/my-dashboard.module';
import { AdminDashboardModule } from './admin-dashboard/admin-dashboard.module';
import { AssistantModule } from './assistant/assistant.module';
import { AgentCommandModule } from './agent-command/agent-command.module';
import { KpiTrackingModule } from './kpi-tracking/kpi-tracking.module';
import { MetasModule } from './metas/metas.module';
import { FinanzasModule } from './finanzas/finanzas.module';
import { ChannelIntelligenceModule } from './channel-intelligence/channel-intelligence.module';
import { MiDiaModule } from './mi-dia/mi-dia.module';
import { PipelineIntelligenceModule } from './pipeline-intelligence/pipeline-intelligence.module';
import { LiveChatModule } from './live-chat/live-chat.module';
import { ZohoApiModule } from './zoho-api/zoho-api.module';
import { SmsMasivosModule } from './sms-masivos/sms-masivos.module';

/**
 * Root application module.
 * ConfigModule is global — available everywhere without re-importing.
 * PrismaModule is global — database access available everywhere.
 */
@Module({
  imports: [
    // Global config from .env + configuration.ts
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Scheduler (cron jobs for automation)
    ScheduleModule.forRoot(),

    // Database
    PrismaModule,

    // Auth & Users
    AuthModule,
    UsersModule,

    // Fleet management
    VehiclesModule,
    TripsModule,
    GpsModule,
    FuelModule,
    OdometerModule,

    // Sales & CRM
    LeadsModule,
    RoutesModule,
    VisitsModule,
    SalesDashboardModule,
    SalesOpsModule,
    WorkPlanModule,
    AutomationEngineModule,
    CommercialDirectorModule,
    SalesCoachModule,
    CommercialPlannerModule,
    CampaignAttributionModule,
    CampaignIntelligenceModule,
    AlertIntelligenceModule,
    ExecutionEngineModule,
    FollowUpAutomationModule,
    AutomationPerformanceModule,
    AiAgentsModule,
    ClientLifecycleModule,
    CommercialScoutingModule,
    ZohoSyncModule,
    SchedulerModule,

    // Team management & assignment engine
    TeamManagementModule,

    // Follow-up intelligence
    FollowUpIntelligenceModule,

    // Execution discipline tracking
    ExecutionDisciplineModule,

    // Multi-channel communication
    MultiChannelModule,

    // Supervisor Agent (Neto)
    SupervisorAgentModule,

    // Execution Orchestration — Central nervous system
    ExecutionOrchestrationModule,

    // Customer Success — AI-powered post-sale department
    CustomerSuccessModule,

    // Deal Closing — Revenue conversion engine
    DealClosingModule,

    // Revenue Intelligence — Forecast, gap analysis, revenue agent
    RevenueIntelligenceModule,

    // Self-Optimization — Performance analysis, learning, experiments
    SelfOptimizationModule,

    // Operational Command Center — Scoreboard, enforcement, adoption
    OperationalCommandModule,

    // Command Center v2 — Commercial intelligence hub
    CommandCenterModule,

    // Lead & Deal Intelligence dashboards
    LeadsIntelligenceModule,
    DealsIntelligenceModule,

    // Agent Layer — Live management, micro-management, KPI pressure
    AgentLayerModule,

    // Explorer modules — paginated data tables with filters
    LeadsExplorerModule,
    DealsExplorerModule,

    // My Dashboard — Personal advisor dashboard
    MyDashboardModule,

    // Admin Dashboard — Full commercial intelligence for director
    AdminDashboardModule,

    // Virtual Commercial Assistant — NL chat interface
    AssistantModule,

    // Agent Command Center — AI agent dashboard & activity
    AgentCommandModule,

    // KPI Tracking, Metas & Finanzas
    KpiTrackingModule,
    MetasModule,
    FinanzasModule,
    ChannelIntelligenceModule,

    // Mi Dia — Personal advisor execution dashboard
    MiDiaModule,

    // Pipeline Intelligence — Interactive pipeline dashboard
    PipelineIntelligenceModule,

    // Live Chat — Unified inbox, profile, messaging, stage management
    LiveChatModule,

    // Zoho CRM direct API client (global)
    ZohoApiModule,

    // SMS Masivos — Mexican SMS provider (global)
    SmsMasivosModule,

    // Demo data seeding
    DemoSeedModule,

    // Dashboard & Health
    DashboardModule,
    HealthModule,
  ],
})
export class AppModule {}
