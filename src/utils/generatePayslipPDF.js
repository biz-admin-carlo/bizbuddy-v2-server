const PDFDocument = require('pdfkit');

function generatePayslipPDF(payrollRun, employee, company, earningTypes, deductionTypes) {
    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 50 });
        const chunks = [];
  
        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
  
        // Header
        doc.fontSize(20).font('Helvetica-Bold').text('PAYSLIP', { align: 'center' });
        doc.moveDown();
  
        // Company Info
        doc.fontSize(10).font('Helvetica').text(company.name || 'Company Name', { align: 'left' });
        if (company.addressLine1) {
          doc.fontSize(8).text(company.addressLine1, { align: 'left' });
        }
        doc.moveDown();
  
        // Employee & Period Info
        doc.fontSize(12).font('Helvetica-Bold').text(employee.employeeName);
        doc.fontSize(9).font('Helvetica').text(employee.position || 'Employee');
        doc.moveDown();
  
        doc.fontSize(9);
        doc.text(`Pay Period: ${new Date(payrollRun.periodStart).toLocaleDateString()} - ${new Date(payrollRun.periodEnd).toLocaleDateString()}`);
        doc.text(`Pay Date: ${new Date(payrollRun.payDate).toLocaleDateString()}`);
        doc.text(`Check Number: ${employee.checkNumber}`);
        doc.moveDown();
  
        // Line separator
        doc.strokeColor('#000').lineWidth(1).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();
  
        // ✅ FIX: Earnings Section with Labels
        doc.fontSize(11).font('Helvetica-Bold').text('EARNINGS', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(9).font('Helvetica');
  
        if (employee.earnings && earningTypes) {
          Object.entries(employee.earnings).forEach(([earningTypeId, value]) => {
            if (value > 0) {
              // Find the label from earningTypes
              const earningType = earningTypes.find(et => et.id === earningTypeId);
              const label = earningType ? earningType.label : 'Other Earning';
              
              doc.text(label, 50, doc.y, { continued: true, width: 400 });
              doc.text(`$${parseFloat(value).toFixed(2)}`, { align: 'right' });
            }
          });
        }
  
        doc.moveDown();
        doc.font('Helvetica-Bold').text('Gross Pay', 50, doc.y, { continued: true, width: 400 });
        doc.text(`$${parseFloat(employee.grossPay).toFixed(2)}`, { align: 'right' });
        doc.moveDown();
  
        // Taxes Section
        doc.fontSize(11).font('Helvetica-Bold').text('TAXES', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(9).font('Helvetica');
  
        if (employee.taxes) {
          if (employee.taxes.federalTax > 0) {
            doc.text('Federal Income Tax', 50, doc.y, { continued: true, width: 400 });
            doc.text(`$${parseFloat(employee.taxes.federalTax).toFixed(2)}`, { align: 'right' });
          }
  
          if (employee.taxes.stateTax > 0) {
            doc.text('State Income Tax (CA)', 50, doc.y, { continued: true, width: 400 });
            doc.text(`$${parseFloat(employee.taxes.stateTax).toFixed(2)}`, { align: 'right' });
          }
  
          if (employee.taxes.fica > 0) {
            doc.text('Social Security (FICA)', 50, doc.y, { continued: true, width: 400 });
            doc.text(`$${parseFloat(employee.taxes.fica).toFixed(2)}`, { align: 'right' });
          }
  
          if (employee.taxes.medicare > 0) {
            doc.text('Medicare', 50, doc.y, { continued: true, width: 400 });
            doc.text(`$${parseFloat(employee.taxes.medicare).toFixed(2)}`, { align: 'right' });
          }
  
          if (employee.taxes.sdi > 0) {
            doc.text('CA SDI', 50, doc.y, { continued: true, width: 400 });
            doc.text(`$${parseFloat(employee.taxes.sdi).toFixed(2)}`, { align: 'right' });
          }
  
          if (employee.taxes.calSavers > 0) {
            doc.text('CalSavers', 50, doc.y, { continued: true, width: 400 });
            doc.text(`$${parseFloat(employee.taxes.calSavers).toFixed(2)}`, { align: 'right' });
          }
        }
  
        doc.moveDown();
        doc.font('Helvetica-Bold').text('Total Taxes', 50, doc.y, { continued: true, width: 400 });
        doc.text(`$${parseFloat(employee.totalTaxes || 0).toFixed(2)}`, { align: 'right' });
        doc.moveDown();
  
        // ✅ FIX: Deductions Section with Labels
        if (employee.deductions && employee.totalDeductions > 0) {
          doc.fontSize(11).font('Helvetica-Bold').text('DEDUCTIONS', { underline: true });
          doc.moveDown(0.5);
          doc.fontSize(9).font('Helvetica');
  
          Object.entries(employee.deductions).forEach(([deductionTypeId, value]) => {
            if (value > 0) {
              const deductionType = deductionTypes.find(dt => dt.id === deductionTypeId);
              const label = deductionType ? deductionType.label : 'Other Deduction';
              
              doc.text(label, 50, doc.y, { continued: true, width: 400 });
              doc.text(`$${parseFloat(value).toFixed(2)}`, { align: 'right' });
            }
          });
  
          doc.moveDown();
          doc.font('Helvetica-Bold').text('Total Deductions', 50, doc.y, { continued: true, width: 400 });
          doc.text(`$${parseFloat(employee.totalDeductions).toFixed(2)}`, { align: 'right' });
          doc.moveDown();
        }
  
        // Net Pay
        doc.strokeColor('#000').lineWidth(2).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.5);
        doc.fontSize(14).font('Helvetica-Bold');
        doc.fillColor('#FF6600').text('NET PAY', 50, doc.y, { continued: true, width: 400 });
        doc.text(`$${parseFloat(employee.netPay).toFixed(2)}`, { align: 'right' });
        doc.fillColor('#000');
        doc.moveDown();
        doc.strokeColor('#000').lineWidth(2).moveTo(50, doc.y).lineTo(550, doc.y).stroke();
  
        // Footer
        doc.moveDown(2);
        doc.fontSize(8).font('Helvetica').fillColor('#666');
        doc.text('This is a computer-generated payslip. No signature required.', { align: 'center' });
  
        doc.end();
      } catch (error) {
        reject(error);
      }
    });
}
  

module.exports = generatePayslipPDF;