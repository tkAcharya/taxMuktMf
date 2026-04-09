# CAS Analyzer — Chrome Extension
### Mutual Fund Portfolio Analysis + LTCG Tax Harvesting Calculator

A Chrome extension that parses Indian mutual fund **Consolidated Account Statements (CAS)** entirely in your browser and gives you:

- 📊 **Portfolio overview** — current value, invested amount, unrealised P&L
- 🧾 **Holding breakdown** — by fund type (Equity/Debt/Hybrid), with ISIN, units, NAV
- 💰 **LTCG harvesting calculator** — tells you exactly which units to sell (and reinvest) to stay under the ₹1.25L tax-free limit

**All parsing happens locally in your browser. No data is sent anywhere.**

---

## Supported CAS formats

| Registrar | Format |
|-----------|--------|
| CAMS | ✅ |
| KFin (Karvy) | ✅ |
| MFCentral | ✅ |
| NSDL | ✅ |

Get your CAS from: [MFCentral](https://mfcentral.in) · [CAMS](https://www.camsonline.com) · [KFintech](https://mfs.kfintech.com)

---

## Installation

1. Open Chrome → go to `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select this `cas-extension` folder

The extension icon will appear in your toolbar. Click it to open the popup.

---

## How to use

1. **Upload** your CAS PDF (drag-drop or browse)
2. **Portfolio tab** — see your holdings, gains, fund-type breakdown
3. **LTCG Harvesting tab**:
   - Enter your exemption limit (default ₹1.25L for FY2024-25)
   - Enter any LTCG you've already booked this FY
   - Click **Calculate** to see which funds to sell + reinvest

### LTCG Harvesting strategy
- Sell the recommended units to book gains up to ₹1.25L (tax-free)
- Immediately reinvest the same amount in the same fund
- Your cost basis resets to today's NAV → future gains are reduced
- Net result: zero tax this year, lower taxable gains in future

---

## Tax rules used

| Asset class | LTCG threshold | Tax rate (above ₹1.25L) |
|-------------|---------------|--------------------------|
| Equity / Hybrid | 12 months | 12.5% (no indexation) |
| Debt | 36 months | As per income tax slab |

*Debt fund LTCG is shown informatively but excluded from harvesting calculator (slab-rate taxation makes the strategy less useful).*

---

## File structure

```
cas-extension/
├── manifest.json       # Chrome extension manifest v3
├── popup.html          # Extension popup UI
├── popup.css           # Styles
├── popup.js            # UI controller
├── parser.js           # CAS PDF parser + LTCG calculator
├── icons/              # Extension icons
└── lib/
    ├── pdf.min.mjs         # PDF.js (bundled locally)
    └── pdf.worker.min.mjs  # PDF.js worker
```

---

## Limitations & known issues

- Very old CAS PDFs (pre-2015) may have non-standard formatting — check the **Raw Data** tab to verify extraction
- Scanned/image PDFs won't parse (CAS PDFs from registrars are always text-based)
- XIRR calculation is approximate (uses simple return, not cash-flow-weighted)
- Bonus units, dividend reinvestments, and inter-scheme switches are detected but FIFO lot assignment may vary from the registrar's calculation

---

## Privacy

This extension has **no network permissions**. It cannot make any external requests. Your PDF and financial data never leave your device.
