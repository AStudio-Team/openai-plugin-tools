import { z } from "zod";

export const PLATFORMS = ["google_rsa", "meta_feed", "linkedin_single_image", "tiktok_in_feed", "x_promoted_post"] as const;
export const FIELD_TYPES = ["headline","long_headline","description","primary_text","intro_text","ad_text","display_path","business_name","display_name","card_headline","card_description"] as const;
const boundedList = (max: number, itemMax: number) => z.array(z.string().min(1).max(itemMax)).max(max);
export const CampaignBrief = z.object({
  schemaVersion: z.literal("1.0"), revision: z.number().int().min(1), mode: z.literal("from_scratch"),
  campaignName: z.string().min(1).max(100), locale: z.string().min(2).max(35).default("en-US"),
  platforms: z.array(z.enum(PLATFORMS)).min(1).max(5),
  product: z.object({name:z.string().min(1).max(100),category:z.string().min(1).max(100),offer:z.string().min(1).max(500),landingPageSummary:z.string().max(1000).optional()}).strict(),
  objective: z.enum(["awareness","traffic","lead_generation","conversion","app_install"]),
  valueProposition: z.string().min(1).max(500), differentiators: boundedList(5,250),
  audience: z.object({description:z.string().min(1).max(750),awarenessStage:z.enum(["problem_aware","solution_aware","product_aware"]),painPoints:boundedList(5,250),desiredOutcomes:boundedList(5,250)}).strict(),
  voice: z.object({tone:boundedList(5,50).min(1),mustInclude:boundedList(10,100),mustAvoid:boundedList(20,100)}).strict(),
  claims: z.array(z.object({text:z.string().min(1).max(250),evidenceStatus:z.enum(["confirmed","unverified","prohibited"])}).strict()).max(20),
  disclaimer: z.string().max(500).optional(), optionCount: z.number().int().min(3).max(5).default(4)
}).strict();
export type CampaignBriefType = z.infer<typeof CampaignBrief>;
export const ApprovalReceipt = z.object({receiptVersion:z.literal("1.0"),briefDigest:z.string().regex(/^[a-f0-9]{64}$/),briefRevision:z.number().int().min(1),approvedAt:z.string().datetime(),expiresAt:z.string().datetime(),sessionBinding:z.string().min(1).max(128),signature:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type ApprovalReceiptType = z.infer<typeof ApprovalReceipt>;
export const CreativeField = z.object({id:z.string().min(1).max(100),fieldType:z.enum(FIELD_TYPES),text:z.string().min(1).max(2200)}).strict();
export const ConceptOption = z.object({
 id:z.string().regex(/^concept_[a-z0-9_-]+$/),title:z.string().min(1).max(80),angle:z.enum(["pain_point","outcome","social_proof","curiosity","comparison","urgency","identity","contrarian","custom"]),customAngle:z.string().max(100).optional(),hypothesis:z.string().min(1).max(300),rationale:z.string().min(1).max(400),claimReferences:z.array(z.string().max(250)).max(10),platformCopy:z.array(z.object({platform:z.enum(PLATFORMS),fields:z.array(CreativeField).min(1).max(30)}).strict()).min(1).max(5)
}).strict();
export type ConceptOptionType=z.infer<typeof ConceptOption>;
export const ConceptDecision=z.discriminatedUnion("action",[
 z.object({action:z.literal("select"),selectedConceptId:z.string(),selectedFieldIds:z.array(z.string()).max(50).optional(),note:z.string().max(500).optional()}).strict(),
 z.object({action:z.literal("revise"),sourceConceptIds:z.array(z.string()).min(1).max(3),instructions:z.string().min(3).max(1000)}).strict(),
 z.object({action:z.literal("restart"),reason:z.string().max(500).optional()}).strict()
]);
export const ValidationCode=z.enum(["OVER_HARD_LIMIT","OVER_RECOMMENDED_LIMIT","UNDER_MINIMUM_QUANTITY","OVER_MAXIMUM_QUANTITY","UNVERIFIED_CLAIM","PROHIBITED_CLAIM","MISSING_REQUIRED_TEXT","CONTAINS_AVOIDED_TEXT","DUPLICATE_OR_NEAR_DUPLICATE","DEPENDENT_RSA_HEADLINE","EMPTY_FIELD","STALE_PLATFORM_PROFILE"]);
export const ValidationItem=z.object({fieldId:z.string(),platform:z.string(),fieldType:z.string(),text:z.string(),characterCount:z.number().int().nonnegative(),recommendedLimit:z.number().int().positive().optional(),hardLimit:z.number().int().positive().optional(),status:z.enum(["pass","warning","error"]),codes:z.array(ValidationCode),suggestedTrim:z.string().optional()}).strict();
export const ValidationResult=z.object({schemaVersion:z.literal("1.0"),platformProfileVersion:z.string(),checkedAt:z.string().datetime(),overallStatus:z.enum(["pass","warning","blocked"]),items:z.array(ValidationItem),disclaimer:z.literal("Platform requirements can change. Confirm final copy in the platform preview before publishing.")}).strict();
export type ValidationResultType=z.infer<typeof ValidationResult>;
export const ExportPackage=z.object({exportVersion:z.literal("1.0"),campaignName:z.string(),generatedAt:z.string().datetime(),platformProfileVersion:z.string(),formats:z.array(z.enum(["csv","json","markdown"])),files:z.array(z.object({name:z.string(),mimeType:z.string(),contentBase64:z.string(),sha256:z.string()}).strict()),warnings:z.array(z.string()),publicationStatus:z.literal("not_published")}).strict();
export type ExportPackageType=z.infer<typeof ExportPackage>;
