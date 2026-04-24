import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SupabaseMonitoringService } from './supabase-monitoring.service';

@Module({
  imports: [PrismaModule],
  providers: [SupabaseMonitoringService],
})
export class MonitoringModule {}
