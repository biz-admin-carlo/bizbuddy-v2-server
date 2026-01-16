require('dotenv').config();
const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');

/**
 * Render a template with test data and save as HTML
 */
async function renderTemplate(templateName, testData) {
  try {
    const templatePath = path.join(__dirname, '../templates', `${templateName}.hbs`);
    const templateSource = await fs.readFile(templatePath, 'utf-8');
    const template = handlebars.compile(templateSource);
    const html = template(testData);
    
    const outputPath = path.join(__dirname, '../templates/previews', `${templateName}.html`);
    await fs.writeFile(outputPath, html);
    
    console.log(`✅ ${templateName}.html`);
    return outputPath;
  } catch (error) {
    console.error(`❌ Error rendering ${templateName}:`, error.message);
  }
}

/**
 * Generate all email previews
 */
async function generateAllPreviews() {
  console.log('\n🎨 Generating Email Previews...\n');
  
  // Create previews directory
  const previewsDir = path.join(__dirname, '../templates/previews');
  await fs.mkdir(previewsDir, { recursive: true });
  
  const currentYear = new Date().getFullYear();
  const appUrl = 'http://localhost:3000';
  
  // 1. Missed Clock-In
  await renderTemplate('missedClockIn', {
    employeeName: 'John Doe',
    shiftName: 'Morning Shift',
    scheduledStart: '9:00 AM',
    currentTime: '9:45 AM',
    department: 'Sales Department',
    appUrl,
    currentYear,
  });
  
  // 2. Missed Clock-Out
  await renderTemplate('missedClockOut', {
    employeeName: 'Jane Smith',
    clockInTime: '9:00 AM',
    expectedClockOut: '5:00 PM',
    hoursWorked: '10.5',
    appUrl,
    currentYear,
  });
  
  // 3. Morning Report
  await renderTemplate('morningReport', {
    managerName: 'Sarah Johnson',
    companyName: 'BizBuddy LLC',
    reportDate: 'Monday, January 15, 2025',
    missedClockIns: [
      {
        employeeName: 'John Doe',
        department: 'Sales',
        scheduledTime: '9:00 AM',
        minutesLate: 45,
        supervisor: 'Mike Smith'
      },
      {
        employeeName: 'Jane Wilson',
        department: 'Marketing',
        scheduledTime: '8:00 AM',
        minutesLate: 30,
        supervisor: 'Lisa Brown'
      },
      {
        employeeName: 'Bob Anderson',
        department: 'IT',
        scheduledTime: '8:30 AM',
        minutesLate: 60,
        supervisor: 'Tom Davis'
      }
    ],
    currentlyClockedIn: [
      {
        employeeName: 'Alice Cooper',
        department: 'HR',
        clockInTime: '7:30 AM',
        hoursWorked: '2.5'
      },
      {
        employeeName: 'Charlie Brown',
        department: 'Finance',
        clockInTime: '8:00 AM',
        hoursWorked: '2.0'
      },
      {
        employeeName: 'Diana Prince',
        department: 'Operations',
        clockInTime: '8:15 AM',
        hoursWorked: '1.75'
      }
    ],
    appUrl,
    currentYear,
  });
  
  // 4. Evening Report
  await renderTemplate('eveningReport', {
    managerName: 'Sarah Johnson',
    companyName: 'BizBuddy LLC',
    reportDate: 'Monday, January 15, 2025',
    missedClockOuts: [
      {
        employeeName: 'John Doe',
        department: 'Sales',
        clockInTime: '9:00 AM',
        expectedClockOut: '5:00 PM',
        minutesOverdue: 120,
        hoursWorked: '10.0'
      },
      {
        employeeName: 'Bob Wilson',
        department: 'IT',
        clockInTime: '8:00 AM',
        expectedClockOut: '4:00 PM',
        minutesOverdue: 180,
        hoursWorked: '11.0'
      }
    ],
    stillClockedIn: [
      {
        employeeName: 'Alice Cooper',
        department: 'HR',
        clockInTime: '7:30 AM',
        hoursWorked: '9.5',
        expectedClockOut: '5:30 PM'
      },
      {
        employeeName: 'Charlie Brown',
        department: 'Finance',
        clockInTime: '8:00 AM',
        hoursWorked: '9.0',
        expectedClockOut: '6:00 PM'
      }
    ],
    appUrl,
    currentYear,
  });
  
  console.log('\n✅ All previews generated!');
  console.log(`📂 Location: ${previewsDir}\n`);
  
  // Create index page
  await createIndexPage(previewsDir);
  
  // Open in browser
  const indexPath = path.join(previewsDir, 'index.html');
  console.log('🌐 Opening previews in browser...\n');
  
  // Open based on OS
  const command = process.platform === 'darwin' ? 'open' : 
                  process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${command} ${indexPath}`);
}

/**
 * Create index page to view all templates
 */
async function createIndexPage(previewsDir) {
  const indexHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>BizBuddy Email Templates Preview</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f5f5f5;
      padding: 40px 20px;
    }
    .container {
      max-width: 1200px;
      margin: 0 auto;
    }
    h1 {
      color: #333;
      margin-bottom: 10px;
      font-size: 32px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 40px;
      font-size: 16px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 40px;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      transition: transform 0.2s, box-shadow 0.2s;
    }
    .card:hover {
      transform: translateY(-4px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
    }
    .card h2 {
      color: #333;
      margin-bottom: 8px;
      font-size: 20px;
    }
    .card p {
      color: #666;
      margin-bottom: 16px;
      line-height: 1.5;
    }
    .card a {
      display: inline-block;
      padding: 10px 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      transition: opacity 0.2s;
    }
    .card a:hover {
      opacity: 0.9;
    }
    .footer {
      text-align: center;
      color: #999;
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>📧 BizBuddy Email Templates</h1>
    <p class="subtitle">Preview all notification email templates</p>
    
    <div class="grid">
      <div class="card">
        <h2>⏰ Missed Clock-In</h2>
        <p>Sent to employees who didn't clock in 30 minutes after their scheduled shift start time.</p>
        <a href="missedClockIn.html" target="_blank">View Template</a>
      </div>
      
      <div class="card">
        <h2>🕐 Missed Clock-Out</h2>
        <p>Sent to employees who didn't clock out 30 minutes after their scheduled shift end time.</p>
        <a href="missedClockOut.html" target="_blank">View Template</a>
      </div>
      
      <div class="card">
        <h2>☀️ Morning Report</h2>
        <p>Daily summary sent to management at 10:00 AM showing missed clock-ins and currently active employees.</p>
        <a href="morningReport.html" target="_blank">View Template</a>
      </div>
      
      <div class="card">
        <h2>🌙 Evening Report</h2>
        <p>Daily summary sent to management at 6:00 PM showing missed clock-outs and still-active employees.</p>
        <a href="eveningReport.html" target="_blank">View Template</a>
      </div>
    </div>
    
    <div class="footer">
      <p>Generated: ${new Date().toLocaleString()}</p>
      <p>© ${new Date().getFullYear()} BizBuddy LLC. All rights reserved.</p>
    </div>
  </div>
</body>
</html>
  `;
  
  await fs.writeFile(path.join(previewsDir, 'index.html'), indexHtml);
}

// Run if executed directly
if (require.main === module) {
  generateAllPreviews().catch(console.error);
}

module.exports = { generateAllPreviews, renderTemplate };