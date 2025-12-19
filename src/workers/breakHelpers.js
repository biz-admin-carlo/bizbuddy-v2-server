/**
 * Parse and calculate break times from TimeLog JSON fields
 * @param {Object} timeLog - TimeLog record with coffeeBreaks and lunchBreak
 * @param {Object} department - Department with break policies
 * @returns {Object} Break time breakdown
 */
function calculateBreakTimes(timeLog, department) {
    let totalBreakMinutes = 0;
    let unpaidBreakMinutes = 0;
    let coffeeBreakMinutes = 0;
    let lunchBreakMinutes = 0;
    const coffeeBreaksList = [];
    
    // Parse lunch break
    if (timeLog.lunchBreak && typeof timeLog.lunchBreak === 'object') {
      const { breakOut, breakIn } = timeLog.lunchBreak;
      
      if (breakOut && breakIn) {
        const lunchOut = new Date(breakOut);
        const lunchIn = new Date(breakIn);
        lunchBreakMinutes = (lunchIn - lunchOut) / (60 * 1000);
        
        totalBreakMinutes += lunchBreakMinutes;
        
        // Deduct if unpaid lunch
        if (!department.paidBreak) {
          unpaidBreakMinutes += lunchBreakMinutes;
        }
      }
    }
    
    // Parse coffee breaks
    if (timeLog.coffeeBreaks && Array.isArray(timeLog.coffeeBreaks)) {
      timeLog.coffeeBreaks.forEach((coffeeBreak, index) => {
        if (coffeeBreak.breakOut && coffeeBreak.breakIn) {
          const coffeeOut = new Date(coffeeBreak.breakOut);
          const coffeeIn = new Date(coffeeBreak.breakIn);
          const duration = (coffeeIn - coffeeOut) / (60 * 1000);
          
          coffeeBreaksList.push({
            index: index + 1,
            breakOut: coffeeOut,
            breakIn: coffeeIn,
            duration: duration,
          });
          
          coffeeBreakMinutes += duration;
          totalBreakMinutes += duration;
        }
      });
    }
    
    return {
      totalBreakMinutes: parseFloat(totalBreakMinutes.toFixed(2)),
      unpaidBreakMinutes: parseFloat(unpaidBreakMinutes.toFixed(2)),
      lunchBreakMinutes: parseFloat(lunchBreakMinutes.toFixed(2)),
      coffeeBreakMinutes: parseFloat(coffeeBreakMinutes.toFixed(2)),
      coffeeBreaksList,
      hasLunchBreak: lunchBreakMinutes > 0,
      hasCoffeeBreaks: coffeeBreakMinutes > 0,
    };
  }
  
  /**
   * Check if coffee breaks exceed department policy
   * @param {number} coffeeBreakMinutes - Total coffee break time taken
   * @param {Object} department - Department with coffee break policy
   * @returns {Object} Policy check results
   */
  function checkCoffeeBreakPolicy(coffeeBreakMinutes, department) {
    const maxCount = department.coffeeBreakMaxCount || 0;
    const minutesPerBreak = department.coffeeBreakMinutes || 0;
    const allowedMinutes = maxCount * minutesPerBreak;
    const isPaid = department.coffeeBreakPaid || false;
    
    // No policy = no limits
    if (maxCount === 0 || minutesPerBreak === 0) {
      return {
        hasPolicy: false,
        exceeded: false,
        allowedMinutes: 0,
        actualMinutes: coffeeBreakMinutes,
        excessMinutes: 0,
        deductMinutes: 0,
        isPaid: false,
      };
    }
    
    const exceeded = coffeeBreakMinutes > allowedMinutes;
    const excessMinutes = exceeded ? coffeeBreakMinutes - allowedMinutes : 0;
    
    // CRITICAL: Excess coffee break time is ALWAYS deducted
    // Even if coffee breaks are "paid", excess time is not
    const deductMinutes = excessMinutes;
    
    return {
      hasPolicy: true,
      exceeded,
      allowedMinutes: parseFloat(allowedMinutes.toFixed(2)),
      actualMinutes: parseFloat(coffeeBreakMinutes.toFixed(2)),
      excessMinutes: parseFloat(excessMinutes.toFixed(2)),
      deductMinutes: parseFloat(deductMinutes.toFixed(2)),
      isPaid,
    };
  }
  
  /**
   * Calculate total deductions from breaks
   * @param {Object} breakData - Result from calculateBreakTimes
   * @param {Object} coffeePolicy - Result from checkCoffeeBreakPolicy
   * @returns {number} Total minutes to deduct
   */
  function calculateBreakDeductions(breakData, coffeePolicy) {
    let totalDeductMinutes = 0;
    
    // Add unpaid lunch break time
    totalDeductMinutes += breakData.unpaidBreakMinutes;
    
    // Add excess coffee break time (always deducted)
    totalDeductMinutes += coffeePolicy.deductMinutes;
    
    return parseFloat(totalDeductMinutes.toFixed(2));
  }