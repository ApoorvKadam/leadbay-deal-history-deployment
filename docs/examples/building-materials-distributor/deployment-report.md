# Leadbay deal-history deployment report

## 1. Executive summary

The local policy review selected 3 question additions and 1 explicit anti-pattern addition. The held-out top bucket shows a 35.0 percentage-point association above the holdout baseline. These are deployment-review signals, not performance guarantees.

## 2. Customer objective and scenario disclosure

**Objective:** Find regional contractors and suppliers likely to buy through field sales.

This report uses **synthetic data** for a fictional deployment scenario. It does not report customer performance, revenue impact, or production Leadbay behavior.

## 3. Source data and cohort

- Historical source rows: 81
- Normalized deals: 80
- Company identity groups: 71
- Training rows: 60
- Held-out rows: 20
- Grouped temporal holdout starts at: 2024-01-15

## 4. Data-quality findings

- Exact duplicate export rows collapsed: 1
- Normalization warnings: 8
- Current prospects: 5

## 5. Leakage and prohibited-field decisions

The following fields were excluded from policy evidence: Deal Stage, Win Probability, Forecast Category, Final Sales Notes. Company identity groups were kept wholly within one temporal partition to avoid repeated-company leakage.

## 6. Current Leadbay configuration

- Region: us
- Existing qualification questions: 2
- Free question slots: 3
- Current anti-patterns: Consumer-only retailers
- Targeting prompt: Prioritize regional business suppliers serving contractors.

## 7. Proposed qualification questions

- **fragmented_smb_market:** Is the company likely to sell B2B into fragmented small-business markets?
- **multi_territory_field_sales:** Is the company likely to operate field-sales teams across multiple territories?
- **crm_exportability:** Is the company likely to use a CRM or ERP that can export historical deal data?

Rejected or reserved candidate outcomes:

- enterprise_scale: contradicted
- recent_funding: high_missingness
- warehouse_density: unstable

## 8. Explicit vetoes and anti-patterns

- **inactive_company:** Inactive, dissolved, or liquidated companies _(source: customer brief)_

Every veto originates in the customer brief. Historical associations never create a hard veto.

## 9. Evidence table per proposal

| Candidate | Classification | Association (pp) | Known coverage | Direction stability |
|---|---:|---:|---:|---:|
| crm_exportability | eligible | 30.0 | 100.0% | 0.930 |
| enterprise_scale | contradicted | -37.5 | 100.0% | 0.985 |
| fragmented_smb_market | eligible | 47.9 | 100.0% | 1.000 |
| multi_territory_field_sales | eligible | 44.6 | 100.0% | 1.000 |
| recent_funding | high_missingness | -21.4 | 33.3% | 0.785 |
| warehouse_density | unstable | 34.5 | 100.0% | 0.690 |

Positive values describe an association between the candidate trait and historical wins in this synthetic cohort. They do not establish causation.

## 10. Held-out evaluation

- Baseline win rate: 65.0%
- Top-bucket size: 5
- Top-bucket win rate: 100.0%
- Top-bucket lift: 35.0 percentage points
- Policy coverage: 100.0%
- Wins captured in top half: 10/13

## 11. Current-prospect preview

| Rank | Prospect | Local policy score | Known | Unknown | Vetoed |
|---:|---|---:|---:|---:|---|
| 1 | P-STRONG | 3 | 3 | 0 | no |
| 2 | P-CONSUMER | 2 | 3 | 0 | no |
| 3 | P-PARTIAL | 2 | 2 | 1 | no |
| 4 | P-WEAK | 0 | 3 | 0 | no |
| 5 | P-INACTIVE | 3 | 3 | 0 | inactive_company |

This is a local policy ordering. It is not a Leadbay score.

## 12. False positives, false negatives, and unknowns

- False positives in top bucket: none
- False negatives in bottom half: D-053, D-058, D-067
- Vetoed historical wins: none
- Unknowns: fragmented_smb_market: 0 unknown of 20; multi_territory_field_sales: 0 unknown of 20; crm_exportability: 0 unknown of 20

## 13. Exact Leadbay MCP deployment preview

Mock-only projected deployment:

```json
{
  "schema_version": "1.0",
  "status": "projected",
  "persisted": false,
  "accepted_tool_inputs": [
    {
      "name": "leadbay_set_qualification_questions",
      "input": {
        "add_anti_patterns": [
          "Inactive, dissolved, or liquidated companies"
        ]
      }
    },
    {
      "name": "leadbay_set_qualification_questions",
      "input": {
        "add": [
          "Is the company likely to sell B2B into fragmented small-business markets?",
          "Is the company likely to operate field-sales teams across multiple territories?",
          "Is the company likely to use a CRM or ERP that can export historical deal data?"
        ]
      }
    }
  ],
  "starting_state": {
    "schema_version": "1.0",
    "region": "us",
    "user": {
      "id": "synthetic-user",
      "admin": true,
      "organization": {
        "id": 4242,
        "name": "Northstar Building Supply"
      }
    },
    "qualification_questions": [
      {
        "question": "Is the company likely to sell through a repeatable B2B sales process?",
        "lang": "en"
      },
      {
        "question": "Is the company likely to have a dedicated commercial team?",
        "lang": "en"
      }
    ],
    "ideal_buyer_profile": {
      "summary": "Regional B2B suppliers and contractors",
      "key_characteristics": [
        "B2B",
        "repeat purchase potential"
      ],
      "anti_patterns": [
        "Consumer-only retailers"
      ]
    },
    "targeting_prompt": "Prioritize regional business suppliers serving contractors."
  },
  "projected_state": {
    "schema_version": "1.0",
    "region": "us",
    "user": {
      "id": "synthetic-user",
      "admin": true,
      "organization": {
        "id": 4242,
        "name": "Northstar Building Supply"
      }
    },
    "qualification_questions": [
      {
        "question": "Is the company likely to sell through a repeatable B2B sales process?",
        "lang": "en"
      },
      {
        "question": "Is the company likely to have a dedicated commercial team?",
        "lang": "en"
      },
      {
        "question": "Is the company likely to sell B2B into fragmented small-business markets?",
        "lang": "en"
      },
      {
        "question": "Is the company likely to operate field-sales teams across multiple territories?",
        "lang": "en"
      },
      {
        "question": "Is the company likely to use a CRM or ERP that can export historical deal data?",
        "lang": "en"
      }
    ],
    "ideal_buyer_profile": {
      "summary": "Regional B2B suppliers and contractors",
      "key_characteristics": [
        "B2B",
        "repeat purchase potential"
      ],
      "anti_patterns": [
        "Consumer-only retailers",
        "Inactive, dissolved, or liquidated companies"
      ]
    },
    "targeting_prompt": "Prioritize regional business suppliers serving contractors."
  }
}
```

## 14. Required human approvals

- qualification_question_additions
- ideal_buyer_profile_anti_pattern_additions

## 15. Monitoring plan for the first 30 days

- Track accepted, rejected, and unknown answers per proposed question.
- Review false positives and false negatives weekly with sales and RevOps.
- Re-check any explicit veto against newly won accounts before applying it.
- Compare lead quality by question state without treating association as mechanistic proof.

## 16. Limitations and non-claims

- The dataset and customer are synthetic.
- The method evaluates public, observable traits only.
- Small-sample associations are governance aids, not statistical proof.
- The local policy score is not Leadbay's score.
- Mock-mode write previews are projected, not persisted.
