# Data Models, Google Sheets Database & CRM Specification

> **Status:** Canonical & Active  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## 1. The Canonical Lead Object

The `CanonicalLead` represents an audited, evaluated, and prioritized prospect opportunity mapped directly to a single spreadsheet row:

```typescript
export interface CanonicalLead {
  id: string;                      // "20260809-001"
  canonicalDomain: string;         // "forma-arch.com"
  name: string;                    // "Studio Forma"
  businessType: string;            // "Architectural Studio"
  source: string;                  // "gemini_search_grounding"
  sourceQuery?: string;            // "architectural studio Pune projects"
  discoveredAt: string;            // ISO 8601 UTC timestamp
  websiteUrl: string;              // "https://forma-arch.com"
  contactEmail?: string;           // "contact@forma-arch.com"
  contactUrl?: string;             // "https://forma-arch.com/contact"
  socialUrl?: string;              // "https://instagram.com/studioforma"
  httpStatus: number;              // 200
  techStackHint: string;           // "WordPress (Elementor)"
  fitLevel: 'high' | 'medium' | 'low';
  commercialSignal: number;        // 0 to 3
  needSeverity: number;            // 0 to 3
  reachabilityScore: number;       // 0 to 2
  priorityScore: number;           // 0 to 10 (Composite ranking)
  issues: Array<{
    type: 'mobile_layout' | 'performance' | 'positioning' | 'technical';
    evidence: string;
  }>;
  pitchAngle: string;              // "mobile_portfolio_experience"
  summary: string;                 // 2-sentence executive summary
  draftSubject: string;            // Email subject line
  draftBody: string;               // 100-word personalized copy
  recommendedTemplate: string;     // "Template_A_Mobile"
  status: 'NEW' | 'SENT' | 'REJECTED' | 'DEFERRED';
  reviewedAt?: string;
  sentAt?: string;
  reviewNotes?: string;
}
```

---

## 2. Google Sheets Tab Architecture

```
GOOGLE SPREADSHEET (4 TABS)
├── 1. "TODAY"     ──► Daily active review workspace (30-50 priority-ranked leads)
├── 2. "HISTORY"   ──► Permanent deduplication index (every domain ever processed)
├── 3. "OUTCOMES"  ──► Outreach conversion tracker (Sent, Replied, Won, Lost)
└── 4. "SOURCES"   ──► Search query matrix and active channel configuration
```

---

## 3. Tab 1: TODAY Column Schema (24 Columns)

| Col | Header | Type | Description |
| :--- | :--- | :--- | :--- |
| **A** | `id` | String | Unique batch lead ID (`20260809-001`) |
| **B** | `priority_score` | Number | Ranking score (0–10) |
| **C** | `fit_level` | Dropdown | `High`, `Medium`, `Low` |
| **D** | `name` | String | Studio / Agency Name |
| **E** | `business_type`| String | Target niche classification |
| **F** | `website_url` | Hyperlink| Direct clickable target URL |
| **G** | `contact_email`| String | Scraped direct/studio email |
| **H** | `contact_url` | Hyperlink| URL to `/contact` inquiry page |
| **I** | `pitch_angle` | String | Recommended outreach theme |
| **J** | `issue_1` | String | Primary verified technical flaw |
| **K** | `evidence_1` | String | DOM or viewport measurement citation |
| **L** | `issue_2` | String | Secondary flaw (optional) |
| **M** | `tech_stack` | String | Detected CMS / framework |
| **N** | `draft_subject`| String | Ready-to-use email subject line |
| **O** | `draft_body` | Long Text| Generated 100-word draft copy |
| **P** | `status` | Dropdown | `NEW`, `SENT`, `REJECTED`, `DEFERRED` |
| **Q** | `template_used`| Dropdown | `Template_A`, `Template_B`, `Template_C` |
| **R** | `review_notes` | Text | Human operator custom notes |
| **S** | `source` | String | Sourcing channel identifier |
| **T** | `source_query` | String | Discovery search string |
| **U** | `discovered_at`| DateTime | UTC timestamp of discovery |
| **V** | `sent_at` | DateTime | Timestamp of human send |
| **W** | `commercial_val`| Number | Commercial strength signal (0–3) |
| **X** | `reach_val` | Number | Reachability strength (0–2) |

---

## 4. Google Sheets API Batch Append Integration

Lead Engine uses a Google Cloud Service Account to batch write rows in a single API call:

```typescript
import { google } from 'googleapis';

export async function appendLeadsToSheet(spreadsheetId: string, leads: CanonicalLead[]): Promise<void> {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const rows = leads.map(l => [
    l.id, l.priorityScore, l.fitLevel, l.name, l.businessType, l.websiteUrl,
    l.contactEmail || '', l.contactUrl || '', l.pitchAngle,
    l.issues[0]?.type || '', l.issues[0]?.evidence || '', l.issues[1]?.type || '',
    l.techStackHint, l.draftSubject, l.draftBody, 'NEW', l.recommendedTemplate,
    '', l.source, l.sourceQuery || '', l.discoveredAt, '', l.commercialSignal, l.reachabilityScore
  ]);

  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: 'TODAY!A2:X',
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: rows }
  });
}
```
