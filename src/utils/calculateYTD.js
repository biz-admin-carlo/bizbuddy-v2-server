const { prisma } = require('@config/connection');

/**
 * Calculate Year-to-Date totals for an employee
 * @param {string} employeeId - Employee ID
 * @param {string} companyId - Company ID
 * @param {Date} periodEnd - End date of current payroll period
 * @returns {object} YTD totals
 */
async function calculateYTD(employeeId, companyId, periodEnd) {
  try {
    // Get start of current year
    const currentYear = new Date(periodEnd).getFullYear();
    const yearStart = new Date(`${currentYear}-01-01T00:00:00Z`);
    const yearEnd = new Date(periodEnd); // Up to and including current period

    console.log(`📊 Calculating YTD for employee ${employeeId}`);
    console.log(`   Year: ${currentYear}`);
    console.log(`   From: ${yearStart.toISOString()}`);
    console.log(`   To: ${yearEnd.toISOString()}`);

    // Fetch all finalized payroll runs for this employee in current year
    const payrollRuns = await prisma.payrollRun.findMany({
      where: {
        companyId,
        locked: true,
        periodEnd: {
          gte: yearStart,
          lte: yearEnd,
        },
      },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        payrollSnapshot: true,
      },
      orderBy: {
        periodEnd: 'asc',
      },
    });

    console.log(`   Found ${payrollRuns.length} payroll runs in ${currentYear}`);

    // Initialize YTD totals
    const ytd = {
      grossEarnings: 0,
      
      // Earnings breakdown
      regularHours: 0,
      regularPay: 0,
      overtimeHours: 0,
      overtimePay: 0,
      ptoHours: 0,
      ptoPay: 0,
      holidayHours: 0,
      holidayPay: 0,
      bonuses: 0,
      commissions: 0,
      
      // Taxes
      federalTax: 0,
      stateTax: 0,
      fica: 0,
      medicare: 0,
      sdi: 0,
      totalTaxes: 0,
      
      // Deductions
      healthInsurance: 0,
      dentalInsurance: 0,
      retirement401k: 0,
      garnishments: 0,
      advanceRepayment: 0,
      totalDeductions: 0,
      
      // Net pay
      netPay: 0,
      
      // Metadata
      payPeriodsIncluded: 0,
      lastPeriodEnd: null,
    };

    // Sum up all periods
    payrollRuns.forEach((run) => {
      const employee = run.payrollSnapshot?.employees?.find(
        (e) => e.employeeId === employeeId
      );

      if (!employee) {
        console.log(`   ⚠️  Employee not found in run ${run.id}`);
        return;
      }

      console.log(`   ✅ Processing run ${run.id}: Period ending ${run.periodEnd.toISOString().split('T')[0]}`);

      ytd.payPeriodsIncluded++;
      ytd.lastPeriodEnd = run.periodEnd;

      // Add gross earnings
      ytd.grossEarnings += parseFloat(employee.grossPay || 0);

      // Add earnings breakdown
      if (employee.earnings) {
        ytd.regularHours += parseFloat(employee.earnings.regularHours || 0);
        ytd.regularPay += parseFloat(employee.earnings.regularPay || 0);
        ytd.overtimeHours += parseFloat(employee.earnings.overtimeHours || 0);
        ytd.overtimePay += parseFloat(employee.earnings.overtimePay || 0);
        ytd.ptoHours += parseFloat(employee.earnings.ptoHours || 0);
        ytd.ptoPay += parseFloat(employee.earnings.ptoPay || 0);
        ytd.holidayHours += parseFloat(employee.earnings.holidayHours || 0);
        ytd.holidayPay += parseFloat(employee.earnings.holidayPay || 0);
        ytd.bonuses += parseFloat(employee.earnings.bonuses || 0);
        ytd.commissions += parseFloat(employee.earnings.commissions || 0);
      }

      // Add taxes
      if (employee.taxes) {
        ytd.federalTax += parseFloat(employee.taxes.federalTax || 0);
        ytd.stateTax += parseFloat(employee.taxes.stateTax || 0);
        ytd.fica += parseFloat(employee.taxes.fica || 0);
        ytd.medicare += parseFloat(employee.taxes.medicare || 0);
        ytd.sdi += parseFloat(employee.taxes.sdi || 0);
        ytd.totalTaxes += parseFloat(employee.totalTaxes || 0);
      }

      // Add deductions
      if (employee.deductions) {
        ytd.healthInsurance += parseFloat(employee.deductions.healthInsurance || 0);
        ytd.dentalInsurance += parseFloat(employee.deductions.dentalInsurance || 0);
        ytd.retirement401k += parseFloat(employee.deductions.retirement401k || 0);
        ytd.garnishments += parseFloat(employee.deductions.garnishments || 0);
        ytd.advanceRepayment += parseFloat(employee.deductions.advanceRepayment || 0);
        ytd.totalDeductions += parseFloat(employee.totalDeductions || 0);
      }

      // Add net pay
      ytd.netPay += parseFloat(employee.netPay || 0);
    });

    console.log(`📊 YTD Summary:`);
    console.log(`   Pay Periods: ${ytd.payPeriodsIncluded}`);
    console.log(`   Gross: $${ytd.grossEarnings.toFixed(2)}`);
    console.log(`   Taxes: $${ytd.totalTaxes.toFixed(2)}`);
    console.log(`   Deductions: $${ytd.totalDeductions.toFixed(2)}`);
    console.log(`   Net: $${ytd.netPay.toFixed(2)}`);

    return ytd;
  } catch (error) {
    console.error('❌ Error calculating YTD:', error);
    // Return zeros if calculation fails
    return {
      grossEarnings: 0,
      regularHours: 0,
      regularPay: 0,
      overtimeHours: 0,
      overtimePay: 0,
      totalTaxes: 0,
      totalDeductions: 0,
      netPay: 0,
      payPeriodsIncluded: 0,
      lastPeriodEnd: null,
    };
  }
}

module.exports = calculateYTD;