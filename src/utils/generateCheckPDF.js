const PDFDocument = require('pdfkit');

function generateCheckPDF(payrollRun, employee, company, earningTypes, deductionTypes) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        size: 'A4',
        margin: 0 
      });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // ✅ USE CUSTOM POSITIONS OR DEFAULTS (with fontSize support)
      const defaultPositions = {
        date: { x: 480, y: 95, fontSize: 10 },
        amountWords: { x: 90, y: 135, fontSize: 10 },
        amountNumber: { x: 455, y: 133, fontSize: 14 },
        payeeName: { x: 90, y: 170, fontSize: 11 },
        payeeAddress: { x: 90, y: 185, fontSize: 9 },
      };

      const positions = company.checkPositions || defaultPositions;

      // ================== CHECK SECTION (TOP HALF) ==================
      
      // Prepare data first
      const payDateFormatted = new Date(payrollRun.payDate).toLocaleDateString('en-US', { 
        month: 'short', 
        day: '2-digit', 
        year: 'numeric' 
      });
      
      const netPay = parseFloat(employee.netPay);
      const netPayInWords = numberToWords(netPay);
      const cents = Math.round((netPay % 1) * 100);
      const formattedAmount = formatCurrency(netPay);

      // 1. DATE - Use custom position & font size
      const dateSize = positions.date.fontSize || 10;
      doc.fontSize(dateSize).font('Helvetica')
         .text(payDateFormatted, positions.date.x, positions.date.y);

      // 2. AMOUNT IN WORDS - Use custom position & font size
      const amountWordsSize = positions.amountWords.fontSize || 10;
      doc.fontSize(amountWordsSize).font('Helvetica-Bold')
         .text(`${netPayInWords.toUpperCase()} AND ${cents}/100`, 
               positions.amountWords.x, positions.amountWords.y, { width: 350 });

      // 3. AMOUNT (NUMERIC) - Use custom position & font size
      const amountNumberSize = positions.amountNumber.fontSize || 14;
      doc.fontSize(amountNumberSize).font('Helvetica-Bold')
         .text(formattedAmount, positions.amountNumber.x, positions.amountNumber.y, 
               { width: 85, align: 'right' });

      // 4. EMPLOYEE NAME - Use custom position & font size
      const payeeNameSize = positions.payeeName.fontSize || 11;
      doc.fontSize(payeeNameSize).font('Helvetica-Bold')
         .text(employee.employeeName.toUpperCase(), positions.payeeName.x, positions.payeeName.y);

      // 5. EMPLOYEE ADDRESS - Use custom position & font size
      if (employee.address || employee.city || employee.state) {
        const addressLine1 = employee.address || '';
        const addressLine2 = `${employee.city || ''}, ${employee.state || ''} ${employee.postalCode || ''}`.trim();
        
        const addressSize = positions.payeeAddress.fontSize || 9;
        doc.fontSize(addressSize).font('Helvetica')
           .text(addressLine1, positions.payeeAddress.x, positions.payeeAddress.y);
        doc.text(addressLine2, positions.payeeAddress.x, positions.payeeAddress.y + 12);
      }

      // ================== PERFORATED LINE ==================
      const stubStartY = 320;
      doc.fontSize(10).text('✂', 25, stubStartY - 20);
      doc.fontSize(7).fillColor('#999')
         .text('- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -', 
               40, stubStartY - 15);
      doc.fillColor('#000');

      // ================== PAY STUB SECTION (BOTTOM HALF) ==================
      
      // Header
      doc.fontSize(11).font('Helvetica-Bold')
         .text('EMPLOYEE PAY STUB', 50, stubStartY, { align: 'center', width: 495 });
      doc.moveTo(50, stubStartY + 20).lineTo(545, stubStartY + 20).stroke();

      // Company & Employee Info
      let currentY = stubStartY + 30;
      doc.fontSize(8).font('Helvetica-Bold').text(company.name || '', 50, currentY);
      doc.fontSize(8).font('Helvetica').text(company.addressLine1 || '', 50, currentY + 10);
      doc.text(`${company.city || ''}, ${company.state || ''} ${company.postalCode || ''}`.trim(), 50, currentY + 20);

      // Pay Period Info (Right Side)
      doc.fontSize(8).font('Helvetica-Bold').text('Pay Date', 300, currentY);
      doc.font('Helvetica').text(payDateFormatted, 380, currentY);
      
      doc.font('Helvetica-Bold').text('Period From', 300, currentY + 10);
      doc.font('Helvetica').text(new Date(payrollRun.periodStart).toLocaleDateString(), 380, currentY + 10);
      
      doc.font('Helvetica-Bold').text('Period Ending', 300, currentY + 20);
      doc.font('Helvetica').text(new Date(payrollRun.periodEnd).toLocaleDateString(), 380, currentY + 20);

      // Employee Details
      currentY += 50;
      doc.fontSize(9).font('Helvetica-Bold').text(employee.employeeName, 50, currentY);
      doc.fontSize(8).font('Helvetica').text(employee.position || 'No position', 50, currentY + 12);

      // Employee Pay Info (Right Side)
      doc.fontSize(8).font('Helvetica-Bold').text('PTO Balance', 300, currentY);
      const ptoBalance = employee.hoursData?.ptoHoursBalance || 0;
      doc.font('Helvetica').text(`${ptoBalance.toFixed(2)} Hours`, 380, currentY);
      
      doc.font('Helvetica-Bold').text('Rate', 300, currentY + 10);
      const payRate = employee.payrollDetails?.payRate || employee.payRate || '0.00';
      doc.font('Helvetica').text(employee.payType === 'salary' ? 'Salary' : `$${payRate} / HR`, 380, currentY + 10);
      
      doc.font('Helvetica-Bold').text('Pay Type', 300, currentY + 20);
      doc.font('Helvetica').text(employee.payType === 'salary' ? 'Salary' : 'Hourly', 380, currentY + 20);

      // ================== EARNINGS & DEDUCTIONS TABLE ==================
      
      currentY += 50;
      
      // Table borders
      const tableTop = currentY;
      const tableBottom = currentY + 160;
      const centerDivider = 340;
      
      // Horizontal lines
      doc.moveTo(50, tableTop).lineTo(545, tableTop).stroke();
      doc.moveTo(50, tableTop + 15).lineTo(545, tableTop + 15).stroke();
      
      // Vertical divider
      doc.moveTo(centerDivider, tableTop).lineTo(centerDivider, tableBottom).stroke();
      
      currentY += 5;

      // ====== COLUMN HEADERS ======
      doc.fontSize(7).font('Helvetica-Bold');
      
      // Left side: Earnings
      doc.text('Earnings', 60, currentY, { width: 80 });
      doc.text('Hours', 150, currentY, { width: 40, align: 'right' });
      doc.text('Current', 200, currentY, { width: 50, align: 'right' });
      doc.text('YTD', 260, currentY, { width: 60, align: 'right' });

      // Right side: Deductions  
      doc.text('Deductions', 350, currentY);
      doc.text('Current', 450, currentY, { width: 50, align: 'right' });
      doc.text('YTD', 500, currentY, { width: 40, align: 'right' });

      currentY += 15;
      const dataStartY = currentY;

      // ====== EARNINGS DATA ======
      doc.fontSize(7).font('Helvetica');

      if (employee.earnings && earningTypes) {
        Object.entries(employee.earnings).forEach(([earningTypeId, value]) => {
          if (parseFloat(value) > 0) {
            const earningType = earningTypes.find(et => et.id === earningTypeId);
            const label = earningType ? earningType.label : 'Other';
            
            doc.text(label, 60, currentY, { width: 80 });
            
            // Show hours for hourly types
            let hoursValue = '0.00';
            if (earningType?.code === 'regular_hours' && employee.hoursData?.regularHours) {
              hoursValue = employee.hoursData.regularHours.toFixed(2);
            } else if (earningType?.code === 'overtime' && employee.hoursData?.overtimeHours) {
              hoursValue = employee.hoursData.overtimeHours.toFixed(2);
            }
            
            doc.text(hoursValue, 150, currentY, { width: 40, align: 'right' });
            doc.text(parseFloat(value).toFixed(2), 200, currentY, { width: 50, align: 'right' });
            doc.text('0.00', 260, currentY, { width: 60, align: 'right' });
            
            currentY += 10;
          }
        });
      }

      // Gross Earnings Total
      currentY += 5;
      doc.font('Helvetica-Bold').text('Gross Earnings', 60, currentY, { width: 80 });
      doc.text(parseFloat(employee.grossPay).toFixed(2), 200, currentY, { width: 50, align: 'right' });
      doc.text('0.00', 260, currentY, { width: 60, align: 'right' });

      // ====== DEDUCTIONS DATA (Right Column) ======
      currentY = dataStartY;
      doc.font('Helvetica');

      // Taxes
      if (employee.taxes) {
        if (employee.taxes.federalTax > 0) {
          doc.text('Fed Income Tax', 350, currentY, { width: 90 });
          doc.text(parseFloat(employee.taxes.federalTax).toFixed(2), 450, currentY, { width: 50, align: 'right' });
          doc.text('0.00', 500, currentY, { width: 40, align: 'right' });
          currentY += 10;
        }

        if (employee.taxes.fica > 0) {
          doc.text('FICA', 350, currentY, { width: 90 });
          doc.text(parseFloat(employee.taxes.fica).toFixed(2), 450, currentY, { width: 50, align: 'right' });
          doc.text('0.00', 500, currentY, { width: 40, align: 'right' });
          currentY += 10;
        }

        if (employee.taxes.medicare > 0) {
          doc.text('Medicare', 350, currentY, { width: 90 });
          doc.text(parseFloat(employee.taxes.medicare).toFixed(2), 450, currentY, { width: 50, align: 'right' });
          doc.text('0.00', 500, currentY, { width: 40, align: 'right' });
          currentY += 10;
        }

        if (employee.taxes.stateTax > 0) {
          doc.text('State Income Tax', 350, currentY, { width: 90 });
          doc.text(parseFloat(employee.taxes.stateTax).toFixed(2), 450, currentY, { width: 50, align: 'right' });
          doc.text('0.00', 500, currentY, { width: 40, align: 'right' });
          currentY += 10;
        }

        if (employee.taxes.sdi > 0) {
          doc.text('SDI', 350, currentY, { width: 90 });
          doc.text(parseFloat(employee.taxes.sdi).toFixed(2), 450, currentY, { width: 50, align: 'right' });
          doc.text('0.00', 500, currentY, { width: 40, align: 'right' });
          currentY += 10;
        }

        if (employee.taxes.calSavers > 0) {
          doc.text('CalSavers', 350, currentY, { width: 90 });
          doc.text(parseFloat(employee.taxes.calSavers).toFixed(2), 450, currentY, { width: 50, align: 'right' });
          doc.text('0.00', 500, currentY, { width: 40, align: 'right' });
          currentY += 10;
        }
      }

      // Other Deductions
      if (employee.deductions && deductionTypes) {
        Object.entries(employee.deductions).forEach(([deductionTypeId, value]) => {
          if (parseFloat(value) > 0) {
            const deductionType = deductionTypes.find(dt => dt.id === deductionTypeId);
            const label = deductionType ? deductionType.label : 'Other';
            
            doc.text(label, 350, currentY, { width: 90 });
            doc.text(parseFloat(value).toFixed(2), 450, currentY, { width: 50, align: 'right' });
            doc.text('0.00', 500, currentY, { width: 40, align: 'right' });
            currentY += 10;
          }
        });
      }

      // Total Deductions
      currentY += 5;
      const totalDeductions = parseFloat(employee.totalTaxes || 0) + parseFloat(employee.totalDeductions || 0);
      doc.font('Helvetica-Bold').text('Total Deductions', 350, currentY, { width: 90 });
      doc.text(totalDeductions.toFixed(2), 450, currentY, { width: 50, align: 'right' });
      doc.text('0.00', 500, currentY, { width: 40, align: 'right' });

      // ====== NET PAY ======
      currentY += 15;
      doc.moveTo(50, currentY).lineTo(545, currentY).stroke();
      currentY += 8;
      
      doc.fontSize(9).font('Helvetica-Bold').text('Net Pay', 350, currentY, { width: 90 });
      doc.text(parseFloat(employee.netPay).toFixed(2), 450, currentY, { width: 50, align: 'right' });
      doc.text('0.00', 500, currentY, { width: 40, align: 'right' });

      // Bottom border
      currentY += 15;
      doc.moveTo(50, currentY).lineTo(545, currentY).stroke();

      // ====== FOOTER ======
      currentY += 25;
      doc.fontSize(7).font('Helvetica').fillColor('#666');
      doc.text('Printed with BizBuddy payroll software', 50, currentY, { align: 'left', width: 495 });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

// ================== HELPER FUNCTIONS ==================

function formatCurrency(num) {
  return num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function numberToWords(num) {
  const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const teens = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const thousands = ['', 'thousand', 'million'];

  if (num === 0) return 'zero';

  let intPart = Math.floor(num);
  let words = '';

  let i = 0;
  while (intPart > 0) {
    const chunk = intPart % 1000;
    if (chunk !== 0) {
      const chunkWords = convertChunk(chunk, ones, teens, tens);
      words = chunkWords + (thousands[i] ? ' ' + thousands[i] : '') + (words ? ' ' + words : '');
    }
    intPart = Math.floor(intPart / 1000);
    i++;
  }

  return words.trim();
}

function convertChunk(num, ones, teens, tens) {
  let str = '';
  
  const hundred = Math.floor(num / 100);
  const remainder = num % 100;
  
  if (hundred > 0) {
    str += ones[hundred] + ' hundred';
  }
  
  if (remainder >= 10 && remainder < 20) {
    str += (str ? ' ' : '') + teens[remainder - 10];
  } else {
    const ten = Math.floor(remainder / 10);
    const one = remainder % 10;
    
    if (ten > 0) {
      str += (str ? ' ' : '') + tens[ten];
    }
    if (one > 0) {
      str += (str ? ' ' : '') + ones[one];
    }
  }
  
  return str;
}

module.exports = generateCheckPDF;