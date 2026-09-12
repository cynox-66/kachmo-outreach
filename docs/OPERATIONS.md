# Operations, Metrics, Validation & Health Dashboard

> **Status:** Canonical & Active  
> **Owner:** Solo Operator / Principal Engineer  
> **Last Updated:** 2026-08-09  
> **Version:** 1.0.0  

---

## 1. North Star Metric & Conversion Model

```
┌────────────────────────────────────────────────────────────────────────┐
│                           NORTH STAR METRIC                            │
│ Number of Qualified, Contactable Prospects Reviewed and Dispatched in  │
│ ≤ 30 Minutes of Operator Effort per Run (Target: 30–50 Leads/Run).     │
└────────────────────────────────────────────────────────────────────────┘
```

### Monthly Business Conversion Model:
$$\text{Monthly Dispatched Outreach} = 30 \text{ leads/run} \times 13 \text{ runs} = 390 \text{ Prospects}$$

> Recomputed 2026-09-11 for the alternate-day cadence (Mon/Wed/Fri ≈ 13 runs/month).
> The previous model assumed a daily cron and 22 working days (660 prospects).

| Conversion Metric | Conservative Benchmark | Monthly Expected Output |
| :--- | :--- | :--- |
| **Positive Reply Rate** | 2.5% – 4.0% | 10 – 16 Interested Inquiries |
| **Discovery Call / Audit Booked**| 30% of positive replies | 3 – 5 Discovery Calls |
| **Proposal Delivered** | 60% of discovery calls | 2 – 3 Proposals |
| **Closed Client Engagement** | 33% of proposals | **0 – 1 Closed Clients / Month** |
| **Average Client Deal Value** | $1,500 – $3,500 | **$0 – $3,500 Monthly Revenue** |

---

## 2. The 80% Precision Rule & Validation Milestones

$$\text{Operator Precision Rate} = \frac{\text{Leads Approved for Outreach}}{\text{Total Leads Surfaced in TODAY Tab}} \times 100$$

- **Target Precision:** $\ge 80\%$ (Operator approves at least 8 out of every 10 surfaced leads).
- **The First Validation Milestone (Day 7):** Run 100 raw candidates ➔ 30 qualified leads in `TODAY`. The operator must verify that at least 24 (80%) are high-conviction targets before enabling the scheduled cron.
- **Rule:** If precision drops below 65%, **halt automated crons immediately** and refine search queries and regex rules.

---

## 3. Operational Health Dashboard

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SYSTEM HEALTH STATES                            │
│                                                                        │
│   [ GREEN ]   HEALTHY:  All metrics on target; 100% automated flow.    │
│   [ YELLOW ]  WARNING:  Sub-optimal yields; requires weekend tuning.   │
│   [ RED ]     CRITICAL: Execution halted; immediate engineering fix.   │
└────────────────────────────────────────────────────────────────────────┘
```

| Operational Metric | Healthy (Green) | Warning (Yellow) | Critical (Red) |
| :--- | :--- | :--- | :--- |
| **Qualified Leads / Run** | 30 – 50 leads | 15 – 29 leads | < 15 leads |
| **Operator Precision Rate**| $\ge 80\%$ | $65\% - 79\%$ | $< 65\%$ |
| **Positive Reply Rate** | $\ge 3.0\%$ | $1.5\% - 2.9\%$ | $< 1.5\%$ (after 100 sends) |
| **Monthly Cloud Spend** | $\le$ $2.10 / month | $2.10 – $2.50 / month | $>$ $2.50 / month |
| **CI Execution Time** | $\le 18$ minutes | 19 – 25 minutes | $> 25$ minutes |
| **AI Hallucinations** | 0 per batch | 1 per batch | $\ge 2$ per batch |

### Critical State Emergency Runbooks:
1. **Spend > $2.50/mo:** Circuit breaker trips. Inspect Gemini token usage logs; throttle batch candidate size.
2. **Reply Rate < 1.5%:** **Halt code engineering.** Rework email copy templates and value proposition in `docs/OUTREACH.md`.

---

## 4. Sunday Weekly Review Ritual

Every Sunday at 18:00 (30–45 minutes), the operator conducts an audit:

```markdown
### WEEKLY AUDIT SCORECARD (Week Ending: YYYY-MM-DD)
1. PIPELINE THROUGHPUT
   - Leads Surfaced in "TODAY": ______ | Leads Dispatched: ______ | Precision: _____%
2. CONVERSION & OUTCOMES
   - Emails Sent: ______ | Positive Replies: ______ (____%) | Closed Deals: ______ | Revenue: $______
3. OPERATIONAL EFFORT
   - Daily Review Hours: ______ hrs | Maintenance Hours: ______ hrs | API Spend: $______
4. ACTIONS FOR UPCOMING WEEK
   - High-Yield Queries (> 4% reply): Retain & create geographic variations in SOURCES.
   - Zero-Yield Queries (< 1% reply): Disable immediately (is_active = FALSE).
```
