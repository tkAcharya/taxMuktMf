# taxMuktMf 🇮🇳

**Stay under the ₹1.25L LTCG tax-free limit — automatically.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Local First](https://img.shields.io/badge/Privacy-Local--First-green)
![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue)
![No Server](https://img.shields.io/badge/Server-None-lightgrey)

Indian equity mutual fund investors get a ₹1.25L annual LTCG exemption under Section 112A. Few use it — because figuring out which units to sell, how many, and what the exact gain would be means digging through a Portfolio Statement, cross-referencing two sections, and doing per-lot arithmetic across six or more funds. taxMuktMf does this in under 30 seconds, entirely inside your browser.

---
## Don't just take my word for it—watch it work!

Video: https://youtu.be/E3ZOXjN4q4o
<img width="662" height="319" alt="image" src="https://github.com/user-attachments/assets/0dd8e1b6-3358-4e4a-94e7-e109ffade88e" />
<img width="1340" height="1284" alt="image" src="https://github.com/user-attachments/assets/39028b5d-ea31-4021-b433-341d6e1a0d3a" />
<img width="1238" height="1216" alt="image" src="https://github.com/user-attachments/assets/3063946a-8fe2-4df1-80b8-91850f9f8dcd" />
<img width="650" height="614" alt="image" src="https://github.com/user-attachments/assets/c49e3925-2498-4752-9f98-c43d7b06e211" />
<img width="635" height="612" alt="image" src="https://github.com/user-attachments/assets/b6254a58-ebc1-4e00-84a0-3613d6e1ec7a" />

---

## Features

| | Feature | Description |
|--|---------|-------------|
| 📄 | **CAS PDF Parser** | Extracts holdings from Section 3 and aging buckets from Section 5 of your CAMS Portfolio Valuation Statement |
| ⚖️ | **LTCG Engine** | Computes harvestable units per fund — separates <1yr, 1–3yr, and >3yr lots |
| 🎯 | **Tax-Free Limit Tracker** | Enter gains already booked this FY; the plan adjusts to your remaining exemption budget |
| 🔴 | **Live NAV Verification** | Fetches current NAVs from AMFI and flags discrepancies against your statement |
| 📰 | **Fund News** | 5-day NAV history + latest headlines from Google News RSS per fund |
| 🏢 | **Fund Holdings** | Links to Tickertape, Value Research, and Morningstar for underlying stock portfolios |
| 📒 | **Audit Ledger** | Log every sell-and-buyback with date, units, NAV, and computed gain; export/import as JSON |
| 🔒 | **Local-First Privacy** | No backend, no analytics, no account. Your PDF never leaves your device |

---

## Supported Statement Formats

| Registrar | Format | Notes |
|-----------|--------|-------|
| CAMS | ✅ Portfolio Valuation Statement | Primary tested format |
| KFintech (Karvy) | ✅ | Holdings + aging sections |
| MFCentral | ✅ | Consolidated across registrars |
| NSDL | ✅ | |

Get your statement: [camsonline.com](https://www.camsonline.com) → Investors → Statements → Portfolio Valuation Statement

> Text-based PDFs only. Scanned/image PDFs cannot be parsed.

---

## Known Limitations

- XIRR shown is as reported by CAMS, not independently computed
- Aging data from Section 5 may differ on very old statements (pre-2018 formatting)
- Plan NAV is from your statement date — execution values will differ slightly
- Dividend reinvestment and bonus units in older folios may affect cost-basis accuracy
- Planning tool only — does not file taxes or integrate with any broker

---

## Privacy

```json
"permissions": ["storage"],
"host_permissions": [
  "https://portal.amfiindia.com/*",   ← live NAV fetch (GET only)
  "https://api.mfapi.in/*",           ← fund metadata (GET only)
  "https://api.allorigins.win/*"       ← CORS proxy for Google News RSS
]
```

`storage` is `chrome.storage.local` — your device only, not synced. No personal data is sent in any request. Your PDF, PAN, folio numbers, and investment values never leave your browser.

Privacy mode is **on by default** — monetary values, email, and folio numbers are masked with `X` until you click the eye icon in the header.

---

## Getting Started

```
1. Download and unzip taxMuktMf
2. Chrome → chrome://extensions/ → Enable Developer mode
3. Load unpacked → select the taxMuktMf/ folder
4. Click the extension icon → drop your CAMS PDF → done
```

Then: go to the **LTCG** tab, enter any gains already booked this FY, click **Calculate**.

---

## LTCG Harvesting

Sell units to book up to ₹1.25L of long-term gains → immediately reinvest the same amount in the same fund → pay ₹0 tax → cost basis permanently resets to today's NAV.

<details>
<summary>Read more on the strategy</summary>

Under Section 112A, LTCG from equity mutual funds held >12 months is exempt up to ₹1,25,000 per FY. Tax above that is **12.5%** (no indexation).

**Why the math works:** When you sell and immediately rebuy at today's NAV, your new cost basis is higher. All future gains from those units are calculated from the new, higher price — permanently reducing your tax liability on redemption.

**Timing:** Complete both legs within the same trading session. Verify cut-off times with your broker.

| Asset class | Holding period for LTCG | Tax above ₹1.25L |
|-------------|------------------------|-------------------|
| Equity / Hybrid equity | > 12 months | 12.5% (no indexation) |
| Debt / FoF | > 36 months | As per income tax slab |

Debt fund harvesting is shown informatively but excluded from the recommended plan — the 36-month threshold and slab-rate taxation reduce the benefit for most investors.

</details>

---

## Architecture

```
CAMS PDF
  └─► PDF.js (local)
        └─► Section 3 parser  →  holdings: scheme, folio, units, NAV, cost, XIRR
        └─► Section 5 parser  →  aging buckets: <1yr / 1–3yr / >3yr per folio
              └─► mergeAging()
                    └─► computeLTCGHarvesting()  →  greedy fill up to exemption budget
                          └─► chrome.storage.local
                                └─► Popup UI (Portfolio · LTCG · Ledger · Holdings · News · Raw)
```

<details>
<summary>Read more on the architecture</summary>

**Why a browser extension, not a web app?** A web app for financial data creates an implicit trust problem even with a "we don't store your data" promise. An extension eliminates the surface area — there is no server to compromise. The extension runs as a sandboxed popup under Manifest V3, which restricts what it can do by default.

**Section 3 — wrapped scheme names.** When a fund name is long, PDF.js produces the data columns on the first line and the scheme code (e.g. `LD346G`) on a continuation line. The parser uses a pending-entry state machine, holding the partial entry until it sees the code on a continuation line. The guard is `!pending.schemeCode` (not `=== null`) because JS optional chaining returns `undefined` — not `null` — when the match fails.

**Section 5 — two-column aging layout.** The aging section prints up to two folios side-by-side per row, with continuation lines for additional age buckets. Each text line may carry a left-column entry, a right-column entry, or continuation data for either. The parser splits each line at the first `"days "` boundary and maintains separate `leftCtx` / `rightCtx` state so continuation lines are attributed to the correct folio.

**NAV matching against AMFI.** AMFI's `NAVAll.txt` has ~10,000 entries. Matching `"SBI BFS FUND"` against `"SBI Banking & Financial Services Fund"` requires abbreviation expansion (`BFS → Banking Financial Services`, `INFRA → Infrastructure`) and token-set intersection scoring with a threshold of ≥2 matching tokens after filtering stop words.

</details>

<details>
<summary>Project structure</summary>

```
taxMuktMf/
├── manifest.json          # Chrome Manifest V3
├── popup.html             # Extension popup shell (6-tab layout)
├── popup.css              # Dark-mode UI, 600px wide, CSS custom properties
├── popup.js               # UI controller — tab routing, rendering, ledger, storage
├── parser.js              # PDF parsing, NAV matching, LTCG computation, storage I/O
├── icons/
│   ├── icon16.svg
│   ├── icon48.svg
│   └── icon128.svg
└── lib/
    ├── pdf.min.mjs         # PDF.js 4.x — bundled locally, no CDN dependency
    └── pdf.worker.min.mjs  # PDF.js worker thread
```

</details>

---

## Contributing

PRs welcome. Most useful areas:

- Testing against KFintech and MFCentral PDFs (parser has handlers but limited real-world coverage)
- Improving AMFI name-matching for NFO and merged-fund edge cases
- Adding ELSS lock-in period awareness to the harvesting plan

```bash
git clone https://github.com/your-handle/taxMuktMf
# chrome://extensions/ → Load unpacked → select taxMuktMf/
```

---

## License

MIT — see [LICENSE](LICENSE)

*taxMuktMf is a planning tool, not financial advice. Consult a tax professional before acting on its output.*
