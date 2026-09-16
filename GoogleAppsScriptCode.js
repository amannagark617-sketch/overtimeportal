/**
 * GOOGLE APPS SCRIPT CODE FOR OVERTIME LOGS & WORKSPACE INTEGRATION
 * 
 * ⚡ OPTIMIZED ARCHITECTURE (0 APPS SCRIPT QUOTA CONSUMPTION FOR BACKGROUND READS):
 * 1. Data Populating & 10-Second Auto-Refresh:
 *    The application reads data via Google Sheets "Publish to Web" CSV Export.
 *    This uses 0 Apps Script execution quota, preventing any daily execution quota limits from being exhausted!
 * 
 * 2. Form Data Entry, Updates, & Google Drive Uploads:
 *    This Apps Script Web App is strictly used for POST actions (form entries, row updates, row deletions, and PDF/file uploads).
 * 
 * INSTRUCTIONS:
 * 1. Ensure both Google Sheets (Active & Archive) are published to the web (File > Share > Publish to web).
 * 2. In your Google Sheet, click Extensions > Apps Script.
 * 3. Delete any existing code and paste this entire code block.
 * 4. Save the project (disk icon).
 * 
 * 5. MANDATORY STEP FOR GOOGLE DRIVE PERMISSIONS:
 *    a. Click the Gear icon ⚙️ (Project Settings) on the left sidebar.
 *    b. Check the box "Show 'appsscript.json' manifest file in editor".
 *    c. Click back to the Editor icon 📄 (left sidebar) and open "appsscript.json".
 *    d. Replace its entire content with:
 * 
 * {
 *   "timeZone": "GMT",
 *   "dependencies": {},
 *   "exceptionLogging": "STACKDRIVER",
 *   "runtimeVersion": "V8",
 *   "oauthScopes": [
 *     "https://www.googleapis.com/auth/spreadsheets",
 *     "https://www.googleapis.com/auth/drive"
 *   ]
 * }
 * 
 *    e. Click Save (disk icon).
 * 
 * 6. Click "Deploy" > "New deployment" > Select type "Web app".
 * 7. Execute as: "Me", Who has access: "Anyone".
 * 8. Click Deploy, authorize permissions (Advanced > Go to Untitled project > Allow), and copy the Web App URL.
 * 9. Enter this URL into the application configuration panel.
 *
 * OPTIONAL - DAILY-WAGE WORKERS:
 * To track variable-headcount factory/contract workers paid a flat rate per day present
 * (instead of a fixed monthly salary), add two columns to the end of your "Master Data" sheet:
 *   Column N (14): "Wage Type"  -> set to "Daily" for these workers (leave blank/"Monthly" for
 *                                   fixed-salary staff)
 *   Column O (15): "Daily Rate" -> the rupee amount paid for each day the worker is present
 * These employees are matched to biometric punch data by Employee Code == the device's Emp ID.
 */

var SPREADSHEET_ID = "122tkJJM7x5CQWsyaMdVYNQesvpIuqYlAzi5w4lxZ3Sw";
var DRIVE_FOLDER_ID = "18zF4DXTLRVzW32ozfO0xZtcn7c3JenWN"; // Your Google Drive folder ID for uploads

function getSpreadsheet() {
  if (SPREADSHEET_ID && SPREADSHEET_ID.trim() !== "") {
    try {
      return SpreadsheetApp.openById(SPREADSHEET_ID);
    } catch (e) {
      Logger.log("Error opening spreadsheet by ID: " + e.toString());
    }
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * Flexible header index locator for Google Sheets columns
 * Keys outer loop ensures priority ordering (e.g. Total Salary before Basic)
 */
function getHeaderIdx(headerList, possibleKeys) {
  if (!headerList || !Array.isArray(headerList)) return -1;
  for (var k = 0; k < possibleKeys.length; k++) {
    var key = possibleKeys[k].toLowerCase();
    for (var col = 0; col < headerList.length; col++) {
      var h = String(headerList[col]).trim().toLowerCase();
      if (h === key || h === key.replace(/\s+/g, '') || (key.length > 3 && h.indexOf(key) !== -1)) {
        return col;
      }
    }
  }
  return -1;
}

/**
 * Robust date formatting helper function (e.g. "30-Jul-2026")
 */
function formatDateDDMMMYYYY(dateInput) {
  if (!dateInput) return '';
  var dateObj;
  if (dateInput instanceof Date) {
    dateObj = dateInput;
  } else {
    var str = String(dateInput).trim();
    if (str.startsWith("'")) str = str.slice(1);
    
    // YYYY-MM-DD or YYYY/MM/DD
    var matchYmd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (matchYmd) {
      dateObj = new Date(Number(matchYmd[1]), Number(matchYmd[2]) - 1, Number(matchYmd[3]));
    } else {
      // DD-MM-YYYY or DD/MM/YYYY
      var matchDmy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
      if (matchDmy) {
        dateObj = new Date(Number(matchDmy[3]), Number(matchDmy[2]) - 1, Number(matchDmy[1]));
      } else {
        // DD-MMM-YYYY
        var matchDmyName = str.match(/^(\d{1,2})[-/\s]+([A-Za-z]{3,9})[-/\s]+(\d{4})/);
        if (matchDmyName) {
          var mName = matchDmyName[2].toLowerCase().substring(0, 3);
          var monthsArr = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
          var mIdx = monthsArr.indexOf(mName);
          dateObj = new Date(Number(matchDmyName[3]), mIdx !== -1 ? mIdx : 0, Number(matchDmyName[1]));
        } else {
          dateObj = new Date(str);
        }
      }
    }
  }

  if (!dateObj || isNaN(dateObj.getTime())) return String(dateInput);

  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var day = String(dateObj.getDate()).padStart(2, '0');
  var month = months[dateObj.getMonth()];
  var year = dateObj.getFullYear();
  return day + '-' + month + '-' + year;
}

/**
 * 🟢 RUN THIS FUNCTION ONCE IN THE APPS SCRIPT EDITOR TO AUTHORIZE DRIVE & SHEET ACCESS 🟢
 * If you get a "permission denied", "DriveApp" or "SpreadsheetApp" auth error,
 * please select 'authorizeDriveAndSheets' in the toolbar dropdown at the top of
 * the Apps Script editor, and click the 'Run' button.
 * This forces Google to show the authorization prompt so you can grant full permissions!
 */
function authorizeDriveAndSheets() {
  var ss = getSpreadsheet();
  var folderIdToUse = DRIVE_FOLDER_ID;
  if (!folderIdToUse || folderIdToUse === "18zF4DXTLRVzW32ozfO0xZtcn7c3JenWN") {
    var folders = DriveApp.getFoldersByName("Overtime (OT) Approval Data");
    if (folders.hasNext()) {
      folderIdToUse = folders.next().getId();
    } else {
      folderIdToUse = DriveApp.createFolder("Overtime (OT) Approval Data").getId();
    }
  }
  var folder = DriveApp.getFolderById(folderIdToUse);
  var tempFile = folder.createFile("temp_auth_test.txt", "Authorization Check");
  tempFile.setTrashed(true);
  Logger.log("✅ WRITE PERMISSIONS AUTHORIZED SUCCESSFULLY! Spreadsheet: " + ss.getName() + " | Folder: " + folder.getName());
}

/**
 * Clean & working Base64 file upload logic from your provided script.
 * Saves the blob to the designated Google Drive Folder and makes it viewable by anyone with link.
 */
function uploadFileFromBase64(base64Data, filename, mimeType, folderId) {
  try {
    if (!base64Data) {
      return "Error: Missing file base64 data";
    }
    
    var folderIdToUse = folderId || DRIVE_FOLDER_ID;
    if (!folderIdToUse || folderIdToUse === "18zF4DXTLRVzW32ozfO0xZtcn7c3JenWN") {
      try {
        var folders = DriveApp.getFoldersByName("Overtime (OT) Approval Data");
        if (folders.hasNext()) {
          folderIdToUse = folders.next().getId();
        } else {
          folderIdToUse = DriveApp.createFolder("Overtime (OT) Approval Data").getId();
        }
      } catch (fErr) {
        folderIdToUse = DriveApp.getRootFolder().getId();
      }
    }
    
    var decoded = Utilities.base64Decode(base64Data);
    var folder = DriveApp.getFolderById(folderIdToUse);
    
    var finalFilename = filename || "approval.pdf";
    try {
      var existingFiles = folder.getFilesByName(finalFilename);
      if (existingFiles.hasNext()) {
        // There is already a file with this name in the folder.
        // Let's make the filename unique by appending a timestamp to avoid any conflicts
        // or Google Drive automatically placing duplicate-named files in the root folder.
        var dotIndex = finalFilename.lastIndexOf('.');
        var nameWithoutExt = dotIndex !== -1 ? finalFilename.substring(0, dotIndex) : finalFilename;
        var ext = dotIndex !== -1 ? finalFilename.substring(dotIndex) : "";
        
        var timeZone = "Asia/Kolkata";
        try {
          timeZone = Session.getScriptTimeZone() || "Asia/Kolkata";
        } catch (tzErr) {
          // ignore
        }
        var timestamp = Utilities.formatDate(new Date(), timeZone, "yyyyMMdd_HHmmss");
        finalFilename = nameWithoutExt + "_" + timestamp + ext;
      }
    } catch (nameErr) {
      Logger.log("Error checking duplicate files: " + nameErr.toString());
    }
    
    var blob = Utilities.newBlob(decoded, mimeType || "application/pdf", finalFilename);
    var newFile = folder.createFile(blob);
    
    // Wrap setSharing in try-catch because Google Workspace domain policies might restrict sharing externally.
    // We should still return the file URL even if sharing permissions cannot be modified.
    try {
      newFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (sharingErr) {
      Logger.log("Could not set public sharing permissions (this is common under domain policies): " + sharingErr.toString());
    }
    
    return newFile.getUrl();
  } catch (e) {
    Logger.log("Upload Error: " + e.toString());
    return "Error: " + e.toString(); 
  }
}

function findHeaderIndex(headerIndices, key) {
  var k = key.toLowerCase().trim();
  if (headerIndices[k] !== undefined) return headerIndices[k];
  
  // Try common aliases/variations
  var aliases = {
    'ot hours': ['ot hours', 'overtime hours', 'overtime', 'ot_hours', 'overtime_hours'],
    'fooding': ['fooding', 'fooding applicable', 'fooding_applicable', 'fooding applicable?', 'fooding?', 'fooding allowance'],
    'employee code': ['employee code', 'emp code', 'employee_code', 'emp_code'],
    'employee name': ['employee name', 'emp name', 'employee_name', 'emp_name', 'name'],
    'designation': ['designation', 'desg', 'role'],
    'department': ['department', 'dept'],
    'payroll': ['payroll'],
    'date': ['date'],
    'entered by': ['entered by', 'entered_by', 'user', 'username'],
    'remarks': ['remarks', 'remark', 'ofp number', 'ofp_number'],
    'reason for overtime': ['reason for overtime', 'reason for ot', 'reason_for_overtime', 'reason_for_ot', 'reason'],
    'approval for ot': ['approval for ot', 'approval_for_ot', 'approval', 'approval file', 'file url', 'file link']
  };
  
  if (aliases[k]) {
    var list = aliases[k];
    for (var i = 0; i < list.length; i++) {
      if (headerIndices[list[i]] !== undefined) {
        return headerIndices[list[i]];
      }
    }
  }
  return undefined;
}

function formatTimestampVal(val) {
  if (val instanceof Date) {
    try {
      return Utilities.formatDate(val, "Asia/Kolkata", "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
    } catch (err) {
      return val.toISOString ? val.toISOString() : String(val);
    }
  }
  return String(val || '');
}

function parseTimestampToDate(ts) {
  if (!ts) {
    return new Date();
  }
  
  if (ts instanceof Date) {
    return ts;
  }
  
  var str = String(ts).trim();
  if (str.startsWith("'")) {
    str = str.slice(1);
  }
  
  // 1. Try DD/MM/YYYY, HH:mm:ss format (e.g. from getIndianTimestamp)
  var dmyMatch = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (dmyMatch) {
    var day = parseInt(dmyMatch[1], 10);
    var month = parseInt(dmyMatch[2], 10) - 1;
    var year = parseInt(dmyMatch[3], 10);
    var hour = parseInt(dmyMatch[4], 10);
    var minute = parseInt(dmyMatch[5], 10);
    var second = parseInt(dmyMatch[6] || 0, 10);
    return new Date(year, month, day, hour, minute, second);
  }
  
  // 2. Try YYYY-MM-DDTHH:mm:ss (ISO format)
  var isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (isoMatch) {
    var year = parseInt(isoMatch[1], 10);
    var month = parseInt(isoMatch[2], 10) - 1;
    var day = parseInt(isoMatch[3], 10);
    var hour = parseInt(isoMatch[4], 10);
    var minute = parseInt(isoMatch[5], 10);
    var second = parseInt(isoMatch[6], 10);
    return new Date(year, month, day, hour, minute, second);
  }
  
  // 3. Fallback
  var d = new Date(str);
  if (!isNaN(d.getTime())) {
    return d;
  }
  
  return new Date();
}

function doGet(e) {
  var action = e.parameter.action;
  var ss = getSpreadsheet();
  
  if (action === 'read') {
    // 1. Fetch Employees
    var empSheet = ss.getSheetByName('Master Data');
    var employees = [];
    if (empSheet) {
      var empRows = empSheet.getDataRange().getValues();
      var empHeaders = empRows[0];
      for (var i = 1; i < empRows.length; i++) {
        var row = empRows[i];
        if (row[0]) { // Check if employeeCode exists
          employees.push({
            employeeCode: String(row[0]),
            employeeName: String(row[1] || ''),
            designation: String(row[2] || ''),
            department: String(row[3] || ''),
            payroll: String(row[4] || ''),
            basic: Number(row[5] || 0),
            hra: Number(row[6] || 0),
            splAllowance: Number(row[7] || 0),
            conveyance: Number(row[8] || 0),
            lta: Number(row[9] || 0),
            otherAllowance: Number(row[10] || 0),
            bonus: Number(row[11] || 0),
            totalSalary: Number(row[12] || 0),
            // Optional columns (14: Wage Type, 15: Daily Rate) for variable-headcount daily-wage
            // workers (e.g. factory contract staff paid per day present). Defaults to Monthly/0
            // when the columns don't exist, so this is backward-compatible with older sheets.
            wageType: String(row[13] || 'Monthly').trim() === 'Daily' ? 'Daily' : 'Monthly',
            dailyRate: Number(row[14] || 0)
          });
        }
      }
    }
    
    // 2. Fetch Records
    var recSheet = ss.getSheetByName('Response');
    var records = [];
    if (recSheet) {
      var recRows = recSheet.getDataRange().getValues();
      var recHeaders = recRows[0];
      
      // Dynamic Header Mapping
      var headerIndices = {};
      for (var h = 0; h < recHeaders.length; h++) {
        headerIndices[String(recHeaders[h]).trim().toLowerCase()] = h;
      }
      
      for (var i = 1; i < recRows.length; i++) {
        var row = recRows[i];
        if (row[0] || row[1]) {
          // Map properties based on dynamic index or standard fallback
          var getVal = function(key, idx) {
            var actualIdx = findHeaderIndex(headerIndices, key);
            return actualIdx !== undefined ? row[actualIdx] : row[idx];
          };
          
          records.push({
            rowIndex: i + 1,
            timestamp: formatTimestampVal(getVal('Timestamp', 0)),
            employeeCode: String(getVal('Employee Code', 1)),
            employeeName: String(getVal('Employee Name', 2)),
            designation: String(getVal('Designation', 3)),
            department: String(getVal('Department', 4)),
            payroll: String(getVal('Payroll', 5)),
            date: String(getVal('Date', 6)),
            overtimeHours: Number(getVal('OT Hours', 7) || 0),
            foodingApplicable: Number(getVal('Fooding', 8) || 0),
            enteredBy: String(getVal('Entered By', 9)),
            remarks: String(getVal('Remarks', 10) || getVal('OFP Number', 10) || ''),
            reasonForOvertime: String(getVal('Reason for Overtime', 11) || ''),
            approvalForOT: String(getVal('Approval for OT', 12) || ''),
            basic: getVal('Basic', 13) !== '' ? Number(getVal('Basic', 13)) : undefined,
            hra: getVal('HRA', 14) !== '' ? Number(getVal('HRA', 14)) : undefined,
            splAllowance: getVal('Spl Allowance', 15) !== '' ? Number(getVal('Spl Allowance', 15)) : undefined,
            conveyance: getVal('Conveyance', 16) !== '' ? Number(getVal('Conveyance', 16)) : undefined,
            lta: getVal('LTA', 17) !== '' ? Number(getVal('LTA', 17)) : undefined,
            otherAllowance: getVal('Other Allowance', 18) !== '' ? Number(getVal('Other Allowance', 18)) : undefined,
            bonus: getVal('Bonus', 19) !== '' ? Number(getVal('Bonus', 19)) : undefined,
            totalSalary: getVal('Total Salary', 20) !== '' ? Number(getVal('Total Salary', 20)) : undefined
          });
        }
      }
    }
    
    // 3. Fetch Users
    var userSheet = ss.getSheetByName('ID Pass');
    var users = [];
    if (userSheet) {
      var userRows = userSheet.getDataRange().getValues();
      for (var i = 1; i < userRows.length; i++) {
        var row = userRows[i];
        if (row[0]) {
          users.push({
            id: String(row[0]),
            passwordHash: String(row[1] || ''),
            type: String(row[2] || 'User')
          });
        }
      }
    }
    
    // 4. Fetch Reason of OT Column A
    var reasonSheet = ss.getSheetByName('Reason of OT');
    var reasons = [];
    if (reasonSheet) {
      var reasonRows = reasonSheet.getDataRange().getValues();
      for (var i = 1; i < reasonRows.length; i++) {
        var row = reasonRows[i];
        if (row[0] && String(row[0]).trim() !== '') {
          reasons.push(String(row[0]).trim());
        }
      }
    }
    
    // Default fallback if Reason sheet doesn't exist
    if (reasons.length === 0) {
      reasons = [
        "Machine Breakdown",
        "Urgent Shipment Demand",
        "Quarterly Close Support",
        "Stock Verification",
        "Client Urgent Support",
        "Maintenance & Cleanup",
        "System Upgrade",
        "Pending Audit Support"
      ];
    }
    
    var output = {
      employees: employees,
      records: records,
      users: users,
      reasons: reasons
    };
    
    return ContentService.createTextOutput(JSON.stringify(output))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  return ContentService.createTextOutput(JSON.stringify({ error: "Invalid action" }))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var ss = getSpreadsheet();
    if (!ss) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Could not open spreadsheet. Please check SPREADSHEET_ID configuration." }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var postData;
    try {
      postData = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return ContentService.createTextOutput(JSON.stringify({ error: "Failed to parse JSON body: " + parseErr.toString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var action = postData.action;
    
    // 1. Google Drive File Upload handler
    if (action === 'uploadFile') {
      var base64Data = postData.file;
      var filename = postData.filename || 'approval_document.pdf';
      var mimeType = postData.mimeType || 'application/pdf';
      
      var fileUrl = uploadFileFromBase64(base64Data, filename, mimeType, DRIVE_FOLDER_ID);
      
      if (!fileUrl || fileUrl.startsWith("Error")) {
        throw new Error(fileUrl || "Unknown upload error");
      }
      
      return ContentService.createTextOutput(JSON.stringify({
        success: true,
        url: fileUrl
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    // 2. Append records
    if (action === 'append') {
      var sheet = ss.getSheetByName('Response');
      if (!sheet) {
        return ContentService.createTextOutput(JSON.stringify({ error: "Records sheet ('Response') not found in the spreadsheet." }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      var records = postData.records;
      if (!Array.isArray(records)) {
        records = [records];
      }
      
      // Ensure table headers are present and mapped
      var headers = [];
      try {
        headers = sheet.getDataRange().getValues()[0];
      } catch (rangeErr) {
        headers = [];
      }
      
      // Ensure we have at least standard headers if headers was completely empty
      if (!headers || headers.length === 0 || (headers.length === 1 && headers[0] === '')) {
        headers = ['Timestamp', 'Employee Code', 'Employee Name', 'Designation', 'Department', 'Payroll', 'Date', 'OT Hours', 'Fooding', 'Entered By', 'Remarks'];
        sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      }
      
      var headerIndices = {};
      for (var h = 0; h < headers.length; h++) {
        headerIndices[String(headers[h]).trim().toLowerCase()] = h;
      }
      
      // Check if new headers need to be appended to Spreadsheet
      var requiredHeaders = [
        { key: 'reason for overtime', label: 'Reason for Overtime' },
        { key: 'approval for ot', label: 'Approval for OT' },
        { key: 'basic', label: 'Basic' },
        { key: 'hra', label: 'HRA' },
        { key: 'spl allowance', label: 'Spl Allowance' },
        { key: 'conveyance', label: 'Conveyance' },
        { key: 'lta', label: 'LTA' },
        { key: 'other allowance', label: 'Other Allowance' },
        { key: 'bonus', label: 'Bonus' },
        { key: 'total salary', label: 'Total Salary' }
      ];
      var headersAppended = false;
      for (var rIdx = 0; rIdx < requiredHeaders.length; rIdx++) {
        var req = requiredHeaders[rIdx];
        if (headerIndices[req.key] === undefined) {
          var lastCol = headers.length + 1;
          sheet.getRange(1, lastCol).setValue(req.label);
          headers.push(req.label);
          headerIndices[req.key] = lastCol - 1;
          headersAppended = true;
        }
      }
      
      for (var r = 0; r < records.length; r++) {
        var item = records[r];
        if (!item) continue;
        var newRow = new Array(headers.length);
        for (var col = 0; col < headers.length; col++) {
          newRow[col] = '';
        }
        
        // Mapping values to respective columns
        var mapVal = function(key, val) {
          var idx = findHeaderIndex(headerIndices, key);
          if (idx !== undefined) {
            newRow[idx] = val;
          }
        };
        
        mapVal('Timestamp', parseTimestampToDate(item.timestamp));
        mapVal('Employee Code', item.employeeCode || '');
        mapVal('Employee Name', item.employeeName || '');
        mapVal('Designation', item.designation || '');
        mapVal('Department', item.department || '');
        mapVal('Payroll', item.payroll || '');
        mapVal('Date', item.date || '');
        mapVal('OT Hours', Number(item.overtimeHours || 0));
        mapVal('Fooding', Number(item.foodingApplicable || 0));
        mapVal('Entered By', item.enteredBy || '');
        mapVal('Remarks', item.remarks || '');
        mapVal('Reason for Overtime', item.reasonForOvertime || '');
        mapVal('Approval for OT', item.approvalForOT || '');
        if (item.basic !== undefined) mapVal('Basic', Number(item.basic || 0));
        if (item.hra !== undefined) mapVal('HRA', Number(item.hra || 0));
        if (item.splAllowance !== undefined) mapVal('Spl Allowance', Number(item.splAllowance || 0));
        if (item.conveyance !== undefined) mapVal('Conveyance', Number(item.conveyance || 0));
        if (item.lta !== undefined) mapVal('LTA', Number(item.lta || 0));
        if (item.otherAllowance !== undefined) mapVal('Other Allowance', Number(item.otherAllowance || 0));
        if (item.bonus !== undefined) mapVal('Bonus', Number(item.bonus || 0));
        if (item.totalSalary !== undefined) mapVal('Total Salary', Number(item.totalSalary || 0));
        
        sheet.appendRow(newRow);
      }
      
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 3. Update record
    if (action === 'update') {
      var sheet = ss.getSheetByName('Response');
      var rowIndex = Number(postData.rowIndex);
      var updated = postData.record;
      
      if (!sheet || isNaN(rowIndex) || rowIndex <= 1) {
        return ContentService.createTextOutput(JSON.stringify({ error: "Invalid parameters" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      var headers = sheet.getDataRange().getValues()[0];
      var headerIndices = {};
      for (var h = 0; h < headers.length; h++) {
        headerIndices[String(headers[h]).trim().toLowerCase()] = h;
      }
      
      var updateVal = function(key, val) {
        var idx = findHeaderIndex(headerIndices, key);
        if (idx !== undefined) {
          sheet.getRange(rowIndex, idx + 1).setValue(val);
        }
      };
      
      if (updated.date) updateVal('Date', updated.date);
      if (updated.overtimeHours !== undefined) updateVal('OT Hours', Number(updated.overtimeHours));
      if (updated.foodingApplicable !== undefined) updateVal('Fooding', Number(updated.foodingApplicable));
      if (updated.remarks !== undefined) updateVal('Remarks', updated.remarks);
      if (updated.reasonForOvertime !== undefined) updateVal('Reason for Overtime', updated.reasonForOvertime);
      if (updated.approvalForOT !== undefined) updateVal('Approval for OT', updated.approvalForOT);
      if (updated.basic !== undefined) updateVal('Basic', Number(updated.basic));
      if (updated.hra !== undefined) updateVal('HRA', Number(updated.hra));
      if (updated.splAllowance !== undefined) updateVal('Spl Allowance', Number(updated.splAllowance));
      if (updated.conveyance !== undefined) updateVal('Conveyance', Number(updated.conveyance));
      if (updated.lta !== undefined) updateVal('LTA', Number(updated.lta));
      if (updated.otherAllowance !== undefined) updateVal('Other Allowance', Number(updated.otherAllowance));
      if (updated.bonus !== undefined) updateVal('Bonus', Number(updated.bonus));
      if (updated.totalSalary !== undefined) updateVal('Total Salary', Number(updated.totalSalary));
      
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    // 4. Delete record
    if (action === 'delete') {
      var sheet = ss.getSheetByName('Response');
      var rowIndex = Number(postData.rowIndex);
      
      if (!sheet || isNaN(rowIndex) || rowIndex <= 1) {
        return ContentService.createTextOutput(JSON.stringify({ error: "Invalid parameters" }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      
      sheet.deleteRow(rowIndex);
      return ContentService.createTextOutput(JSON.stringify({ success: true }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // 5. CEO & CFO Daily Executive Report Sync
    if (action === 'syncReport') {
      var repSheet = ss.getSheetByName('CEO_CFO_Daily_Reports');
      if (!repSheet) {
        repSheet = ss.insertSheet('CEO_CFO_Daily_Reports');
        repSheet.appendRow([
          'Company',
          'Report Date', 
          'Target Date', 
          'Yesterday OT Hours', 
          'Yesterday Fooding (Rs)', 
          'Yesterday OT Amount (Rs)', 
          'Yesterday Grand Total (Rs)', 
          'Yesterday Top Worker', 
          'MTD Range', 
          'MTD OT Hours', 
          'MTD Fooding (Rs)', 
          'MTD OT Amount (Rs)', 
          'MTD Grand Total (Rs)', 
          'MTD Top Worker', 
          'Generated At',
          'PDF Report Drive Link'
        ]);
        try {
          repSheet.getRange(1, 1, 1, 16).setFontWeight('bold').setBackground('#0f172a').setFontColor('#ffffff');
        } catch (fErr) {}
      }

      // Generate PDF in Google Drive if possible
      var pdfUrl = "";
      try {
        pdfUrl = createPdfReportInDrive({
          dateFormatted: postData.targetDateFormatted || postData.date,
          mtdRange: postData.monthStartFormatted ? (postData.monthStartFormatted + ' to ' + postData.targetDateFormatted) : 'MTD',
          yHours: postData.totalHoursYesterday || 0,
          yFooding: postData.foodingAmountYesterday || 0,
          yOtAmount: postData.otAmountYesterday || 0,
          yGrandTotal: postData.grandTotalYesterday || 0,
          yTopWorker: postData.topWorkerYesterdayName || 'N/A',
          mtdHours: postData.totalHoursMTD || 0,
          mtdFooding: postData.foodingAmountMTD || 0,
          mtdOtAmount: postData.otAmountMTD || 0,
          mtdGrandTotal: postData.grandTotalMTD || 0,
          mtdTopWorker: postData.topWorkerMTDName || 'N/A',
          generatedAt: postData.generatedAt || new Date().toISOString()
        });
      } catch (pdfErr) {
        Logger.log("PDF generation warning: " + pdfErr.toString());
      }

      repSheet.appendRow([
        'Little Nap Recliners',
        postData.date || '',
        postData.targetDateFormatted || '',
        Number(postData.totalHoursYesterday || 0),
        Number(postData.foodingAmountYesterday || 0),
        Number(postData.otAmountYesterday || 0),
        Number(postData.grandTotalYesterday || 0),
        postData.topWorkerYesterdayName || '',
        postData.monthStartFormatted ? (postData.monthStartFormatted + ' to ' + postData.targetDateFormatted) : '',
        Number(postData.totalHoursMTD || 0),
        Number(postData.foodingAmountMTD || 0),
        Number(postData.otAmountMTD || 0),
        Number(postData.grandTotalMTD || 0),
        postData.topWorkerMTDName || '',
        postData.generatedAt || new Date().toISOString(),
        pdfUrl || 'Saved in Sheet'
      ]);

      return ContentService.createTextOutput(JSON.stringify({ 
        success: true, 
        message: "Report & PDF link appended to CEO_CFO_Daily_Reports tab",
        pdfUrl: pdfUrl 
      })).setMimeType(ContentService.MimeType.JSON);
    }
    
    return ContentService.createTextOutput(JSON.stringify({ error: "Invalid action" }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch (globalErr) {
    return ContentService.createTextOutput(JSON.stringify({ 
      error: "Google Apps Script Exception: " + globalErr.toString() 
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * ----------------------------------------------------------------------------------
 * 🔴 AUTOMATED EVENING REPORT & PDF GENERATOR (LITTLE NAP RECLINERS)
 * ----------------------------------------------------------------------------------
 * If you split your Apps Script into separate files, keep this entire block 
 * in your ReportGenerator.gs script file!
 * ----------------------------------------------------------------------------------
 */

// 🛋️ LITTLE NAP RECLINERS LOGO IMAGE URL
// Paste your direct image URL here (e.g., hosted on Google Drive, Cloud, Imgur, or website)
// Example: "https://i.ibb.co/little-nap-logo.png"
var LOGO_IMAGE_URL = "";

function generateAndSaveEveningReport() {
  // Local helper fallback in case this function is placed in a separate file (e.g. Report.gs)
  var findHeaderIndex = typeof getHeaderIdx === 'function' ? getHeaderIdx : function(headerList, possibleKeys) {
    if (!headerList || !Array.isArray(headerList)) return -1;
    for (var k = 0; k < possibleKeys.length; k++) {
      var key = possibleKeys[k].toLowerCase();
      for (var col = 0; col < headerList.length; col++) {
        var h = String(headerList[col]).trim().toLowerCase();
        if (h === key || h === key.replace(/\s+/g, '') || (key.length > 3 && h.indexOf(key) !== -1)) {
          return col;
        }
      }
    }
    return -1;
  };

  var parseDateStringGAS = function(dateInput) {
    if (!dateInput) return null;
    if (dateInput instanceof Date) {
      if (isNaN(dateInput.getTime())) return null;
      return dateInput;
    }
    var str = String(dateInput).trim();
    if (str.startsWith("'")) str = str.slice(1);
    if (!str || str === 'N/A') return null;

    // 1. YYYY-MM-DD or YYYY/MM/DD
    var matchYmd = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (matchYmd) {
      return new Date(Number(matchYmd[1]), Number(matchYmd[2]) - 1, Number(matchYmd[3]));
    }

    // 2. DD-MM-YYYY or DD/MM/YYYY
    var matchDmy = str.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (matchDmy) {
      return new Date(Number(matchDmy[3]), Number(matchDmy[2]) - 1, Number(matchDmy[1]));
    }

    // 3. DD-MMM-YYYY or DD/MMM/YYYY or DD MMM YYYY, e.g., "30-Jul-2026"
    var matchDmyName = str.match(/^(\d{1,2})[-/\s]+([A-Za-z]{3,9})[-/\s]+(\d{4})/);
    if (matchDmyName) {
      var mName = matchDmyName[2].toLowerCase().substring(0, 3);
      var monthsArr = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
      var mIdx = monthsArr.indexOf(mName);
      return new Date(Number(matchDmyName[3]), mIdx !== -1 ? mIdx : 0, Number(matchDmyName[1]));
    }

    var parsed = new Date(str);
    if (!isNaN(parsed.getTime())) return parsed;
    return null;
  };

  var formatDateHelper = typeof formatDateDDMMMYYYY === 'function' ? formatDateDDMMMYYYY : function(dInput) {
    if (!dInput) return '';
    var dateObj = dInput instanceof Date ? dInput : parseDateStringGAS(dInput);
    if (!dateObj || isNaN(dateObj.getTime())) return String(dInput);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return String(dateObj.getDate()).padStart(2, '0') + '-' + months[dateObj.getMonth()] + '-' + dateObj.getFullYear();
  };

  var ss = getSpreadsheet();
  var respSheet = ss.getSheetByName('Response');
  if (!respSheet) {
    Logger.log("Response sheet not found!");
    return;
  }

  // Calculate Yesterday Date in IST Timezone (Asia/Kolkata)
  var nowInIST = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  var yesterday = new Date(nowInIST);
  yesterday.setDate(nowInIST.getDate() - 1);

  var yYear = yesterday.getFullYear();
  var yMonth = yesterday.getMonth(); // 0-indexed
  var yDay = yesterday.getDate();

  var yDateStr = yYear + "-" + String(yMonth + 1).padStart(2, '0') + "-" + String(yDay).padStart(2, '0');
  var monthStartStr = yYear + "-" + String(yMonth + 1).padStart(2, '0') + "-01";

  var data = respSheet.getDataRange().getValues();
  if (data.length <= 1) return;

  var headers = data[0].map(function(h) { return String(h).trim().toLowerCase(); });
  
  var idxDate = findHeaderIndex(headers, ['date']);
  var idxHours = findHeaderIndex(headers, ['ot hours', 'overtime hours', 'hours']);
  var idxFooding = findHeaderIndex(headers, ['fooding', 'fooding applicable', 'food']);
  var idxEmpCode = findHeaderIndex(headers, ['employee code', 'emp code', 'code']);
  var idxEmpName = findHeaderIndex(headers, ['employee name', 'emp name', 'name']);
  var idxDept = findHeaderIndex(headers, ['department', 'dept']);
  var idxTotalSal = findHeaderIndex(headers, ['total salary', 'totalsalary', 'total_salary']);
  var idxBasic = findHeaderIndex(headers, ['basic', 'basic salary']);
  var idxOTCost = findHeaderIndex(headers, ['ot cost', 'ot amount', 'overtime cost', 'overtime pay']);

  // Pre-load Master Data Employee Map for accurate salary calculation
  var empSalaryMap = {};
  var masterSheet = ss.getSheetByName('Master Data') || ss.getSheetByName('Master');
  if (masterSheet) {
    try {
      var masterData = masterSheet.getDataRange().getValues();
      if (masterData.length > 1) {
        var mHeaders = masterData[0].map(function(h) { return String(h).trim().toLowerCase(); });
        var mCodeIdx = findHeaderIndex(mHeaders, ['employee code', 'emp code', 'code']);
        var mSalIdx = findHeaderIndex(mHeaders, ['total salary', 'totalsalary', 'total_salary']);
        var mBasicIdx = findHeaderIndex(mHeaders, ['basic', 'basic salary']);

        for (var m = 1; m < masterData.length; m++) {
          var mRow = masterData[m];
          var rawCode = mCodeIdx !== -1 ? String(mRow[mCodeIdx] || '').trim() : String(mRow[0] || '').trim();
          if (!rawCode) continue;

          var tSal = mSalIdx !== -1 ? Number(mRow[mSalIdx]) || 0 : 0;
          var bSal = mBasicIdx !== -1 ? Number(mRow[mBasicIdx]) || 0 : 0;

          // Column index fallbacks if dynamic headers weren't matched (0: code, 1: name, 3: dept, 5: basic, 12: totalSalary)
          if (!tSal && mRow[12] !== undefined) tSal = Number(mRow[12]) || 0;
          if (!bSal && mRow[5] !== undefined) bSal = Number(mRow[5]) || 0;

          var finalSal = tSal > 0 ? tSal : (bSal > 0 ? bSal : 0);
          
          var empObj = {
            totalSalary: finalSal,
            basic: bSal,
            name: String(mRow[1] || rawCode),
            dept: String(mRow[3] || 'General')
          };

          empSalaryMap[rawCode] = empObj;
          empSalaryMap[rawCode.toUpperCase()] = empObj;
          empSalaryMap[rawCode.toLowerCase()] = empObj;
          var cleanKey = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
          if (cleanKey) empSalaryMap[cleanKey] = empObj;
        }
      }
    } catch (mErr) {
      Logger.log("Master Data load error: " + mErr.toString());
    }
  }

  var yHours = 0, yFoodCount = 0, yOTCost = 0;
  var yWorkers = {};

  var mtdHours = 0, mtdFoodCount = 0, mtdOTCost = 0;
  var mtdWorkers = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var rawDate = idxDate !== -1 ? row[idxDate] : null;
    if (!rawDate) continue;

    var dateObj = parseDateStringGAS(rawDate);
    if (!dateObj) continue;

    var rYear = dateObj.getFullYear();
    var rMonth = dateObj.getMonth();
    var rDay = dateObj.getDate();

    var rowDateStr = rYear + "-" + String(rMonth + 1).padStart(2, '0') + "-" + String(rDay).padStart(2, '0');
    var hours = idxHours !== -1 ? (Number(row[idxHours]) || 0) : 0;

    var foodVal = idxFooding !== -1 ? String(row[idxFooding]).trim().toLowerCase() : '';
    var isFooding = (foodVal === 'yes' || foodVal === '1' || foodVal === 'true' || Number(foodVal) > 0) ? 1 : 0;
    if (!isFooding && (hours === 4.5 || hours === 5)) {
      isFooding = 1;
    }

    var empCode = idxEmpCode !== -1 ? String(row[idxEmpCode] || '').trim() : '';
    var cleanEmpCode = empCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    var empMaster = empSalaryMap[empCode] || empSalaryMap[empCode.toUpperCase()] || empSalaryMap[empCode.toLowerCase()] || empSalaryMap[cleanEmpCode] || {};
    var empName = idxEmpName !== -1 ? String(row[idxEmpName] || empMaster.name || empCode).trim() : (empMaster.name || empCode);
    var dept = idxDept !== -1 ? String(row[idxDept] || empMaster.dept || 'General').trim() : (empMaster.dept || 'General');

    // Worker grouping key: use clean employee code if valid, otherwise upper-cased employee name
    var workerKey = (cleanEmpCode && cleanEmpCode !== 'EMP' && cleanEmpCode !== 'UNKNOWN') 
      ? cleanEmpCode 
      : (empName ? empName.toUpperCase().replace(/\s+/g, '_') : 'UNKNOWN');

    // Salary resolution matching Web App logic exactly:
    // Prefer row Total Salary, then Master Data Total Salary, then row Basic, then Master Data Basic
    var rowTotalSalary = (idxTotalSal !== -1 && row[idxTotalSal] !== '' && row[idxTotalSal] !== null) ? (Number(row[idxTotalSal]) || 0) : 0;
    var rowBasic = (idxBasic !== -1 && row[idxBasic] !== '' && row[idxBasic] !== null) ? (Number(row[idxBasic]) || 0) : 0;
    
    var totalSalary = rowTotalSalary > 0 
      ? rowTotalSalary 
      : ((empMaster.totalSalary && empMaster.totalSalary > 0) 
        ? empMaster.totalSalary 
        : (rowBasic > 0 ? rowBasic : (empMaster.basic || 0)));

    // OT Cost calculation exact formula matching Web App:
    // (Total Salary ÷ Days in Month ÷ 8) × Overtime Hours (Rounded to nearest integer per record)
    var otCostVal = 0;
    if (idxOTCost !== -1 && row[idxOTCost] !== '' && row[idxOTCost] !== null && !isNaN(Number(row[idxOTCost])) && Number(row[idxOTCost]) > 0) {
      otCostVal = Number(row[idxOTCost]);
    } else {
      if (totalSalary > 0) {
        var daysInMonth = new Date(rYear, rMonth + 1, 0).getDate();
        var hourlyRate = totalSalary / daysInMonth / 8;
        otCostVal = Math.round(hourlyRate * hours);
      }
    }

    var displayCode = (empCode && empCode !== 'EMP' && empCode !== 'UNKNOWN') ? empCode : (empMaster.code || '');

    // Yesterday match
    if (rowDateStr === yDateStr) {
      yHours += hours;
      yFoodCount += isFooding;
      yOTCost += otCostVal;

      if (!yWorkers[workerKey]) {
        yWorkers[workerKey] = { code: displayCode, name: empName, dept: dept, hours: 0, otCost: 0, foodCost: 0, total: 0 };
      }
      yWorkers[workerKey].hours += hours;
      yWorkers[workerKey].otCost += otCostVal;
      yWorkers[workerKey].foodCost += (isFooding * 50);
      yWorkers[workerKey].total = yWorkers[workerKey].otCost + yWorkers[workerKey].foodCost;
    }

    // MTD match (1st to Yesterday)
    if (rowDateStr >= monthStartStr && rowDateStr <= yDateStr) {
      mtdHours += hours;
      mtdFoodCount += isFooding;
      mtdOTCost += otCostVal;

      if (!mtdWorkers[workerKey]) {
        mtdWorkers[workerKey] = { code: displayCode, name: empName, dept: dept, hours: 0, otCost: 0, foodCost: 0, total: 0 };
      }
      mtdWorkers[workerKey].hours += hours;
      mtdWorkers[workerKey].otCost += otCostVal;
      mtdWorkers[workerKey].foodCost += (isFooding * 50);
      mtdWorkers[workerKey].total = mtdWorkers[workerKey].otCost + mtdWorkers[workerKey].foodCost;
    }
  }

  var yFoodCost = yFoodCount * 50;
  var yGrandTotal = yOTCost + yFoodCost;

  var mtdFoodCost = mtdFoodCount * 50;
  var mtdGrandTotal = mtdOTCost + mtdFoodCost;

  // Find Highest OT Worker Yesterday (Prioritize OT Hours, then Total Amount)
  var yTopName = "None Recorded";
  var yMaxHours = -1;
  var yMaxTotal = -1;
  for (var kInY in yWorkers) {
    var wY = yWorkers[kInY];
    if (wY.hours > yMaxHours || (wY.hours === yMaxHours && wY.total > yMaxTotal)) {
      yMaxHours = wY.hours;
      yMaxTotal = wY.total;
      var cStr = wY.code ? (wY.code + " - ") : "";
      yTopName = wY.name + " (" + cStr + wY.dept + ") | " + wY.hours + " Hrs | Rs." + Math.round(wY.total);
    }
  }

  // Find Highest OT Worker MTD (Prioritize OT Hours, then Total Amount)
  var mtdTopName = "None Recorded";
  var mtdMaxHours = -1;
  var mtdMaxTotal = -1;
  for (var kInMtd in mtdWorkers) {
    var wM = mtdWorkers[kInMtd];
    if (wM.hours > mtdMaxHours || (wM.hours === mtdMaxHours && wM.total > mtdMaxTotal)) {
      mtdMaxHours = wM.hours;
      mtdMaxTotal = wM.total;
      var cStrM = wM.code ? (wM.code + " - ") : "";
      mtdTopName = wM.name + " (" + cStrM + wM.dept + ") | " + wM.hours + " Hrs MTD | Rs." + Math.round(wM.total);
    }
  }

  var yDateFormatted = formatDateHelper(yDateStr);
  var mtdRangeFormatted = formatDateHelper(monthStartStr) + ' to ' + formatDateHelper(yDateStr);

  // Generate PDF in Google Drive
  var pdfUrl = "";
  try {
    pdfUrl = createPdfReportInDrive({
      dateFormatted: yDateFormatted,
      mtdRange: mtdRangeFormatted,
      yHours: Math.round(yHours * 100) / 100,
      yFooding: Math.round(yFoodCost),
      yOtAmount: Math.round(yOTCost),
      yGrandTotal: Math.round(yGrandTotal),
      yTopWorker: yTopName,
      mtdHours: Math.round(mtdHours * 100) / 100,
      mtdFooding: Math.round(mtdFoodCost),
      mtdOtAmount: Math.round(mtdOTCost),
      mtdGrandTotal: Math.round(mtdGrandTotal),
      mtdTopWorker: mtdTopName,
      generatedAt: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    });
  } catch (pdfErr) {
    Logger.log("PDF generation warning: " + pdfErr.toString());
  }

  // Get or Create Report Sheet Tab
  var repSheet = ss.getSheetByName('CEO_CFO_Daily_Reports');
  if (!repSheet) {
    repSheet = ss.insertSheet('CEO_CFO_Daily_Reports');
    repSheet.appendRow([
      'Company Header',
      'Report Date',
      'Yesterday OT Hours',
      'Yesterday Fooding Allowance (Rs)',
      'Yesterday OT Amount (Rs)',
      'Yesterday Grand Total (Rs)',
      'Yesterday Top Worker',
      'MTD Range',
      'MTD OT Hours',
      'MTD Fooding Allowance (Rs)',
      'MTD OT Amount (Rs)',
      'MTD Grand Total (Rs)',
      'MTD Top Worker',
      'Report Generated At',
      'PDF Report Drive Link'
    ]);

    try {
      repSheet.getRange(1, 1, 1, 15)
        .setFontWeight('bold')
        .setBackground('#0f172a')
        .setFontColor('#ffffff');
    } catch (e) {}
  }

  repSheet.appendRow([
    'Little Nap Recliners',
    yDateFormatted,
    Math.round(yHours * 100) / 100,
    Math.round(yFoodCost),
    Math.round(yOTCost),
    Math.round(yGrandTotal),
    yTopName,
    mtdRangeFormatted,
    Math.round(mtdHours * 100) / 100,
    Math.round(mtdFoodCost),
    Math.round(mtdOTCost),
    Math.round(mtdGrandTotal),
    mtdTopName,
    new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    pdfUrl || 'Saved in Sheet'
  ]);

  Logger.log("✅ Evening CEO & CFO Executive Report & PDF generated for date: " + yDateFormatted + " | Link: " + pdfUrl);
}

/**
 * Generates an HTML document with Little Nap Recliners logo header, light clean premium styles,
 * converts it into a PDF blob, uploads to Google Drive, sets sharing permissions, and returns the PDF view URL.
 */
function createPdfReportInDrive(p) {
  var formatDateHelper = typeof formatDateDDMMMYYYY === 'function' ? formatDateDDMMMYYYY : function(dInput) {
    if (!dInput) return '';
    var dateObj = dInput instanceof Date ? dInput : new Date(String(dInput).replace(/^'/, ''));
    if (isNaN(dateObj.getTime())) return String(dInput);
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return String(dateObj.getDate()).padStart(2, '0') + '-' + months[dateObj.getMonth()] + '-' + dateObj.getFullYear();
  };

  var targetDateDisp = formatDateHelper(p.dateFormatted || '');
  var mtdRangeDisp = p.mtdRange || '';
  if (mtdRangeDisp.indexOf(' to ') !== -1) {
    var parts = mtdRangeDisp.split(' to ');
    mtdRangeDisp = formatDateHelper(parts[0]) + ' to ' + formatDateHelper(parts[1]);
  }

  var html = '<!DOCTYPE html><html><head><meta charset="utf-8">';
  html += '<style>';
  html += 'body { font-family: "Helvetica Neue", Arial, sans-serif; color: #1e293b; background-color: #ffffff; margin: 0; padding: 24px; }';
  html += '.header { border-bottom: 3px solid #4f46e5; padding-bottom: 12px; margin-bottom: 20px; width: 100%; }';
  html += '.logo-title { font-size: 20px; font-weight: 800; color: #0f172a; letter-spacing: 1px; }';
  html += '.logo-sub { font-size: 11px; font-weight: 700; color: #4f46e5; text-transform: uppercase; margin-top: 2px; }';
  html += '.badge { background-color: #f1f5f9; border: 1px solid #cbd5e1; color: #334155; font-size: 10px; padding: 6px 12px; border-radius: 6px; font-weight: bold; text-align: right; }';
  html += '.grid { width: 100%; border-collapse: separate; border-spacing: 12px 0; margin-bottom: 20px; }';
  html += '.card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; vertical-align: top; }';
  html += '.card-title { font-size: 12px; font-weight: 800; text-transform: uppercase; margin-bottom: 10px; padding-bottom: 4px; border-bottom: 2px solid; }';
  html += '.card-yesterday .card-title { color: #4f46e5; border-color: #818cf8; }';
  html += '.card-mtd .card-title { color: #059669; border-color: #34d399; }';
  html += '.stat-row { font-size: 11px; margin-bottom: 6px; display: flex; justify-content: space-between; }';
  html += '.stat-label { font-weight: 600; color: #64748b; }';
  html += '.stat-val { font-weight: 700; color: #0f172a; }';
  html += '.highlight-box { background: #e0e7ff; border-radius: 6px; padding: 8px; margin-top: 10px; font-size: 12px; font-weight: bold; color: #3730a3; text-align: center; }';
  html += '.highlight-box-mtd { background: #d1fae5; border-radius: 6px; padding: 8px; margin-top: 10px; font-size: 12px; font-weight: bold; color: #065f46; text-align: center; }';
  html += '.top-worker { background: #0f172a; color: #ffffff; border-radius: 6px; padding: 10px; margin-top: 10px; font-size: 10px; }';
  html += '.top-worker-title { color: #fbbf24; font-weight: 800; text-transform: uppercase; margin-bottom: 4px; }';
  html += 'table.table-summary { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 10px; }';
  html += 'table.table-summary th { background: #f1f5f9; color: #0f172a; font-weight: 700; text-align: left; padding: 8px; border-bottom: 2px solid #cbd5e1; }';
  html += 'table.table-summary td { padding: 8px; border-bottom: 1px solid #e2e8f0; color: #334155; }';
  html += 'table.table-summary tr:nth-child(even) td { background: #f8fafc; }';
  html += '</style></head><body>';

  html += '<div class="header">';
  html += '<table style="width:100%;"><tr><td style="vertical-align:middle;">';
  html += '<div style="display:flex; align-items:center;">';
  
  var logoUrlToUse = (p && p.logoUrl) ? p.logoUrl : (typeof LOGO_IMAGE_URL !== 'undefined' ? LOGO_IMAGE_URL : '');
  if (logoUrlToUse && logoUrlToUse.trim().length > 5) {
    html += '<img src="' + logoUrlToUse.trim() + '" style="max-height:48px; max-width:180px; object-fit:contain; margin-right:12px;" alt="Little Nap Logo" />';
  } else {
    html += '<div style="display:inline-block; width:42px; height:42px; background:#EEF2FF; border:1px solid #818CF8; border-radius:10px; text-align:center; line-height:40px; font-size:22px; margin-right:12px;">🛋️</div>';
  }
  
  html += '<div style="display:inline-block; vertical-align:middle;">';
  html += '<div class="logo-title">LITTLE NAP RECLINERS</div>';
  html += '<div class="logo-sub">Factory Overtime Audit Daily Report</div>';
  html += '</div></div>';
  html += '</td>';
  html += '<td style="text-align:right; vertical-align:middle;">';
  html += '<div class="badge">';
  html += '<strong>Report Till Date:</strong> ' + targetDateDisp + '<br>';
  html += '<strong>Generated:</strong> ' + (p.generatedAt || '') + '';
  html += '</div>';
  html += '</td></tr></table>';
  html += '</div>';

  html += '<table class="grid"><tr>';
  
  // Yesterday Card
  html += '<td class="card card-yesterday" width="50%">';
  html += '<div class="card-title">1. Yesterday Summary (' + targetDateDisp + ')</div>';
  html += '<div class="stat-row"><span class="stat-label">Total OT Hours:</span><span class="stat-val">' + p.yHours + ' Hrs</span></div>';
  html += '<div class="stat-row"><span class="stat-label">Fooding Allowance:</span><span class="stat-val">Rs. ' + Math.round(p.yFooding).toLocaleString('en-IN') + '</span></div>';
  html += '<div class="stat-row"><span class="stat-label">OT Wage Payload:</span><span class="stat-val">Rs. ' + Math.round(p.yOtAmount).toLocaleString('en-IN') + '</span></div>';
  html += '<div class="highlight-box">Yesterday Total: Rs. ' + Math.round(p.yGrandTotal).toLocaleString('en-IN') + '</div>';
  html += '<div class="top-worker"><div class="top-worker-title">⚠️ Highest Overtime Worker Yesterday (Needs Review)</div><strong style="color:#ffffff; font-size:11px;">' + (p.yTopWorker || 'None') + '</strong></div>';
  html += '</td>';

  // MTD Card
  html += '<td class="card card-mtd" width="50%">';
  html += '<div class="card-title">2. Month-To-Date Summary (' + mtdRangeDisp + ')</div>';
  html += '<div class="stat-row"><span class="stat-label">Total MTD Hours:</span><span class="stat-val">' + p.mtdHours + ' Hrs</span></div>';
  html += '<div class="stat-row"><span class="stat-label">MTD Fooding Allowance:</span><span class="stat-val">Rs. ' + Math.round(p.mtdFooding).toLocaleString('en-IN') + '</span></div>';
  html += '<div class="stat-row"><span class="stat-label">MTD OT Cost:</span><span class="stat-val">Rs. ' + Math.round(p.mtdOtAmount).toLocaleString('en-IN') + '</span></div>';
  html += '<div class="highlight-box-mtd">MTD Grand Total: Rs. ' + Math.round(p.mtdGrandTotal).toLocaleString('en-IN') + '</div>';
  html += '<div class="top-worker"><div class="top-worker-title">⚠️ Highest MTD Overtime Worker (Needs Review)</div><strong style="color:#ffffff; font-size:11px;">' + (p.mtdTopWorker || 'None') + '</strong></div>';
  html += '</td>';

  html += '</tr></table>';

  // Table Matrix
  html += '<table class="table-summary">';
  html += '<thead><tr><th>FINANCIAL PARAMETER</th><th>YESTERDAY (' + targetDateDisp + ')</th><th>MONTH-TO-DATE (' + mtdRangeDisp + ')</th></tr></thead>';
  html += '<tbody>';
  html += '<tr><td>Overtime Hours Logged</td><td>' + p.yHours + ' Hrs</td><td>' + p.mtdHours + ' Hrs</td></tr>';
  html += '<tr><td>Fooding Allowance (Rs. 50/worker)</td><td>Rs. ' + Math.round(p.yFooding).toLocaleString('en-IN') + '</td><td>Rs. ' + Math.round(p.mtdFooding).toLocaleString('en-IN') + '</td></tr>';
  html += '<tr><td>Overtime Wage Liability</td><td>Rs. ' + Math.round(p.yOtAmount).toLocaleString('en-IN') + '</td><td>Rs. ' + Math.round(p.mtdOtAmount).toLocaleString('en-IN') + '</td></tr>';
  html += '<tr><td><strong>Grand Total Combined Expense</strong></td><td><strong>Rs. ' + Math.round(p.yGrandTotal).toLocaleString('en-IN') + '</strong></td><td><strong>Rs. ' + Math.round(p.mtdGrandTotal).toLocaleString('en-IN') + '</strong></td></tr>';
  html += '</tbody></table>';

  html += '</body></html>';

  // Convert HTML to PDF Blob
  var htmlOutput = HtmlService.createHtmlOutput(html);
  var pdfBlob = htmlOutput.getAs('application/pdf').setName('Factory_OT_Audit_Report_' + (targetDateDisp || 'Daily') + '.pdf');

  // Save to Google Drive
  var file = DriveApp.createFile(pdfBlob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (sErr) {}

  return file.getUrl();
}
