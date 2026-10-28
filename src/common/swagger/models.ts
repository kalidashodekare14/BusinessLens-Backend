import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AiStatus,
  AnalysisStatus,
  FindingStatus,
  FindingType,
  ImportStatus,
  ImportType,
  MembershipRole,
  Severity,
} from '../../generated/prisma/client';

/** Shared response envelope and pagination metadata (§12). */
export class PaginationMetaDto {
  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({ example: 42 })
  total!: number;
}

export class DataEnvelope {
  @ApiProperty({ description: 'Resource payload; the shape depends on the endpoint.' })
  data!: unknown;
}

export class ErrorDetailDto {
  @ApiProperty({ example: 'email' })
  field!: string;

  @ApiProperty({ example: 'email must be an email' })
  message!: string;
}

export class ErrorEnvelopeDto {
  @ApiProperty({
    example: {
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: [{ field: 'email', message: 'email must be an email' }],
    },
  })
  error!: {
    code: string;
    message: string;
    details: ErrorDetailDto[];
  };
}

export class PublicUserDto {
  @ApiProperty({ example: '2f4a9b7c-1c2d-4e5f-8a9b-0c1d2e3f4a5b' })
  id!: string;

  @ApiProperty({ example: 'owner@example.com' })
  email!: string;

  @ApiProperty({ example: 'Avery Owner' })
  name!: string;

  @ApiProperty({ format: 'date-time', example: '2026-10-28T12:00:00.000Z' })
  createdAt!: Date;
}

export class UserOrganizationDto {
  @ApiProperty({ example: '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d' })
  id!: string;

  @ApiProperty({ example: 'Acme Retail' })
  name!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: 'UTC' })
  timezone!: string;

  @ApiProperty({ enum: Object.values(MembershipRole), example: 'OWNER' })
  role!: MembershipRole;
}

export class MeUserDto extends PublicUserDto {
  @ApiProperty({ type: () => [UserOrganizationDto] })
  organizations!: UserOrganizationDto[];
}

export class OrganizationViewDto {
  @ApiProperty({ example: '8a7b6c5d-4e3f-4a2b-9c1d-0e9f8a7b6c5d' })
  id!: string;

  @ApiProperty({ example: 'Acme Retail' })
  name!: string;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ example: 'UTC' })
  timezone!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ enum: Object.values(MembershipRole), example: 'OWNER' })
  role!: MembershipRole;
}

export class ProductViewDto {
  @ApiProperty({ example: '0b6f2b83-7e1a-4b1e-9f11-2d4c8a5b6e70' })
  id!: string;

  @ApiProperty({ example: 'Burr Grinder' })
  name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'BG-001' })
  sku!: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Money as a string (§12).',
    example: '129.99',
  })
  price!: string | null;
}

export class OrderViewDto {
  @ApiProperty({ example: 'ORDER-1042' })
  externalId!: string;

  @ApiProperty({ example: '7c1e5a90-3f2b-4d6e-8a1c-9b0d2e4f6a8c' })
  id!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-30T00:00:00.000Z' })
  orderedAt!: Date;

  @ApiProperty({ example: 'completed' })
  status!: string;

  @ApiProperty({ description: 'Money as a string (§12).', example: '249.98' })
  total!: string;

  @ApiProperty({ example: 2 })
  itemCount!: number;
}

export class RowIssueDto {
  @ApiProperty({ example: 'quantity' })
  field!: string;

  @ApiProperty({ example: 'must be a positive integer' })
  reason!: string;
}

export class PreviewRowDto {
  @ApiProperty({ example: 1 })
  rowNumber!: number;

  @ApiProperty({
    type: Object,
    additionalProperties: { type: String, nullable: true },
    example: { orderId: 'ORDER-1', quantity: '2', unitPrice: '9.99' },
  })
  values!: Record<string, string | null>;

  @ApiProperty({ example: true })
  valid!: boolean;

  @ApiProperty({ type: () => [RowIssueDto] })
  errors!: RowIssueDto[];
}

export class CsvPreviewDto {
  @ApiProperty({ type: () => [PreviewRowDto] })
  rows!: PreviewRowDto[];

  @ApiProperty({ example: false })
  truncated!: boolean;
}

export class ImportUploadViewDto {
  @ApiProperty({ example: 'f2f0e6c0-3f04-4a7d-a1b6-1c7d6e5f4a3b' })
  id!: string;

  @ApiProperty({ enum: Object.values(ImportType), example: 'ORDERS' })
  type!: ImportType;

  @ApiProperty({ enum: Object.values(ImportStatus), example: 'UPLOADED' })
  status!: ImportStatus;

  @ApiProperty({ example: 'orders.csv' })
  originalFileName!: string;

  @ApiProperty({ type: [String], example: ['Order ID', 'Order Date', 'Qty', 'Unit Price'] })
  detectedHeaders!: string[];

  @ApiProperty({
    type: Object,
    additionalProperties: { type: String, nullable: true },
    example: { orderId: 'Order ID', orderedAt: 'Order Date', quantity: 'Qty' },
  })
  suggestedMapping!: Record<string, string | null>;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class ImportMappingViewDto {
  @ApiProperty({ example: 'f2f0e6c0-3f04-4a7d-a1b6-1c7d6e5f4a3b' })
  id!: string;

  @ApiProperty({ enum: Object.values(ImportType), example: 'ORDERS' })
  type!: ImportType;

  @ApiProperty({ enum: Object.values(ImportStatus), example: 'MAPPED' })
  status!: ImportStatus;

  @ApiProperty({ type: [String], example: ['Order ID', 'Order Date', 'Qty', 'Unit Price'] })
  detectedHeaders!: string[];

  @ApiProperty({
    type: Object,
    additionalProperties: { type: String, nullable: true },
    example: { orderId: 'Order ID', orderedAt: 'Order Date', quantity: 'Qty' },
  })
  mapping!: Record<string, string | null>;

  @ApiProperty({ type: () => CsvPreviewDto })
  preview!: CsvPreviewDto;
}

export class ImportConfirmViewDto {
  @ApiProperty({ example: 'f2f0e6c0-3f04-4a7d-a1b6-1c7d6e5f4a3b' })
  id!: string;

  @ApiProperty({ enum: Object.values(ImportType), example: 'ORDERS' })
  type!: ImportType;

  @ApiProperty({ enum: Object.values(ImportStatus), example: 'PROCESSING' })
  status!: ImportStatus;
}

export class ImportListItemViewDto {
  @ApiProperty({ example: 'f2f0e6c0-3f04-4a7d-a1b6-1c7d6e5f4a3b' })
  id!: string;

  @ApiProperty({ enum: Object.values(ImportType), example: 'ORDERS' })
  type!: ImportType;

  @ApiProperty({ enum: Object.values(ImportStatus), example: 'COMPLETED' })
  status!: ImportStatus;

  @ApiProperty({ example: 'orders.csv' })
  originalFileName!: string;

  @ApiProperty({ example: 1200 })
  totalRows!: number;

  @ApiProperty({ example: 1198 })
  processedRows!: number;

  @ApiProperty({ example: 2 })
  failedRows!: number;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: Date | null;
}

export class ImportDetailViewDto extends ImportListItemViewDto {
  @ApiPropertyOptional({ type: [String], nullable: true })
  detectedHeaders!: string[] | null;

  @ApiPropertyOptional({
    type: Object,
    additionalProperties: { type: String, nullable: true },
    nullable: true,
    example: { orderId: 'Order ID', orderedAt: 'Order Date' },
  })
  columnMapping!: Record<string, string | null> | null;
}

export class ImportErrorViewDto {
  @ApiProperty({ example: 17 })
  rowNumber!: number;

  @ApiProperty({ example: 'quantity' })
  field!: string;

  @ApiProperty({ example: 'must be a positive integer' })
  reason!: string;
}

export class ProductMetricsViewDto {
  @ApiPropertyOptional({ type: String, nullable: true })
  productId!: string | null;

  @ApiProperty({ example: 'Burr Grinder' })
  name!: string;

  @ApiProperty({ description: 'Money as a string.', example: '1299.90' })
  revenue!: string;

  @ApiProperty({ example: 10 })
  units!: number;
}

export class PeriodMetricsViewDto {
  @ApiProperty({ format: 'date-time', example: '2026-09-01T00:00:00.000Z' })
  start!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-30T00:00:00.000Z' })
  end!: string;

  @ApiProperty({ description: 'Money as a string.', example: '26705.50' })
  revenue!: string;

  @ApiProperty({ example: 201 })
  orderCount!: number;

  @ApiProperty({ description: 'Money as a string.', example: '132.86' })
  averageOrderValue!: string;

  @ApiProperty({ type: () => [ProductMetricsViewDto] })
  products!: ProductMetricsViewDto[];
}

export class MetricsChangesViewDto {
  @ApiPropertyOptional({ type: Number, nullable: true, example: -32.4 })
  revenue!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: -28.5 })
  orderCount!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, example: -5.5 })
  averageOrderValue!: number | null;
}

export class MetricsOverviewViewDto {
  @ApiProperty({ format: 'date-time', example: '2026-09-30T00:00:00.000Z' })
  referenceDate!: string;

  @ApiProperty({ type: () => PeriodMetricsViewDto })
  current!: PeriodMetricsViewDto;

  @ApiProperty({ type: () => PeriodMetricsViewDto })
  previous!: PeriodMetricsViewDto;

  @ApiProperty({ type: () => MetricsChangesViewDto })
  changes!: MetricsChangesViewDto;
}

export class MetricsSnapshotDto {
  @ApiProperty({ example: 1 })
  version!: 1;

  @ApiProperty({ format: 'date-time', example: '2026-09-30T00:00:00.000Z' })
  referenceDate!: string;

  @ApiProperty({ type: () => PeriodMetricsViewDto })
  current!: PeriodMetricsViewDto;

  @ApiProperty({ type: () => PeriodMetricsViewDto })
  previous!: PeriodMetricsViewDto;
}

export class AnalysisRunCreatedViewDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' })
  id!: string;

  @ApiProperty({ enum: Object.values(AnalysisStatus), example: 'QUEUED' })
  status!: AnalysisStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class AnalysisRunListItemViewDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' })
  id!: string;

  @ApiProperty({ enum: Object.values(AnalysisStatus), example: 'COMPLETED' })
  status!: AnalysisStatus;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  referenceDate!: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  currentStart!: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  currentEnd!: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  previousStart!: Date | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  previousEnd!: Date | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  errorMessage!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: Date | null;
}

export class AnalysisRunDetailViewDto extends AnalysisRunListItemViewDto {
  @ApiPropertyOptional({ type: () => MetricsSnapshotDto, nullable: true })
  metricsSnapshot!: MetricsSnapshotDto | null;
}

export class FindingListItemViewDto {
  @ApiProperty({ example: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' })
  id!: string;

  @ApiProperty({ example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' })
  analysisRunId!: string;

  @ApiProperty({ enum: Object.values(FindingType), example: 'REVENUE_DROP' })
  type!: FindingType;

  @ApiProperty({ enum: Object.values(Severity), example: 'HIGH' })
  severity!: Severity;

  @ApiProperty({ enum: Object.values(FindingStatus), example: 'OPEN' })
  status!: FindingStatus;

  @ApiProperty({ example: 'Revenue dropped 32.4%' })
  title!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Burr Grinder' })
  subjectKey!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  resolvedAt!: Date | null;
}

export class FindingNoteViewDto {
  @ApiProperty({ example: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d' })
  id!: string;

  @ApiProperty({ example: 'Checked the promotion calendar.' })
  body!: string;

  @ApiProperty({ example: '2f4a9b7c-1c2d-4e5f-8a9b-0c1d2e3f4a5b' })
  authorId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class ExplanationContentDto {
  @ApiProperty({ example: 'Revenue fell 20% in the current period, from 100.00 to 80.00.' })
  summary!: string;

  @ApiProperty({ type: [String] })
  observedFacts!: string[];

  @ApiProperty({ type: [String] })
  associatedSignals!: string[];

  @ApiProperty({ type: [String], description: 'Hypotheses, never stated as facts.' })
  possibleExplanations!: string[];

  @ApiProperty({ type: [String] })
  investigationSteps!: string[];

  @ApiProperty({ example: 'The data does not show why order count changed.' })
  uncertainty!: string;
}

export class FindingExplanationViewDto {
  @ApiProperty({ enum: Object.values(AiStatus), example: 'COMPLETED' })
  status!: AiStatus;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'gemini-2.5-flash' })
  model!: string | null;

  @ApiPropertyOptional({ type: () => ExplanationContentDto, nullable: true })
  content!: ExplanationContentDto | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true, example: true })
  validationPassed!: boolean | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: null })
  errorMessage!: string | null;

  @ApiProperty({ example: 1 })
  attempts!: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class FindingEvidenceDto {
  @ApiProperty({ example: 'revenue' })
  metric!: string;

  @ApiProperty({
    example: { value: '26705.50', start: '2026-09-01T00:00:00.000Z', end: '2026-09-30T00:00:00.000Z' },
  })
  current!: { value: string | number; start: string; end: string };

  @ApiProperty({
    example: {
      value: '39489.50',
      start: '2026-08-02T00:00:00.000Z',
      end: '2026-08-31T00:00:00.000Z',
    },
  })
  previous!: { value: string | number; start: string; end: string };

  @ApiProperty({ example: -32.4 })
  changePercent!: number;

  @ApiProperty({ example: { trigger: -10, high: -20 } })
  thresholds!: Record<string, number>;

  @ApiProperty({
    type: Object,
    additionalProperties: true,
    example: {
      orderCount: { current: 201, previous: 281, changePercent: -28.5 },
      averageOrderValue: { current: '132.86', previous: '140.53', changePercent: -5.5 },
    },
  })
  relatedMetrics!: Record<string, unknown>;

  @ApiPropertyOptional({
    example: { id: '0b6f2b83-7e1a-4b1e-9f11-2d4c8a5b6e70', name: 'Burr Grinder' },
  })
  product?: { id: string | null; name: string };
}

export class FindingDetailViewDto extends FindingListItemViewDto {
  @ApiProperty({ type: () => FindingEvidenceDto })
  evidence!: FindingEvidenceDto;

  @ApiProperty({ example: 'revenue-drop-v1' })
  ruleVersion!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;

  @ApiProperty({ type: () => [FindingNoteViewDto] })
  notes!: FindingNoteViewDto[];

  @ApiPropertyOptional({ type: () => FindingExplanationViewDto, nullable: true })
  explanation!: FindingExplanationViewDto | null;
}

export class FindingStatusViewDto {
  @ApiProperty({ example: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' })
  id!: string;

  @ApiProperty({ enum: Object.values(FindingStatus), example: 'RESOLVED' })
  status!: FindingStatus;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  resolvedAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class ExplanationQueuedViewDto {
  @ApiProperty({ example: 'c3d4e5f6-a7b8-4c9d-0e1f-2a3b4c5d6e7f' })
  id!: string;

  @ApiProperty({ example: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e' })
  findingId!: string;

  @ApiProperty({ enum: Object.values(AiStatus), example: 'PENDING' })
  status!: AiStatus;

  @ApiProperty({ example: 0 })
  attempts!: number;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class DashboardMoneyViewDto {
  @ApiProperty({ example: '26705.50' })
  current!: string;

  @ApiProperty({ example: '39489.50' })
  previous!: string;

  @ApiPropertyOptional({ type: Number, nullable: true, example: -32.4 })
  changePercent!: number | null;
}

export class DashboardCountViewDto {
  @ApiProperty({ example: 201 })
  current!: number;

  @ApiProperty({ example: 281 })
  previous!: number;

  @ApiPropertyOptional({ type: Number, nullable: true, example: -28.5 })
  changePercent!: number | null;
}

export class DashboardMetricsViewDto {
  @ApiProperty({ format: 'date-time', example: '2026-09-30T00:00:00.000Z' })
  referenceDate!: string;

  @ApiProperty({ type: () => DashboardMoneyViewDto })
  revenue!: DashboardMoneyViewDto;

  @ApiProperty({ type: () => DashboardCountViewDto })
  orderCount!: DashboardCountViewDto;

  @ApiProperty({ type: () => DashboardMoneyViewDto })
  averageOrderValue!: DashboardMoneyViewDto;
}

export class DashboardRunViewDto {
  @ApiProperty({ example: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' })
  id!: string;

  @ApiProperty({ enum: Object.values(AnalysisStatus), example: 'COMPLETED' })
  status!: AnalysisStatus;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  referenceDate!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  completedAt!: Date | null;
}

export class SeverityCountsDto {
  @ApiProperty({ example: 2 })
  MEDIUM!: number;

  @ApiProperty({ example: 1 })
  HIGH!: number;
}

export class DashboardViewDto {
  @ApiProperty({
    example: { total: 3, bySeverity: { MEDIUM: 2, HIGH: 1 } },
  })
  openFindings!: { total: number; bySeverity: SeverityCountsDto };

  @ApiPropertyOptional({ type: () => DashboardRunViewDto, nullable: true })
  latestAnalysisRun!: DashboardRunViewDto | null;

  @ApiPropertyOptional({ type: () => DashboardMetricsViewDto, nullable: true })
  metrics!: DashboardMetricsViewDto | null;
}

export class AuditLogViewDto {
  @ApiProperty({ example: 'd4e5f6a7-b8c9-4d0e-1f2a-3b4c5d6e7f8a' })
  id!: string;

  @ApiProperty({ example: 'analysis.started' })
  action!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  actorId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'AnalysisRun' })
  entityType!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  entityId!: string | null;

  @ApiPropertyOptional({
    type: Object,
    additionalProperties: true,
    nullable: true,
    example: { importIds: ['f2f0e6c0-3f04-4a7d-a1b6-1c7d6e5f4a3b'] },
  })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class DemoImportViewDto {
  @ApiProperty({ example: 'f2f0e6c0-3f04-4a7d-a1b6-1c7d6e5f4a3b' })
  id!: string;

  @ApiProperty({ enum: Object.values(ImportType), example: 'ORDERS' })
  type!: ImportType;

  @ApiProperty({ enum: Object.values(ImportStatus), example: 'PROCESSING' })
  status!: ImportStatus;
}

export class DemoLoadViewDto {
  @ApiProperty({ example: 'PROCESSING' })
  status!: 'PROCESSING';

  @ApiProperty({ type: () => [DemoImportViewDto] })
  imports!: DemoImportViewDto[];
}

export class HealthReportDto {
  @ApiProperty({ enum: ['ok', 'degraded'], example: 'ok' })
  status!: 'ok' | 'degraded';

  @ApiProperty({ example: { database: 'ok', redis: 'ok' } })
  checks!: { database: 'ok' | 'down'; redis: 'ok' | 'down' };

  @ApiProperty({ format: 'date-time', example: '2026-10-28T12:00:00.000Z' })
  timestamp!: string;
}

export class LoginResponseDto {
  @ApiProperty({ description: '15-minute JWT access token.', example: 'eyJhbGciOiJIUzI1NiIs...' })
  accessToken!: string;

  @ApiProperty({ example: 900 })
  expiresIn!: number;
}

/** Every response model registered with the Swagger document. */
export const ALL_MODELS = [
  PaginationMetaDto,
  DataEnvelope,
  ErrorDetailDto,
  ErrorEnvelopeDto,
  PublicUserDto,
  UserOrganizationDto,
  MeUserDto,
  OrganizationViewDto,
  ProductViewDto,
  OrderViewDto,
  RowIssueDto,
  PreviewRowDto,
  CsvPreviewDto,
  ImportUploadViewDto,
  ImportMappingViewDto,
  ImportConfirmViewDto,
  ImportListItemViewDto,
  ImportDetailViewDto,
  ImportErrorViewDto,
  ProductMetricsViewDto,
  PeriodMetricsViewDto,
  MetricsChangesViewDto,
  MetricsOverviewViewDto,
  MetricsSnapshotDto,
  AnalysisRunCreatedViewDto,
  AnalysisRunListItemViewDto,
  AnalysisRunDetailViewDto,
  FindingListItemViewDto,
  FindingNoteViewDto,
  ExplanationContentDto,
  FindingExplanationViewDto,
  FindingEvidenceDto,
  FindingDetailViewDto,
  FindingStatusViewDto,
  ExplanationQueuedViewDto,
  DashboardMoneyViewDto,
  DashboardCountViewDto,
  DashboardMetricsViewDto,
  DashboardRunViewDto,
  SeverityCountsDto,
  DashboardViewDto,
  AuditLogViewDto,
  DemoImportViewDto,
  DemoLoadViewDto,
  HealthReportDto,
  LoginResponseDto,
];
