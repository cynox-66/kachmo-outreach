# Multimodal AI Subsystem, Prompts & Schema Contracts

> **Status:** Canonical & Active  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## 1. Single-Pass Multimodal Model Architecture

Lead Engine standardizes on **Google Gemini 3.5 Flash-Lite** (`gemini-3.5-flash-lite`) for all AI analysis. A single atomic API call evaluates the mobile viewport screenshot (390x844px), verifies DOM layout metrics, scores the lead, and generates tailored outreach copy.

```
INPUTS (To Gemini 3.5 Flash-Lite)
├── 1. Mobile Viewport Screenshot (JPEG buffer, quality 75)
├── 2. DOM Layout Metrics (hasHorizontalOverflow, scrollWidth, innerWidth, CMS hint)
├── 3. Candidate Metadata (Domain, Name, Source Query, Contact Routes)
└── 4. System Instruction with Strict JSON Schema

                         │
                         ▼
             [ GEMINI 2.5 FLASH-LITE ]
                         │
                         ▼

OUTPUT (Strict Structured JSON Object)
├── Qualified: true / false (4-Gate evaluation)
├── Verified Issues & Exact Evidence Citations
├── Priority Score (0-10)
├── Pitch Angle Classification
└── 100-Word Outreach Draft
```

---

## 2. Production System Prompt (`prompts/qualify.md`)

```markdown
You are the senior technical prospect analyst for an elite freelance web developer specializing in custom responsive web builds, performance engineering, and modern CMS migrations (Webflow, Next.js).

Analyze the provided website candidate using the attached mobile screenshot (iPhone 390x844 viewport) and DOM inspection data.

### 4-GATE QUALIFICATION RULES:
1. GATE 1 (FIT): Must be an independent design agency, branding studio, architecture firm, commercial photographer, or boutique creative service. REJECT massive enterprises, SaaS, government, student resumes.
2. GATE 2 (COMMERCIAL): Must show active paid client work (client logos, case studies, services list).
3. GATE 3 (NEED): Must have at least ONE verifiable technical, mobile layout, or performance flaw. If the site is modern, fast, and flawless: output `qualified: false`.
4. GATE 4 (REACHABILITY): Must have an identifiable contact route (email, contact page, or social handle).

### ZERO-TOLERANCE ANTI-HALLUCINATION RULES:
- You may ONLY claim an issue if empirical evidence exists in the screenshot or DOM metrics.
- NEVER invent client names, awards, traffic numbers, or hypothetical revenue losses.
- Keep the outreach draft strictly under 120 words. Speak as an engineering peer.
```

---

## 3. Strict Output Schema (TypeScript & Zod)

```typescript
import { z } from 'zod';

export const LeadIssueSchema = z.object({
  type: z.enum(['mobile_layout', 'performance', 'positioning', 'technical']),
  evidence: z.string().describe('Exact DOM element or pixel measurement citation')
});

export const LeadEvaluationSchema = z.object({
  qualified: z.boolean(),
  rejection_reason: z.string().nullable(),
  business_type: z.string(),
  fit_level: z.enum(['high', 'medium', 'low']),
  commercial_signal: z.number().min(0).max(3),
  need_severity: z.number().min(0).max(3),
  reachability_score: z.number().min(0).max(2),
  priority_score: z.number().min(0).max(10),
  issues: z.array(LeadIssueSchema).max(2),
  pitch_angle: z.enum([
    'mobile_portfolio_experience',
    'performance_and_speed',
    'modern_cms_migration',
    'conversion_and_clarity'
  ]),
  summary: z.string().max(200),
  draft_subject: z.string(),
  draft_body: z.string()
});

export type LeadEvaluation = z.infer<typeof LeadEvaluationSchema>;
```

---

## 4. Few-Shot Calibration Examples

### Positive Example (Qualified Priority A):
```json
{
  "qualified": true,
  "rejection_reason": null,
  "business_type": "Branding Studio",
  "fit_level": "high",
  "commercial_signal": 3,
  "need_severity": 3,
  "reachability_score": 2,
  "priority_score": 9,
  "issues": [
    {
      "type": "mobile_layout",
      "evidence": "Horizontal overflow at 390px viewport (scrollWidth: 442px) causing CTA button to overlap project gallery."
    }
  ],
  "pitch_angle": "mobile_portfolio_experience",
  "summary": "Premier branding studio in Pune with high-end clients, but mobile viewport has horizontal overflow blocking CTA.",
  "draft_subject": "quick note on studio forma mobile layout",
  "draft_body": "Hi Alex,\n\nI was admiring your recent branding work at Studio Forma—the typography across your case studies is outstanding.\n\nWhile browsing your portfolio on an iPhone viewport, I noticed that the project grid overflows horizontally at 390px, which causes the 'View Projects' button to overlap the image captions.\n\nI specialize in custom responsive builds for creative agencies. Happy to record a 2-minute Loom showing the exact CSS fix if helpful?\n\nBest,\n[Your Name]"
}
```

---

## 5. Prompt Versioning & Regression Harness

All prompts follow semantic versioning (`MAJOR.MINOR.PATCH`). Before deploying any prompt modification, it must pass the **10 Golden Benchmark Fixtures** in `tests/ai.test.ts`:
- **100% JSON Schema Compliance**
- **10/10 Accurate Gating Decisions**
- **Zero Fabricated Defect Claims**
- **All Drafts < 120 Words**
