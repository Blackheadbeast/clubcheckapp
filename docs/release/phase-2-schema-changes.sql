-- AlterTable
ALTER TABLE "GymProfile" ADD COLUMN     "memberSelfCancel" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "memberSelfChangePlan" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "memberSelfCheckin" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "memberSelfFreeze" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "pastDueCancelDays" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "connectCustomerId" TEXT,
ADD COLUMN     "householdId" TEXT,
ADD COLUMN     "smsConsentAt" TIMESTAMP(3),
ADD COLUMN     "smsMarketingOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsStopped" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsStoppedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Prospect" ADD COLUMN     "smsOptIn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "smsStopped" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "pendingPlanId" TEXT;

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "disputeReason" TEXT,
ADD COLUMN     "disputeStatus" TEXT,
ADD COLUMN     "disputedAt" TIMESTAMP(3),
ADD COLUMN     "payerMemberId" TEXT,
ADD COLUMN     "paymentMethodId" TEXT,
ADD COLUMN     "refundReason" TEXT;

-- AlterTable
ALTER TABLE "ClassSession" ADD COLUMN     "workoutId" TEXT;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "channel" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "conversationId" TEXT,
ADD COLUMN     "dedupeKey" TEXT,
ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'outbound',
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "fromAddress" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'marketing',
ADD COLUMN     "nextAttemptAt" TIMESTAMP(3),
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "sendAfter" TIMESTAMP(3),
ADD COLUMN     "staffId" TEXT,
ADD COLUMN     "staffName" TEXT,
ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "providerId" TEXT NOT NULL,
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "detailsSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "disabledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stripe',
    "providerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "brand" TEXT,
    "bankName" TEXT,
    "last4" TEXT NOT NULL,
    "expMonth" INTEGER,
    "expYear" INTEGER,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "account" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberAccount" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "pendingEmail" TEXT,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberAuthToken" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberNotification" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "screen" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberDevice" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "pushToken" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentType" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#8b5cf6',
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "paymentMode" TEXT NOT NULL DEFAULT 'credit',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "creditsRequired" INTEGER NOT NULL DEFAULT 1,
    "requiredPlanIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "locationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cancelWindowHours" INTEGER NOT NULL DEFAULT 12,
    "minNoticeMinutes" INTEGER NOT NULL DEFAULT 120,
    "maxAdvanceDays" INTEGER NOT NULL DEFAULT 30,
    "slotIntervalMin" INTEGER NOT NULL DEFAULT 30,
    "memberBookable" BOOLEAN NOT NULL DEFAULT true,
    "memberReschedule" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppointmentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppointmentTypeStaff" (
    "typeId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "AppointmentTypeStaff_pkey" PRIMARY KEY ("typeId","staffId")
);

-- CreateTable
CREATE TABLE "StaffAvailability" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'work',
    "locationId" TEXT,

    CONSTRAINT "StaffAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTimeOff" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'vacation',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffTimeOff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "typeId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "locationId" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'booked',
    "paymentMode" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "cancelWindowHours" INTEGER NOT NULL DEFAULT 12,
    "membershipId" TEXT,
    "creditsUsed" INTEGER NOT NULL DEFAULT 0,
    "creditsReturned" BOOLEAN NOT NULL DEFAULT false,
    "invoiceId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'staff',
    "bookedByName" TEXT,
    "notes" TEXT,
    "staffNotes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "rescheduleCount" INTEGER NOT NULL DEFAULT 0,
    "previousStartsAt" TIMESTAMP(3),
    "reminderDaySentAt" TIMESTAMP(3),
    "reminderSoonSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "channel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workoutId" TEXT,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimeClaim" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "slot" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TimeClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsConversation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "memberId" TEXT,
    "prospectId" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "lastPreview" TEXT,
    "lastDirection" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "needsResponse" BOOLEAN NOT NULL DEFAULT false,
    "assignedStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsConsentEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "memberId" TEXT,
    "prospectId" TEXT,
    "phone" TEXT,
    "scope" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "method" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsConsentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageKey" (
    "key" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "messageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageKey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SmsNumber" (
    "number" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsNumber_pkey" PRIMARY KEY ("number")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "payerMemberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountCredit" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "originalCents" INTEGER NOT NULL,
    "remainingCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "reason" TEXT,
    "autoApply" BOOLEAN NOT NULL DEFAULT true,
    "membershipId" TEXT,
    "sourceInvoiceId" TEXT,
    "sourceTransactionId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountCredit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditApplication" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "creditId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'applied',
    "amountCents" INTEGER NOT NULL,
    "invoiceId" TEXT,
    "transactionId" TEXT,
    "note" TEXT,
    "byName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanChange" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "fromPlanId" TEXT NOT NULL,
    "toPlanId" TEXT NOT NULL,
    "effective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "source" TEXT NOT NULL DEFAULT 'staff',
    "calculation" JSONB NOT NULL,
    "invoiceId" TEXT,
    "creditId" TEXT,
    "byId" TEXT,
    "byName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appliedAt" TIMESTAMP(3),

    CONSTRAINT "PlanChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Exercise" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "slug" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "category" TEXT NOT NULL,
    "movementPattern" TEXT,
    "primaryMuscle" TEXT,
    "secondaryMuscles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "difficulty" TEXT NOT NULL DEFAULT 'intermediate',
    "measure" TEXT NOT NULL DEFAULT 'weight_reps',
    "videoUrl" TEXT,
    "imageUrl" TEXT,
    "coachNotes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Exercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workout" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'mixed',
    "difficulty" TEXT NOT NULL DEFAULT 'intermediate',
    "estimatedMinutes" INTEGER,
    "currentVersionId" TEXT,
    "createdById" TEXT,
    "createdByName" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutVersion" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "type" TEXT NOT NULL,
    "difficulty" TEXT NOT NULL,
    "estimatedMinutes" INTEGER,
    "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content" JSONB NOT NULL,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkoutVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "goals" TEXT,
    "difficulty" TEXT NOT NULL DEFAULT 'intermediate',
    "audience" TEXT,
    "weeks" INTEGER NOT NULL DEFAULT 4,
    "createdById" TEXT,
    "createdByName" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramDay" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "workoutId" TEXT NOT NULL,
    "title" TEXT,

    CONSTRAINT "ProgramDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramAssignment" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "coachId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "pausedAt" TIMESTAMP(3),
    "pausedDays" INTEGER NOT NULL DEFAULT 0,
    "sourcePlanId" TEXT,
    "createdByName" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSession" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "workoutId" TEXT NOT NULL,
    "workoutVersionId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "programDayId" TEXT,
    "classSessionId" TEXT,
    "appointmentId" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "result" JSONB,
    "memberNotes" TEXT,
    "coachNotes" TEXT,
    "coachFeedback" TEXT,
    "coachId" TEXT,
    "coachName" TEXT,
    "programName" TEXT,
    "assignedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutSetLog" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "exerciseId" TEXT,
    "exerciseName" TEXT NOT NULL,
    "setNumber" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION,
    "weightUnit" TEXT,
    "reps" INTEGER,
    "durationSec" INTEGER,
    "distanceM" DOUBLE PRECISION,
    "rpe" DOUBLE PRECISION,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutSetLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutItemLog" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "performedAs" TEXT NOT NULL DEFAULT 'rx',
    "scalingId" TEXT,
    "exerciseId" TEXT,
    "exerciseName" TEXT,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutItemLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalRecord" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "exerciseId" TEXT,
    "workoutId" TEXT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "bucket" TEXT NOT NULL DEFAULT '',
    "value" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "previousValue" DOUBLE PRECISION,
    "detail" TEXT,
    "sessionId" TEXT NOT NULL,
    "achievedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rateLimit" INTEGER,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedByName" TEXT,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiRequestLog" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "apiKeyId" TEXT,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER NOT NULL,
    "errorCode" TEXT,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiRequestLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiRateWindow" (
    "id" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiRateWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "secretCipher" TEXT NOT NULL,
    "secretHint" TEXT NOT NULL,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" TIMESTAMP(3),
    "lastStatusCode" INTEGER,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookAttempt" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "statusCode" INTEGER,
    "error" TEXT,
    "response" TEXT,
    "durationMs" INTEGER NOT NULL,
    "manual" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingSite" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "displayName" TEXT,
    "tagline" TEXT,
    "primaryColor" TEXT NOT NULL DEFAULT '#2563eb',
    "buttonStyle" TEXT NOT NULL DEFAULT 'rounded',
    "appearance" TEXT NOT NULL DEFAULT 'light',
    "showLogo" BOOLEAN NOT NULL DEFAULT true,
    "locationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allClassTypes" BOOLEAN NOT NULL DEFAULT true,
    "classTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "appointmentTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requireAccount" BOOLEAN NOT NULL DEFAULT false,
    "allowGuests" BOOLEAN NOT NULL DEFAULT true,
    "advanceDays" INTEGER,
    "cancellationPolicy" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "termsUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingSite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingSiteDaily" (
    "ownerId" TEXT NOT NULL,
    "day" TIMESTAMP(3) NOT NULL,
    "visits" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BookingSiteDaily_pkey" PRIMARY KEY ("ownerId","day")
);

-- CreateTable
CREATE TABLE "DocumentTemplate" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'custom',
    "publishedVersionId" TEXT,
    "validForDays" INTEGER,
    "signWithinDays" INTEGER,
    "allowDecline" BOOLEAN NOT NULL DEFAULT true,
    "declineReasonRequired" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdByName" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentTemplateVersion" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "fields" JSONB NOT NULL DEFAULT '[]',
    "requireSignature" BOOLEAN NOT NULL DEFAULT true,
    "createdByName" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTemplateVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentRequirement" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "planIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "classTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "appointmentTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberDocument" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "content" JSONB NOT NULL,
    "fieldValues" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT NOT NULL DEFAULT 'staff',
    "assignedByName" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "voidedByName" TEXT,
    "expiredAt" TIMESTAMP(3),
    "remindedAt" TIMESTAMP(3),
    "signBy" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "signerName" TEXT,
    "signatureMethod" TEXT,
    "signature" JSONB,
    "consentAt" TIMESTAMP(3),
    "signedIp" TEXT,
    "signedUserAgent" TEXT,
    "finalSnapshot" JSONB,
    "snapshotHash" TEXT,
    "pdfKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentSigningToken" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentSigningToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffCompensation" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "locationId" TEXT,
    "basePay" TEXT NOT NULL DEFAULT 'none',
    "hourlyRateCents" INTEGER NOT NULL DEFAULT 0,
    "annualSalaryCents" INTEGER NOT NULL DEFAULT 0,
    "flatPerPeriodCents" INTEGER NOT NULL DEFAULT 0,
    "perSessionCents" INTEGER NOT NULL DEFAULT 0,
    "perClassCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "updatedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffCompensation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionPlan" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommissionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionRule" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "rateType" TEXT NOT NULL,
    "percentBps" INTEGER NOT NULL DEFAULT 0,
    "flatCents" INTEGER NOT NULL DEFAULT 0,
    "planIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "appointmentTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "classTypeIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "includeNoShow" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CommissionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionAssignment" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "startsOn" TEXT NOT NULL,
    "endsOn" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleAttribution" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "sharePercent" INTEGER NOT NULL DEFAULT 100,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollPeriod" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "createdByName" TEXT,
    "submittedAt" TIMESTAMP(3),
    "submittedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedByName" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "finalizedByName" TEXT,
    "reopenedAt" TIMESTAMP(3),
    "reopenedByName" TEXT,
    "reopenReason" TEXT,
    "totals" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollEntry" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "periodId" TEXT,
    "kind" TEXT NOT NULL,
    "adjustmentType" TEXT,
    "sourceKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "invoiceId" TEXT,
    "memberId" TEXT,
    "memberName" TEXT,
    "locationId" TEXT,
    "trigger" TEXT,
    "commissionPlanId" TEXT,
    "commissionPlanName" TEXT,
    "rateType" TEXT,
    "percentBps" INTEGER,
    "flatCents" INTEGER,
    "sharePercent" INTEGER NOT NULL DEFAULT 100,
    "basisCents" INTEGER NOT NULL DEFAULT 0,
    "grossCents" INTEGER NOT NULL DEFAULT 0,
    "minutes" INTEGER,
    "rateCents" INTEGER,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "reason" TEXT,
    "reversesEntryId" TEXT,
    "earnedAt" TIMESTAMP(3) NOT NULL,
    "carried" BOOLEAN NOT NULL DEFAULT false,
    "createdByType" TEXT NOT NULL DEFAULT 'system',
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollSource" (
    "key" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "entries" INTEGER NOT NULL DEFAULT 0,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollSource_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PayrollTimeEntry" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "workDate" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "locationId" TEXT,
    "note" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedByName" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollTimeEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollEvent" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "periodId" TEXT,
    "staffId" TEXT,
    "type" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayrollEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAccount_ownerId_key" ON "PaymentAccount"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAccount_providerId_key" ON "PaymentAccount"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentMethod_providerId_key" ON "PaymentMethod"("providerId");

-- CreateIndex
CREATE INDEX "PaymentMethod_ownerId_memberId_idx" ON "PaymentMethod"("ownerId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberAccount_memberId_key" ON "MemberAccount"("memberId");

-- CreateIndex
CREATE INDEX "MemberAccount_ownerId_idx" ON "MemberAccount"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberAuthToken_tokenHash_key" ON "MemberAuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "MemberAuthToken_memberId_type_idx" ON "MemberAuthToken"("memberId", "type");

-- CreateIndex
CREATE INDEX "MemberNotification_memberId_createdAt_idx" ON "MemberNotification"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "MemberNotification_memberId_readAt_idx" ON "MemberNotification"("memberId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "MemberDevice_pushToken_key" ON "MemberDevice"("pushToken");

-- CreateIndex
CREATE INDEX "MemberDevice_memberId_idx" ON "MemberDevice"("memberId");

-- CreateIndex
CREATE INDEX "AppointmentType_ownerId_isActive_idx" ON "AppointmentType"("ownerId", "isActive");

-- CreateIndex
CREATE INDEX "AppointmentTypeStaff_staffId_idx" ON "AppointmentTypeStaff"("staffId");

-- CreateIndex
CREATE INDEX "StaffAvailability_staffId_weekday_idx" ON "StaffAvailability"("staffId", "weekday");

-- CreateIndex
CREATE INDEX "StaffTimeOff_staffId_startsAt_idx" ON "StaffTimeOff"("staffId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_ownerId_startsAt_idx" ON "Appointment"("ownerId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_ownerId_status_startsAt_idx" ON "Appointment"("ownerId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_staffId_startsAt_idx" ON "Appointment"("staffId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_memberId_startsAt_idx" ON "Appointment"("memberId", "startsAt");

-- CreateIndex
CREATE INDEX "TimeClaim_appointmentId_idx" ON "TimeClaim"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "TimeClaim_resource_slot_key" ON "TimeClaim"("resource", "slot");

-- CreateIndex
CREATE INDEX "SmsConversation_ownerId_lastMessageAt_idx" ON "SmsConversation"("ownerId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SmsConversation_ownerId_unreadCount_idx" ON "SmsConversation"("ownerId", "unreadCount");

-- CreateIndex
CREATE INDEX "SmsConversation_memberId_idx" ON "SmsConversation"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsConversation_ownerId_phone_key" ON "SmsConversation"("ownerId", "phone");

-- CreateIndex
CREATE INDEX "SmsConsentEvent_ownerId_memberId_createdAt_idx" ON "SmsConsentEvent"("ownerId", "memberId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsConsentEvent_ownerId_phone_idx" ON "SmsConsentEvent"("ownerId", "phone");

-- CreateIndex
CREATE INDEX "MessageKey_ownerId_idx" ON "MessageKey"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "SmsNumber_ownerId_key" ON "SmsNumber"("ownerId");

-- CreateIndex
CREATE INDEX "Household_ownerId_idx" ON "Household"("ownerId");

-- CreateIndex
CREATE INDEX "AccountCredit_ownerId_memberId_createdAt_idx" ON "AccountCredit"("ownerId", "memberId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditApplication_creditId_idx" ON "CreditApplication"("creditId");

-- CreateIndex
CREATE INDEX "CreditApplication_ownerId_invoiceId_idx" ON "CreditApplication"("ownerId", "invoiceId");

-- CreateIndex
CREATE INDEX "PlanChange_ownerId_membershipId_createdAt_idx" ON "PlanChange"("ownerId", "membershipId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanChange_ownerId_memberId_idx" ON "PlanChange"("ownerId", "memberId");

-- CreateIndex
CREATE INDEX "IdempotencyKey_ownerId_createdAt_idx" ON "IdempotencyKey"("ownerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Exercise_slug_key" ON "Exercise"("slug");

-- CreateIndex
CREATE INDEX "Exercise_ownerId_isActive_name_idx" ON "Exercise"("ownerId", "isActive", "name");

-- CreateIndex
CREATE INDEX "Workout_ownerId_archivedAt_name_idx" ON "Workout"("ownerId", "archivedAt", "name");

-- CreateIndex
CREATE INDEX "WorkoutVersion_ownerId_idx" ON "WorkoutVersion"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutVersion_workoutId_version_key" ON "WorkoutVersion"("workoutId", "version");

-- CreateIndex
CREATE INDEX "Program_ownerId_archivedAt_name_idx" ON "Program"("ownerId", "archivedAt", "name");

-- CreateIndex
CREATE INDEX "ProgramDay_ownerId_workoutId_idx" ON "ProgramDay"("ownerId", "workoutId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramDay_programId_week_day_key" ON "ProgramDay"("programId", "week", "day");

-- CreateIndex
CREATE INDEX "ProgramAssignment_ownerId_memberId_status_idx" ON "ProgramAssignment"("ownerId", "memberId", "status");

-- CreateIndex
CREATE INDEX "ProgramAssignment_ownerId_programId_status_idx" ON "ProgramAssignment"("ownerId", "programId", "status");

-- CreateIndex
CREATE INDEX "ProgramAssignment_ownerId_coachId_status_idx" ON "ProgramAssignment"("ownerId", "coachId", "status");

-- CreateIndex
CREATE INDEX "WorkoutSession_ownerId_memberId_status_completedAt_idx" ON "WorkoutSession"("ownerId", "memberId", "status", "completedAt");

-- CreateIndex
CREATE INDEX "WorkoutSession_ownerId_memberId_scheduledDate_idx" ON "WorkoutSession"("ownerId", "memberId", "scheduledDate");

-- CreateIndex
CREATE INDEX "WorkoutSession_ownerId_scheduledDate_status_idx" ON "WorkoutSession"("ownerId", "scheduledDate", "status");

-- CreateIndex
CREATE INDEX "WorkoutSession_workoutVersionId_idx" ON "WorkoutSession"("workoutVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSession_assignmentId_programDayId_key" ON "WorkoutSession"("assignmentId", "programDayId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSession_memberId_classSessionId_key" ON "WorkoutSession"("memberId", "classSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSession_memberId_appointmentId_key" ON "WorkoutSession"("memberId", "appointmentId");

-- CreateIndex
CREATE INDEX "WorkoutSetLog_ownerId_memberId_exerciseId_createdAt_idx" ON "WorkoutSetLog"("ownerId", "memberId", "exerciseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutSetLog_sessionId_itemId_setNumber_key" ON "WorkoutSetLog"("sessionId", "itemId", "setNumber");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutItemLog_sessionId_itemId_key" ON "WorkoutItemLog"("sessionId", "itemId");

-- CreateIndex
CREATE INDEX "PersonalRecord_ownerId_memberId_achievedAt_idx" ON "PersonalRecord"("ownerId", "memberId", "achievedAt");

-- CreateIndex
CREATE INDEX "PersonalRecord_ownerId_memberId_exerciseId_type_bucket_achi_idx" ON "PersonalRecord"("ownerId", "memberId", "exerciseId", "type", "bucket", "achievedAt");

-- CreateIndex
CREATE INDEX "PersonalRecord_sessionId_idx" ON "PersonalRecord"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_ownerId_createdAt_idx" ON "ApiKey"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiRequestLog_ownerId_createdAt_idx" ON "ApiRequestLog"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiRequestLog_apiKeyId_createdAt_idx" ON "ApiRequestLog"("apiKeyId", "createdAt");

-- CreateIndex
CREATE INDEX "ApiRateWindow_expiresAt_idx" ON "ApiRateWindow"("expiresAt");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_ownerId_createdAt_idx" ON "WebhookEndpoint"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_ownerId_createdAt_idx" ON "WebhookEvent"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_ownerId_type_createdAt_idx" ON "WebhookEvent"("ownerId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_ownerId_dedupeKey_key" ON "WebhookEvent"("ownerId", "dedupeKey");

-- CreateIndex
CREATE INDEX "WebhookDelivery_status_nextAttemptAt_idx" ON "WebhookDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_ownerId_createdAt_idx" ON "WebhookDelivery"("ownerId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_endpointId_eventId_key" ON "WebhookDelivery"("endpointId", "eventId");

-- CreateIndex
CREATE INDEX "WebhookAttempt_deliveryId_createdAt_idx" ON "WebhookAttempt"("deliveryId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingSite_ownerId_key" ON "BookingSite"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingSite_slug_key" ON "BookingSite"("slug");

-- CreateIndex
CREATE INDEX "BookingSite_slug_idx" ON "BookingSite"("slug");

-- CreateIndex
CREATE INDEX "DocumentTemplate_ownerId_archivedAt_name_idx" ON "DocumentTemplate"("ownerId", "archivedAt", "name");

-- CreateIndex
CREATE INDEX "DocumentTemplateVersion_ownerId_idx" ON "DocumentTemplateVersion"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentTemplateVersion_templateId_version_key" ON "DocumentTemplateVersion"("templateId", "version");

-- CreateIndex
CREATE INDEX "DocumentRequirement_ownerId_trigger_isActive_idx" ON "DocumentRequirement"("ownerId", "trigger", "isActive");

-- CreateIndex
CREATE INDEX "MemberDocument_ownerId_status_createdAt_idx" ON "MemberDocument"("ownerId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MemberDocument_ownerId_memberId_templateId_idx" ON "MemberDocument"("ownerId", "memberId", "templateId");

-- CreateIndex
CREATE INDEX "MemberDocument_ownerId_validUntil_idx" ON "MemberDocument"("ownerId", "validUntil");

-- CreateIndex
CREATE INDEX "MemberDocument_ownerId_signBy_idx" ON "MemberDocument"("ownerId", "signBy");

-- CreateIndex
CREATE INDEX "DocumentEvent_documentId_createdAt_idx" ON "DocumentEvent"("documentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentSigningToken_tokenHash_key" ON "DocumentSigningToken"("tokenHash");

-- CreateIndex
CREATE INDEX "DocumentSigningToken_documentId_idx" ON "DocumentSigningToken"("documentId");

-- CreateIndex
CREATE INDEX "StaffCompensation_ownerId_staffId_idx" ON "StaffCompensation"("ownerId", "staffId");

-- CreateIndex
CREATE INDEX "CommissionPlan_ownerId_isActive_idx" ON "CommissionPlan"("ownerId", "isActive");

-- CreateIndex
CREATE INDEX "CommissionRule_planId_idx" ON "CommissionRule"("planId");

-- CreateIndex
CREATE INDEX "CommissionAssignment_ownerId_staffId_idx" ON "CommissionAssignment"("ownerId", "staffId");

-- CreateIndex
CREATE INDEX "SaleAttribution_ownerId_staffId_idx" ON "SaleAttribution"("ownerId", "staffId");

-- CreateIndex
CREATE UNIQUE INDEX "SaleAttribution_membershipId_staffId_key" ON "SaleAttribution"("membershipId", "staffId");

-- CreateIndex
CREATE INDEX "PayrollPeriod_ownerId_startsAt_idx" ON "PayrollPeriod"("ownerId", "startsAt");

-- CreateIndex
CREATE INDEX "PayrollEntry_ownerId_periodId_staffId_idx" ON "PayrollEntry"("ownerId", "periodId", "staffId");

-- CreateIndex
CREATE INDEX "PayrollEntry_ownerId_staffId_earnedAt_idx" ON "PayrollEntry"("ownerId", "staffId", "earnedAt");

-- CreateIndex
CREATE INDEX "PayrollEntry_ownerId_sourceType_sourceId_idx" ON "PayrollEntry"("ownerId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "PayrollEntry_ownerId_invoiceId_idx" ON "PayrollEntry"("ownerId", "invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollEntry_ownerId_sourceKey_key" ON "PayrollEntry"("ownerId", "sourceKey");

-- CreateIndex
CREATE INDEX "PayrollSource_ownerId_idx" ON "PayrollSource"("ownerId");

-- CreateIndex
CREATE INDEX "PayrollTimeEntry_ownerId_periodId_staffId_idx" ON "PayrollTimeEntry"("ownerId", "periodId", "staffId");

-- CreateIndex
CREATE INDEX "PayrollEvent_ownerId_periodId_createdAt_idx" ON "PayrollEvent"("ownerId", "periodId", "createdAt");

-- CreateIndex
CREATE INDEX "Member_householdId_idx" ON "Member"("householdId");

-- CreateIndex
CREATE INDEX "Transaction_provider_providerReference_idx" ON "Transaction"("provider", "providerReference");

-- CreateIndex
CREATE INDEX "Transaction_payerMemberId_createdAt_idx" ON "Transaction"("payerMemberId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_status_nextAttemptAt_idx" ON "Message"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SmsConversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAccount" ADD CONSTRAINT "PaymentAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberAccount" ADD CONSTRAINT "MemberAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberAccount" ADD CONSTRAINT "MemberAccount_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberAuthToken" ADD CONSTRAINT "MemberAuthToken_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberNotification" ADD CONSTRAINT "MemberNotification_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberDevice" ADD CONSTRAINT "MemberDevice_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentType" ADD CONSTRAINT "AppointmentType_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentTypeStaff" ADD CONSTRAINT "AppointmentTypeStaff_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AppointmentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppointmentTypeStaff" ADD CONSTRAINT "AppointmentTypeStaff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAvailability" ADD CONSTRAINT "StaffAvailability_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffAvailability" ADD CONSTRAINT "StaffAvailability_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTimeOff" ADD CONSTRAINT "StaffTimeOff_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTimeOff" ADD CONSTRAINT "StaffTimeOff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "AppointmentType"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimeClaim" ADD CONSTRAINT "TimeClaim_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Household" ADD CONSTRAINT "Household_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCredit" ADD CONSTRAINT "AccountCredit_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Owner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountCredit" ADD CONSTRAINT "AccountCredit_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditApplication" ADD CONSTRAINT "CreditApplication_creditId_fkey" FOREIGN KEY ("creditId") REFERENCES "AccountCredit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutVersion" ADD CONSTRAINT "WorkoutVersion_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramDay" ADD CONSTRAINT "ProgramDay_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutSetLog" ADD CONSTRAINT "WorkoutSetLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutItemLog" ADD CONSTRAINT "WorkoutItemLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkoutSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "WebhookEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookAttempt" ADD CONSTRAINT "WebhookAttempt_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "WebhookDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentTemplateVersion" ADD CONSTRAINT "DocumentTemplateVersion_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "DocumentTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberDocument" ADD CONSTRAINT "MemberDocument_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentEvent" ADD CONSTRAINT "DocumentEvent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "MemberDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentSigningToken" ADD CONSTRAINT "DocumentSigningToken_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "MemberDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionRule" ADD CONSTRAINT "CommissionRule_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CommissionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionAssignment" ADD CONSTRAINT "CommissionAssignment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "CommissionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

