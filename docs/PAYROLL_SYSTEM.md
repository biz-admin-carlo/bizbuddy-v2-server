# BizBuddy Payroll System Documentation

## Table of Contents
1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Payroll Calculation Process](#payroll-calculation-process)
4. [Year-to-Date (YTD) Calculation](#year-to-date-ytd-calculation)
5. [Tax Calculations](#tax-calculations)
6. [Deductions](#deductions)
7. [Database Schema](#database-schema)
8. [API Endpoints](#api-endpoints)
9. [PDF Generation](#pdf-generation)
10. [Troubleshooting](#troubleshooting)

---

## Overview

The BizBuddy Payroll System is a comprehensive solution for processing employee payroll, managing deductions, calculating taxes, and generating payslips. It supports:

- **Multiple earning types** (Regular, Overtime, PTO, Holiday, Bonuses, Commissions)
- **Automatic tax calculations** (Federal, State, FICA, Medicare, SDI)
- **Custom deductions** (Health Insurance, Retirement, Garnishments)
- **Year-to-Date tracking** for all earnings, taxes, and deductions
- **PDF payslip generation** with company branding
- **Physical check printing** support
- **Payroll history** and audit trails

---

## System Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                    PAYROLL SYSTEM FLOW                       │
└─────────────────────────────────────────────────────────────┘

1. DATA COLLECTION
   ├── Time Logs (from Punch system)
   ├── Employee Rates (hourly/salary)
   ├── Earning Types (regular, OT, PTO, etc.)
   └── Deduction Types (insurance, 401k, etc.)
                  │
                  ▼
2. CALCULATION ENGINE
   ├── Calculate Hours (regular + overtime)
   ├── Calculate Gross Earnings
   ├── Calculate Taxes (Federal, State, FICA, Medicare, SDI)
   ├── Calculate Deductions
   └── Calculate Net Pay
                  │
                  ▼
3. YTD AGGREGATION
   ├── Fetch All Prior Payrolls (current year)
   ├── Sum Earnings
   ├── Sum Taxes
   ├── Sum Deductions
   └── Sum Net Pay
                  │
                  ▼
4. STORAGE & OUTPUT
   ├── Save PayrollRun (with snapshot)
   ├── Generate PDF Payslips
   ├── Generate Physical Checks
   └── Employee Self-Service Access
```

---

## Payroll Calculation Process

### Step 1: Gather Input Data
```javascript
Input = {
  periodStart: Date,
  periodEnd: Date,
  employees: [
    {
      id: string,
      hourlyRate: number,
      hoursWorked: {
        regular: number,
        overtime: number,
        pto: number,
        holiday: number
      },
      deductions: {
        healthInsurance: number,
        retirement401k: number,
        ...
      }
    }
  ]
}
```

### Step 2: Calculate Gross Earnings

For each employee:
```javascript
// Regular Pay
regularPay = regularHours × hourlyRate

// Overtime Pay (1.5x rate)
overtimePay = overtimeHours × (hourlyRate × 1.5)

// PTO Pay
ptoPay = ptoHours × hourlyRate

// Holiday Pay
holidayPay = holidayHours × hourlyRate

// Gross Earnings
grossEarnings = regularPay + overtimePay + ptoPay + holidayPay + bonuses + commissions
```

**Example:**
```
Employee: John Doe
Hourly Rate: $21.00/hr

Regular Hours: 80 hrs × $21.00 = $1,680.00
Overtime Hours: 5 hrs × $31.50 = $157.50
PTO Hours: 8 hrs × $21.00 = $168.00
─────────────────────────────────────────
GROSS EARNINGS: $2,005.50
```

### Step 3: Calculate Taxes
```javascript
// Federal Income Tax (simplified - actual uses tax brackets)
federalTax = grossEarnings × 0.12  // 12% bracket

// State Income Tax (California)
stateTax = grossEarnings × 0.05    // 5% CA rate

// Social Security (FICA)
fica = grossEarnings × 0.062       // 6.2% up to wage base limit

// Medicare
medicare = grossEarnings × 0.0145  // 1.45%

// State Disability Insurance (CA SDI)
sdi = grossEarnings × 0.011        // 1.1%

// Total Taxes
totalTaxes = federalTax + stateTax + fica + medicare + sdi
```

**Example:**
```
Gross: $2,005.50

Federal Tax (12%):    $240.66
State Tax (5%):       $100.28
FICA (6.2%):         $124.34
Medicare (1.45%):     $29.08
SDI (1.1%):          $22.06
─────────────────────────────
TOTAL TAXES:          $516.42
```

### Step 4: Calculate Deductions
```javascript
// Pre-defined deductions
healthInsurance = 150.00   // Monthly premium
retirement401k = grossEarnings × 0.05  // 5% contribution
garnishments = 200.00      // Court-ordered
advanceRepayment = 100.00  // Pay advance

totalDeductions = healthInsurance + retirement401k + garnishments + advanceRepayment
```

**Example:**
```
Health Insurance:     $150.00
401(k) (5%):         $100.28
Garnishment:          $200.00
Advance Repayment:    $100.00
─────────────────────────────
TOTAL DEDUCTIONS:     $550.28
```

### Step 5: Calculate Net Pay
```javascript
netPay = grossEarnings - totalTaxes - totalDeductions
```

**Example:**
```
Gross Earnings:      $2,005.50
Total Taxes:         -$516.42
Total Deductions:    -$550.28
─────────────────────────────
NET PAY:             $938.80
```

---

## Year-to-Date (YTD) Calculation

YTD values show cumulative totals from January 1st to the current pay period end date.

### Algorithm
```javascript
function calculateYTD(employeeId, companyId, periodEnd) {
  // 1. Get current year
  const year = periodEnd.getFullYear()
  const yearStart = new Date(`${year}-01-01`)
  
  // 2. Fetch all finalized payroll runs for this employee in current year
  const payrollRuns = await db.payrollRun.findMany({
    where: {
      companyId: companyId,
      locked: true,
      periodEnd: { gte: yearStart, lte: periodEnd }
    }
  })
  
  // 3. Initialize YTD totals
  const ytd = {
    grossEarnings: 0,
    regularPay: 0,
    overtimePay: 0,
    // ... all other fields
  }
  
  // 4. Sum all pay periods
  for (const run of payrollRuns) {
    const employee = run.payrollSnapshot.employees.find(e => e.employeeId === employeeId)
    
    if (employee) {
      ytd.grossEarnings += employee.grossPay
      ytd.federalTax += employee.taxes.federalTax
      ytd.totalTaxes += employee.totalTaxes
      ytd.netPay += employee.netPay
      // ... sum all fields
    }
  }
  
  return ytd
}
```

### Example YTD Calculation

**Employee has 3 pay periods in 2025:**

| Pay Period | Gross | Fed Tax | Net Pay |
|------------|-------|---------|---------|
| 01/01-01/15 | $1,680.00 | $201.60 | $1,200.00 |
| 01/16-01/31 | $1,848.00 | $221.76 | $1,320.00 |
| **Current** (02/01-02/15) | **$2,005.50** | **$240.66** | **$938.80** |

**YTD Totals:**
```
YTD Gross = $1,680 + $1,848 + $2,005.50 = $5,533.50
YTD Fed Tax = $201.60 + $221.76 + $240.66 = $664.02
YTD Net Pay = $1,200 + $1,320 + $938.80 = $3,458.80
```

### YTD on Payslip
```
EARNINGS                Hours    Current      YTD
Regular Hours           80.00    $1,680.00    $4,848.00
Overtime Hours          5.00     $157.50      $425.50
PTO Hours               8.00     $168.00      $260.00
                                 ──────────   ──────────
GROSS PAY                        $2,005.50    $5,533.50

TAXES                            Current      YTD
Federal Income Tax               $240.66      $664.02
State Income Tax                 $100.28      $276.68
FICA                            $124.34      $343.08
Medicare                        $29.08       $80.24
SDI                             $22.06       $60.87
                                ──────────   ──────────
TOTAL TAXES                     $516.42      $1,424.89

NET PAY                         $938.80      $3,458.80
```

---

## Tax Calculations

### Federal Income Tax

Uses simplified flat rate (actual system should use tax brackets):
```javascript
// 2025 Tax Brackets (Simplified)
if (annualizedIncome <= 11600) {
  federalTax = grossEarnings × 0.10  // 10%
} else if (annualizedIncome <= 47150) {
  federalTax = grossEarnings × 0.12  // 12%
} else if (annualizedIncome <= 100525) {
  federalTax = grossEarnings × 0.22  // 22%
} else {
  federalTax = grossEarnings × 0.24  // 24%
}
```

### State Income Tax (California)
```javascript
// California flat rate (simplified)
stateTax = grossEarnings × 0.05  // 5%
```

### FICA (Social Security)
```javascript
// 6.2% up to wage base limit ($168,600 in 2024)
const FICA_RATE = 0.062
const FICA_WAGE_BASE = 168600

if (ytdGross + grossEarnings <= FICA_WAGE_BASE) {
  fica = grossEarnings × FICA_RATE
} else {
  // Cap at wage base
  fica = Math.max(0, (FICA_WAGE_BASE - ytdGross) × FICA_RATE)
}
```

### Medicare
```javascript
// 1.45% with no wage limit
medicare = grossEarnings × 0.0145

// Additional 0.9% for high earners (>$200k)
if (ytdGross + grossEarnings > 200000) {
  additionalMedicare = (grossEarnings - (200000 - ytdGross)) × 0.009
  medicare += additionalMedicare
}
```

### State Disability Insurance (SDI)
```javascript
// California SDI: 1.1% up to wage base
const SDI_RATE = 0.011
const SDI_WAGE_BASE = 153164  // 2024

if (ytdGross + grossEarnings <= SDI_WAGE_BASE) {
  sdi = grossEarnings × SDI_RATE
} else {
  sdi = Math.max(0, (SDI_WAGE_BASE - ytdGross) × SDI_RATE)
}
```

---

## Deductions

### Pre-Tax Deductions
- 401(k) Contributions
- Health Insurance Premiums
- FSA/HSA Contributions
- Commuter Benefits

### Post-Tax Deductions
- Roth 401(k) Contributions
- Life Insurance
- Garnishments
- Advance Repayments
- Union Dues

### Calculation Order
```
1. Gross Earnings
2. - Pre-Tax Deductions
3. = Taxable Income
4. Calculate Taxes on Taxable Income
5. - Taxes
6. - Post-Tax Deductions
7. = Net Pay
```

---

## Database Schema

### PayrollRun Table
```prisma
model PayrollRun {
  id               String   @id @default(uuid())
  companyId        String
  periodStart      DateTime
  periodEnd        DateTime
  payDate          DateTime
  checkNumberStart String
  
  status           String   @default("draft")
  locked           Boolean  @default(false)
  
  totalGross       Decimal  @db.Decimal(10, 2)
  totalTaxes       Decimal  @db.Decimal(10, 2)
  totalDeductions  Decimal  @db.Decimal(10, 2)
  totalNet         Decimal  @db.Decimal(10, 2)
  
  payrollSnapshot  Json     // Frozen snapshot of all data
  
  savedBy          String
  savedAt          DateTime
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}
```

### PayrollSnapshot Structure
```javascript
{
  payDate: "2025-02-15",
  periodStart: "2025-02-01",
  periodEnd: "2025-02-15",
  checkNumberStart: "1001",
  processedAt: "2025-02-15T10:00:00Z",
  processedBy: "user-id",
  
  employees: [
    {
      employeeId: "emp-123",
      employeeName: "John Doe",
      position: "Software Engineer",
      payType: "hourly",
      checkNumber: "1001",
      
      // Earnings
      earnings: {
        regularHours: 80,
        regularPay: 1680.00,
        overtimeHours: 5,
        overtimePay: 157.50,
        ptoHours: 8,
        ptoPay: 168.00,
        bonuses: 0,
        commissions: 0
      },
      grossPay: 2005.50,
      
      // Taxes
      taxes: {
        federalTax: 240.66,
        stateTax: 100.28,
        fica: 124.34,
        medicare: 29.08,
        sdi: 22.06,
        totalTaxes: 516.42
      },
      
      // Deductions
      deductions: {
        healthInsurance: 150.00,
        retirement401k: 100.28,
        garnishments: 200.00,
        advanceRepayment: 100.00
      },
      totalDeductions: 550.28,
      
      // Net Pay
      netPay: 938.80,
      
      // Hours data
      hoursData: { /* ... */ }
    }
  ],
  
  // Metadata
  earningTypes: [ /* ... */ ],
  deductionTypes: [ /* ... */ ],
  totals: { /* ... */ },
  taxRatesUsed: { /* ... */ },
  systemVersion: "1.0"
}
```

---

## API Endpoints

### Save Payroll Run
```
POST /api/payroll/save
```

### Get Payroll Run
```
GET /api/payroll/:id
```

### List Payroll Runs
```
GET /api/payroll/list
```

### Generate Payslip PDF
```
GET /api/payroll/:payrollRunId/employee/:employeeId/payslip
```

### Get My Payslips (Employee)
```
GET /api/payroll/my-payslips
```

### Download My Payslip (Employee)
```
GET /api/payroll/:payrollRunId/my-payslip
```

---

## PDF Generation

### Payslip Structure

1. **Header**
   - Company name and address
   - "EMPLOYEE PAYSLIP" title

2. **Employee & Period Info**
   - Employee name, position
   - Pay period dates
   - Pay date
   - Check number

3. **Earnings Section**
   - Columns: Description, Hours, Rate, Current, YTD
   - All earning types with values
   - Gross Pay total

4. **Taxes Section**
   - Columns: Description, Current, YTD
   - All tax types
   - Total Taxes

5. **Deductions Section**
   - Columns: Description, Current, YTD
   - All deduction types
   - Total Deductions

6. **Net Pay**
   - Highlighted in orange
   - Shows Current and YTD

7. **Footer**
   - Generation timestamp
   - YTD summary

---

## Troubleshooting

### YTD Shows Zero

**Cause:** YTD calculation function not being called  
**Fix:** Ensure `calculateYTD()` is called before PDF generation

### Taxes Not Calculating

**Cause:** Missing tax rate configuration  
**Fix:** Verify `taxRatesUsed` in payroll snapshot

### Employee Not in Payroll

**Cause:** Employee not included in payroll run  
**Fix:** Check employee status and date range

### PDF Generation Fails

**Cause:** Missing data fields  
**Fix:** Validate all required fields exist in snapshot

---

## Version History

- **v1.0** (2025-01-28): Initial payroll system with YTD calculation