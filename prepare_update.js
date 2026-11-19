const fs = require('fs');
const content = fs.readFileSync('index.html', 'utf8');

// 1. Locate Dashboard section
const dashStart = content.indexOf('id="view-dashboard-overview"');
const dashEnd = content.indexOf('<!-- ==========================================\n           VIEW: VODAFONE CASH MONITOR', dashStart);
console.log('Dashboard start:', dashStart, 'Dashboard end:', dashEnd);

// 2. Locate openSmartCodeActionModal
const modalFnStart = content.indexOf('window.openSmartCodeActionModal = function');
console.log('openSmartCodeActionModal start:', modalFnStart);

// 3. Locate renderDashboard
const renderDashStart = content.indexOf('function renderDashboard()');
console.log('renderDashboard start:', renderDashStart);

// 4. Locate setupSmartCodeEvents
const smartEventsStart = content.indexOf('function setupSmartCodeEvents()');
console.log('setupSmartCodeEvents start:', smartEventsStart);
