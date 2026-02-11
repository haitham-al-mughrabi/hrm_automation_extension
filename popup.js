let editingPipelineId = null;
const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Encryption utilities for secure variable storage
const ENCRYPTION_KEY_NAME = "pipeline_encryption_key";

async function getOrCreateEncryptionKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(ENCRYPTION_KEY_NAME, async (data) => {
      if (data[ENCRYPTION_KEY_NAME]) {
        // Import existing key
        const keyData = data[ENCRYPTION_KEY_NAME];
        const key = await crypto.subtle.importKey(
          "jwk",
          keyData,
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"],
        );
        resolve(key);
      } else {
        // Generate new key
        const key = await crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"],
        );
        // Export and save key
        const exportedKey = await crypto.subtle.exportKey("jwk", key);
        chrome.storage.local.set({ [ENCRYPTION_KEY_NAME]: exportedKey });
        resolve(key);
      }
    });
  });
}

async function encryptValue(value) {
  try {
    const key = await getOrCreateEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(value);

    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encoded,
    );

    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);

    // Convert to base64 for storage
    return btoa(String.fromCharCode(...combined));
  } catch (error) {
    console.error("Encryption error:", error);
    return value; // Fallback to unencrypted if error
  }
}

async function decryptValue(encryptedValue) {
  if (!encryptedValue || typeof encryptedValue !== "string")
    return encryptedValue;
  if (encryptedValue.length < 16) return encryptedValue;

  try {
    const key = await getOrCreateEncryptionKey();

    let combined;
    try {
      combined = Uint8Array.from(atob(encryptedValue), (c) => c.charCodeAt(0));
    } catch (e) {
      return encryptedValue;
    }

    if (combined.length < 13) return encryptedValue;

    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encrypted,
    );

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.warn("Decryption failed, assuming plain text:", error);
    return encryptedValue;
  }
}

function maskValue(value) {
  return "•".repeat(Math.min(value.length, 12));
}

function showConfirm(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.classList.add('show');
    
    const handleOk = () => {
      modal.classList.remove('show');
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      resolve(true);
    };
    
    const handleCancel = () => {
      modal.classList.remove('show');
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      resolve(false);
    };
    
    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
  });
}

async function checkServerStatus() {
  const statusEl = document.getElementById('serverStatus');
  const statusDot = statusEl.querySelector('.status-dot');
  const statusText = statusEl.querySelector('.status-text');
  
  try {
    const response = await fetch('http://localhost:5000/health', {
      method: 'GET',
      signal: AbortSignal.timeout(2000)
    });
    
    if (response.ok) {
      statusEl.classList.remove('offline');
      statusEl.classList.add('online');
      statusText.textContent = 'Server Online';
      statusEl.style.display = 'flex';
    } else {
      throw new Error('Server not healthy');
    }
  } catch (error) {
    statusEl.classList.remove('online');
    statusEl.classList.add('offline');
    statusText.textContent = 'Server Offline';
    statusEl.style.display = 'flex';
  }
}

document.addEventListener("DOMContentLoaded", function () {
  loadPipelines();
  loadResults();
  setupTabNavigation();
  
  // Listen for history updates from background
  // Listen for history updates from background
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'historyUpdated') {
      console.log('History updated! Reloading results...');
      loadResults();
    }
  });
  
  // Check for updates when popup opens
  const currentTab = document.querySelector('.tab-btn.active')?.dataset.tab;
  if (currentTab === 'results') {
    loadResults();
  }
  
  // Refresh button
  document.getElementById('refreshResults').addEventListener('click', function() {
    console.log('Manual refresh triggered');
    loadResults();
    showStatus('✓ Results refreshed', 'success');
  });
  
  // Clear history button
  document.getElementById('clearHistory').addEventListener('click', async function() {
    const confirmed = await showConfirm('Clear History', 'Are you sure you want to clear all execution history?');
    if (confirmed) {
      chrome.storage.local.set({ executionHistory: [] }, () => {
        loadResults();
        showStatus('✓ History cleared', 'success');
      });
    }
  });
  
  // Auto-refresh results every 5 seconds if on Results tab (only if there are running executions)
  let refreshInterval = setInterval(() => {
    const resultsTab = document.querySelector('[data-tab="results"]');
    if (resultsTab && resultsTab.classList.contains('active')) {
      chrome.storage.local.get({ executionHistory: [] }, (data) => {
        const hasRunning = data.executionHistory?.some(e => e.status === 'running');
        if (hasRunning) {
          console.log('Auto-refreshing results (running executions detected)...');
          loadResults();
        }
      });
    }
  }, 5000);
  
  // Clear interval when popup closes
  window.addEventListener('unload', () => {
    clearInterval(refreshInterval);
  });
  
  // Check server status on load
  checkServerStatus();
  let statusInterval = setInterval(checkServerStatus, 10000); // Check every 10 seconds
  
  window.addEventListener('unload', () => {
    clearInterval(statusInterval);
  });

  // Server status click handler
  document.getElementById('serverStatus').addEventListener('click', function() {
    const isOnline = this.classList.contains('online');
    if (isOnline) {
      alert('Local server is running on http://localhost:5000\n\nServer is ready to execute tests.');
    } else {
      const instructions = 'Local server is not running.\n\n' +
        'To start the server:\n\n' +
        'Mac/Linux:\n' +
        '  cd /path/to/hrm_automation\n' +
        '  ./start_server.sh\n\n' +
        'Windows:\n' +
        '  cd \\path\\to\\hrm_automation\n' +
        '  start_server.bat\n\n' +
        'Or manually:\n' +
        '  python3 local_server.py';
      alert(instructions);
    }
  });

  // Tab navigation
  function setupTabNavigation() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const resultsActions = document.getElementById('resultsActions');
    
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        
        // Update active tab button
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update active tab content
        document.querySelectorAll('.tab-content').forEach(content => {
          content.classList.remove('active');
        });
        
        if (tabName === 'pipelines') {
          document.getElementById('pipelinesTab').classList.add('active');
          resultsActions.style.display = 'none';
        } else if (tabName === 'results') {
          document.getElementById('resultsTab').classList.add('active');
          resultsActions.style.display = 'flex';
          loadResults(); // Refresh results when tab is opened
        }
      });
    });
  }

  
  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.run-menu').forEach(menu => {
      menu.classList.remove('show');
    });
  });
  
  loadPipelines();
  setupEventListeners();

  // Set current year in footer
  var currentYear = new Date().getFullYear();
  document.getElementById("currentYear").textContent = currentYear;
});

function setupEventListeners() {
  // Navigation
  document.getElementById("addNewBtn").addEventListener("click", function () {
    showFormView();
  });
  document.getElementById("backBtn").addEventListener("click", function () {
    showMainView();
  });

  document.getElementById("cancelBtn").addEventListener("click", function () {
    if (
      confirm(
        "Are you sure you want to cancel? Any unsaved changes will be lost.",
      )
    ) {
      showMainView();
    }
  });

  // Execution type change
  document.getElementById("executionType").addEventListener("change", function() {
    const type = this.value;
    const gitlabUrlGroup = document.getElementById("gitlabUrlGroup");
    const triggerTokenGroup = document.getElementById("triggerTokenGroup");
    const branchRefGroup = document.getElementById("branchRefGroup");
    const localProjectDirGroup = document.getElementById("localProjectDirGroup");
    const localTestTypeGroup = document.getElementById("localTestTypeGroup");
    const localTestPathGroup = document.getElementById("localTestPathGroup");
    
    if (type === "local") {
      gitlabUrlGroup.style.display = "none";
      triggerTokenGroup.style.display = "none";
      branchRefGroup.style.display = "none";
      localProjectDirGroup.style.display = "block";
      localTestTypeGroup.style.display = "block";
      localTestPathGroup.style.display = "block";
    } else {
      gitlabUrlGroup.style.display = "block";
      triggerTokenGroup.style.display = "block";
      branchRefGroup.style.display = "block";
      localProjectDirGroup.style.display = "none";
      localTestTypeGroup.style.display = "none";
      localTestPathGroup.style.display = "none";
    }
  });

  // Test type change - update placeholder
  document.getElementById("localTestType").addEventListener("change", function() {
    const type = this.value;
    const pathInput = document.getElementById("localTestPath");
    const helperText = pathInput.nextElementSibling;
    
    if (type === "test") {
      pathInput.placeholder = "e.g., My Test Case Name";
      helperText.textContent = "Test case name (uses --test option)";
    } else if (type === "suite") {
      pathInput.placeholder = "e.g., My Suite Name";
      helperText.textContent = "Suite name (uses --suite option)";
    } else if (type === "file") {
      pathInput.placeholder = "e.g., Tests/Test.robot";
      helperText.textContent = "Path to .robot file";
    } else {
      pathInput.placeholder = "e.g., Tests/";
      helperText.textContent = "Path to directory containing tests";
    }
  });

  // Form actions
  document.getElementById("saveBtn").addEventListener("click", savePipeline);
  document.getElementById("testBtn").addEventListener("click", testPipeline);
  document
    .getElementById("toggleToken")
    .addEventListener("click", toggleTokenVisibility);

  // Variables management
  document
    .getElementById("addVariableBtn")
    .addEventListener("click", addVariable);
  document
    .getElementById("variableKey")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        document.getElementById("variableValue").focus();
      }
    });
  document
    .getElementById("variableValue")
    .addEventListener("keypress", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        addVariable();
      }
    });

  // Day selector
  document.querySelectorAll(".day-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      btn.classList.toggle("active");
    });
  });

  // Time input validation
  document
    .getElementById("triggerHours")
    .addEventListener("input", function (e) {
      validateTimeInput(e.target, 0, 23);
    });
  document
    .getElementById("triggerMinutes")
    .addEventListener("input", function (e) {
      validateTimeInput(e.target, 0, 59);
    });
  document
    .getElementById("triggerSeconds")
    .addEventListener("input", function (e) {
      validateTimeInput(e.target, 0, 59);
    });
}

function validateTimeInput(input, min, max) {
  var value = parseInt(input.value);
  if (isNaN(value) || value < min) {
    input.value = String(min).padStart(2, "0");
  } else if (value > max) {
    input.value = String(max).padStart(2, "0");
  } else {
    input.value = String(value).padStart(2, "0");
  }
}

function showMainView() {
  document.getElementById("formView").classList.remove("active");
  document.getElementById("mainView").classList.add("active");
  editingPipelineId = null;
  clearForm();
}

function showFormView(pipeline = null) {
  document.getElementById("mainView").classList.remove("active");
  document.getElementById("formView").classList.add("active");

  if (pipeline) {
    // Edit mode
    editingPipelineId = pipeline.id;
    document.getElementById("formTitle").textContent = "Edit Automation";
    populateForm(pipeline);
  } else {
    // Add mode
    editingPipelineId = null;
    document.getElementById("formTitle").textContent = "Add Automation";
    clearForm();
  }
}

function loadPipelines() {
  chrome.storage.local.get({ pipelines: [] }, (data) => {
    const pipelines = data.pipelines;
    displayPipelines(pipelines);
    updatePipelineCount(pipelines.length);
  });
}

function displayPipelines(pipelines) {
  const listContainer = document.getElementById("pipelinesList");
  const emptyState = document.getElementById("emptyState");

  if (pipelines.length === 0) {
    emptyState.classList.remove("hidden");
    listContainer.innerHTML = "";
    return;
  }

  emptyState.classList.add("hidden");
  listContainer.innerHTML = pipelines
    .map((pipeline) => createPipelineCard(pipeline))
    .join("");

  // Attach event listeners
  pipelines.forEach((pipeline) => {
    document
      .getElementById(`run-${pipeline.id}`)
      .addEventListener("click", () => runPipelineNow(pipeline.id));
    
    document
      .getElementById(`update-${pipeline.id}`)
      .addEventListener("click", () => showFormView(pipeline));
    document
      .getElementById(`delete-${pipeline.id}`)
      .addEventListener("click", () => deletePipeline(pipeline.id));
  });
}

function createPipelineCard(pipeline) {
  const activeDaysChips = dayNames
    .map((day, index) => {
      const isActive = pipeline.activeDays.includes(index);
      return `<span class="day-chip ${isActive ? "active" : ""}">${day}</span>`;
    })
    .join("");

  const executionTypeLabel = pipeline.executionType === "local" ? 
    '<span class="execution-type-badge local">🖥️ Local</span>' : 
    '<span class="execution-type-badge gitlab">☁️ Remote</span>';

  return `
    <div class="pipeline-card ${pipeline.isActive ? "" : "inactive"}">
      <div class="pipeline-header">
        <div class="pipeline-info">
          <h3>
            ${escapeHtml(pipeline.name)}
            <span class="status-badge ${pipeline.isActive ? "active" : "inactive"}">
              <span class="status-indicator"></span>
              ${pipeline.isActive ? "Active" : "Inactive"}
            </span>
            ${executionTypeLabel}
          </h3>
          <div class="pipeline-time">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm.5-10.5a.5.5 0 00-1 0v4.586L5.354 11.232a.5.5 0 00.707.707l2.5-2.5A.5.5 0 009 9V4.5z" clip-rule="evenodd"/>
            </svg>
            ${pipeline.triggerTime}
          </div>
          <div class="pipeline-days">
            ${activeDaysChips}
          </div>
        </div>
      </div>
      <div class="pipeline-actions">
        <button class="action-btn run" id="run-${pipeline.id}">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M10.804 8 5 4.633v6.734L10.804 8zm.792-.696a.802.802 0 0 1 0 1.392l-6.363 3.692C4.713 12.69 4 12.345 4 11.692V4.308c0-.653.713-.998 1.233-.696l6.363 3.692z"/>
          </svg>
          ${pipeline.executionType === 'local' ? 'Run Local' : 'Run Pipeline'}
        </button>
        <button class="action-btn update" id="update-${pipeline.id}">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12.146.146a.5.5 0 01.708 0l3 3a.5.5 0 010 .708l-10 10a.5.5 0 01-.168.11l-5 2a.5.5 0 01-.65-.65l2-5a.5.5 0 01.11-.168l10-10zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.293l6.293-6.293z"/>
          </svg>
          Update
        </button>
        <button class="action-btn delete" id="delete-${pipeline.id}">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M5.5 5.5A.5.5 0 016 6v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm2.5 0a.5.5 0 01.5.5v6a.5.5 0 01-1 0V6a.5.5 0 01.5-.5zm3 .5a.5.5 0 00-1 0v6a.5.5 0 001 0V6z"/>
            <path fill-rule="evenodd" d="M14.5 3a1 1 0 01-1 1H13v9a2 2 0 01-2 2H5a2 2 0 01-2-2V4h-.5a1 1 0 01-1-1V2a1 1 0 011-1H6a1 1 0 011-1h2a1 1 0 011 1h3.5a1 1 0 011 1v1zM4.118 4L4 4.059V13a1 1 0 001 1h6a1 1 0 001-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z" clip-rule="evenodd"/>
          </svg>
          Delete
        </button>
      </div>
    </div>
  `;
}

function populateForm(pipeline) {
  document.getElementById("pipelineName").value = pipeline.name;
  document.getElementById("executionType").value = pipeline.executionType || "gitlab";
  document.getElementById("gitlabUrl").value = pipeline.gitlabUrl || "";
  document.getElementById("triggerToken").value = pipeline.triggerToken
    ? "********"
    : "";
  document.getElementById("branchRef").value = pipeline.branchRef || "main";
  document.getElementById("localProjectDir").value = pipeline.localProjectDir || "";
  document.getElementById("localTestType").value = pipeline.localTestType || "test";
  document.getElementById("localTestPath").value = pipeline.localTestPath || "";

  // Show/hide fields based on execution type
  const type = pipeline.executionType || "gitlab";
  document.getElementById("gitlabUrlGroup").style.display = type === "local" ? "none" : "block";
  document.getElementById("triggerTokenGroup").style.display = type === "local" ? "none" : "block";
  document.getElementById("branchRefGroup").style.display = type === "local" ? "none" : "block";
  document.getElementById("localProjectDirGroup").style.display = type === "local" ? "block" : "none";
  document.getElementById("localTestTypeGroup").style.display = type === "local" ? "block" : "none";
  document.getElementById("localTestPathGroup").style.display = type === "local" ? "block" : "none";

  // Parse time with seconds
  var timeParts = pipeline.triggerTime.split(":");
  document.getElementById("triggerHours").value = timeParts[0] || "09";
  document.getElementById("triggerMinutes").value = timeParts[1] || "00";
  document.getElementById("triggerSeconds").value = timeParts[2] || "00";

  document.getElementById("isActive").checked = pipeline.isActive;

  document.querySelectorAll(".day-btn").forEach(function (btn) {
    var day = parseInt(btn.dataset.day);
    if (pipeline.activeDays.includes(day)) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Load variables
  pipelineVariables = pipeline.variables || [];
  renderVariables();
}

function clearForm() {
  document.getElementById("pipelineName").value = "";
  document.getElementById("executionType").value = "gitlab";
  document.getElementById("gitlabUrl").value = "";
  document.getElementById("triggerToken").value = "";
  document.getElementById("branchRef").value = "main";
  document.getElementById("localProjectDir").value = "";
  document.getElementById("localTestType").value = "test";
  document.getElementById("localTestPath").value = "";
  document.getElementById("triggerHours").value = "09";
  document.getElementById("triggerMinutes").value = "00";
  document.getElementById("triggerSeconds").value = "00";
  document.getElementById("isActive").checked = true;
  
  // Show GitLab fields by default
  document.getElementById("gitlabUrlGroup").style.display = "block";
  document.getElementById("triggerTokenGroup").style.display = "block";
  document.getElementById("branchRefGroup").style.display = "block";
  document.getElementById("localProjectDirGroup").style.display = "none";
  document.getElementById("localTestTypeGroup").style.display = "none";
  document.getElementById("localTestPathGroup").style.display = "none";

  document.querySelectorAll(".day-btn").forEach(function (btn) {
    var day = parseInt(btn.dataset.day);
    if (day >= 1 && day <= 5) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  // Clear variables
  clearVariables();
}

// Variable Management Functions
let pipelineVariables = [];

async function addVariable() {
  const keyInput = document.getElementById("variableKey");
  const valueInput = document.getElementById("variableValue");
  const key = keyInput.value.trim().toUpperCase();
  const value = valueInput.value.trim();

  if (!key || !value) {
    showStatus("Please enter both key and value", "error");
    return;
  }

  // Encrypt the value before storing
  const encryptedValue = await encryptValue(value);

  // Check if variable already exists
  const existingIndex = pipelineVariables.findIndex((v) => v.key === key);
  if (existingIndex !== -1) {
    // Update existing variable
    pipelineVariables[existingIndex].encryptedValue = encryptedValue;
  } else {
    // Add new variable
    pipelineVariables.push({ key, encryptedValue });
  }

  // Clear inputs
  keyInput.value = "";
  valueInput.value = "";
  keyInput.focus();

  // Re-render variables
  renderVariables();
}

function removeVariable(key) {
  pipelineVariables = pipelineVariables.filter((v) => v.key !== key);
  renderVariables();
}

function renderVariables() {
  const container = document.getElementById("variablesList");

  if (pipelineVariables.length === 0) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = pipelineVariables
    .map(
      (variable, index) => `
    <div class="variable-item">
      <div class="variable-content">
        <span class="variable-key">${escapeHtml(variable.key)}</span>
        <span class="variable-equals">=</span>
        <span class="variable-value">${maskValue(variable.encryptedValue || "")}</span>
      </div>
      <div class="variable-actions">
        <button class="variable-edit" data-variable-key="${escapeHtml(variable.key)}" type="button" title="Edit (value will be cleared)">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M12.146.146a.5.5 0 01.708 0l3 3a.5.5 0 010 .708l-10 10a.5.5 0 01-.168.11l-5 2a.5.5 0 01-.65-.65l2-5a.5.5 0 01.11-.168l10-10zM11.207 2.5L13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 01.5.5v.5h.5a.5.5 0 01.5.5v.5h.293l6.293-6.293z"/>
          </svg>
        </button>
        <button class="variable-remove" data-variable-key="${escapeHtml(variable.key)}" type="button" title="Delete">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8 2.146 2.854Z"/>
          </svg>
        </button>
      </div>
    </div>
  `,
    )
    .join("");

  // Add event listeners to edit buttons
  container.querySelectorAll(".variable-edit").forEach((button) => {
    button.addEventListener("click", function () {
      const key = this.getAttribute("data-variable-key");
      editVariable(key);
    });
  });

  // Add event listeners to remove buttons
  container.querySelectorAll(".variable-remove").forEach((button) => {
    button.addEventListener("click", function () {
      const key = this.getAttribute("data-variable-key");
      removeVariable(key);
    });
  });
}

function clearVariables() {
  pipelineVariables = [];
  renderVariables();
}

function editVariable(key) {
  // Populate only the key field - user must re-enter the value for security
  document.getElementById("variableKey").value = key;
  document.getElementById("variableValue").value = "";

  // Focus on the value field for entering new value
  document.getElementById("variableValue").focus();
}

async function savePipeline() {
  var name = document.getElementById("pipelineName").value.trim();
  var executionType = document.getElementById("executionType").value;
  var gitlabUrl = document.getElementById("gitlabUrl").value.trim();
  var triggerToken = document.getElementById("triggerToken").value.trim();
  var branchRef = document.getElementById("branchRef").value.trim() || "main";
  var localProjectDir = document.getElementById("localProjectDir").value.trim();
  var localTestType = document.getElementById("localTestType").value;
  var localTestPath = document.getElementById("localTestPath").value.trim();

  // Get time with seconds
  var hours = document.getElementById("triggerHours").value.padStart(2, "0");
  var minutes = document
    .getElementById("triggerMinutes")
    .value.padStart(2, "0");
  var seconds = document
    .getElementById("triggerSeconds")
    .value.padStart(2, "0");
  var triggerTime = hours + ":" + minutes + ":" + seconds;

  var isActive = document.getElementById("isActive").checked;
  var activeDays = Array.from(document.querySelectorAll(".day-btn.active")).map(
    function (btn) {
      return parseInt(btn.dataset.day);
    },
  );

  // Validation based on execution type
  if (!name) {
    showStatus("Please enter an automation name", "error");
    return;
  }
  
  if (executionType === "gitlab" && (!gitlabUrl || !triggerToken)) {
    showStatus("Please fill in GitLab URL and trigger token", "error");
    return;
  }
  
  if (executionType === "local" && (!localProjectDir || !localTestPath)) {
    showStatus("Please fill in project directory and test path", "error");
    return;
  }

  chrome.storage.local.get({ pipelines: [] }, async function (data) {
    var pipelines = data.pipelines;
    let finalTriggerToken = triggerToken;

    // If it's an edit and the token is still masked, use the old token
    if (editingPipelineId && triggerToken === "********") {
      const oldPipeline = pipelines.find((p) => p.id === editingPipelineId);
      if (oldPipeline) {
        finalTriggerToken = oldPipeline.triggerToken;
      }
    } else if (triggerToken) {
      // If it's a new or changed token, encrypt it
      finalTriggerToken = await encryptValue(triggerToken);
    }

    var pipeline = {
      id: editingPipelineId || Date.now(),
      name: name,
      executionType: executionType,
      gitlabUrl: gitlabUrl,
      triggerToken: finalTriggerToken,
      branchRef: branchRef,
      localProjectDir: localProjectDir,
      localTestType: localTestType,
      localTestPath: localTestPath,
      triggerTime: triggerTime,
      activeDays: activeDays,
      isActive: isActive,
      variables: pipelineVariables,
    };

    if (editingPipelineId) {
      pipelines = pipelines.map(function (p) {
        return p.id === editingPipelineId ? pipeline : p;
      });
    } else {
      pipelines.push(pipeline);
    }

    chrome.storage.local.set({ pipelines: pipelines }, function () {
      chrome.runtime.sendMessage({
        action: "setupAlarms",
        pipelines: pipelines,
      });
      showStatus("✓ Automation saved successfully!", "success");
      setTimeout(function () {
        showMainView();
        loadPipelines();
      }, 1000);
    });
  });
}

function runPipelineNow(id) {
  chrome.runtime.sendMessage({ action: "triggerNow", pipelineId: id });
  showStatus("✓ Test execution started!", "success");
}

async function deletePipeline(id) {
  const confirmed = await showConfirm('Delete Automation', 'Are you sure you want to delete this automation?');
  if (!confirmed) {
    return;
  }

  chrome.storage.local.get({ pipelines: [] }, (data) => {
    const pipelines = data.pipelines.filter((p) => p.id !== id);
    chrome.storage.local.set({ pipelines }, () => {
      chrome.runtime.sendMessage({ action: "setupAlarms", pipelines });
      loadPipelines();
    });
  });
}

async function testPipeline() {
  const gitlabUrl = document.getElementById("gitlabUrl").value.trim();
  const triggerToken = document.getElementById("triggerToken").value.trim();
  const branchRef = document.getElementById("branchRef").value.trim() || "main";

  if (!gitlabUrl || !triggerToken) {
    showStatus("Please enter GitLab URL and Token first", "error");
    return;
  }

  // Get the token and variables ready
  let finalTriggerToken = triggerToken;

  if (editingPipelineId && triggerToken === "********") {
    // Fetch from storage if masked
    const data = await new Promise((resolve) =>
      chrome.storage.local.get({ pipelines: [] }, resolve),
    );
    const oldPipeline = data.pipelines.find((p) => p.id === editingPipelineId);
    if (oldPipeline) {
      finalTriggerToken = oldPipeline.triggerToken;
    }
  } else {
    // New or changed token, encrypt it
    finalTriggerToken = await encryptValue(triggerToken);
  }

  chrome.runtime.sendMessage({
    action: "testPipeline",
    pipeline: {
      gitlabUrl,
      triggerToken: finalTriggerToken,
      branchRef,
      variables: pipelineVariables,
    },
  });
  showStatus("Test notification sent!", "success");
}

function toggleTokenVisibility() {
  const tokenInput = document.getElementById("triggerToken");
  const eyeIcon = document.querySelector(".eye-icon");

  if (tokenInput.type === "password") {
    tokenInput.type = "text";
    eyeIcon.innerHTML =
      '<path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/>';
  } else {
    tokenInput.type = "password";
    eyeIcon.innerHTML =
      '<path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>';
  }
}

function updatePipelineCount(count) {
  document.getElementById("pipelineCount").textContent =
    `${count} automation${count !== 1 ? "s" : ""} scheduled`;
}

function showStatus(message, type) {
  const statusEl = document.getElementById("statusMessage");
  statusEl.textContent = message;
  statusEl.className = `status-message ${type} show`;

  setTimeout(() => {
    statusEl.classList.remove("show");
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Pagination state
let currentResultsPage = 1;
const resultsPerPage = 5;

// Load and display execution results
function loadResults(page = 1) {
  currentResultsPage = page;
  
  chrome.storage.local.get({ executionHistory: [] }, (data) => {
    const resultsList = document.getElementById('resultsList');
    const emptyState = document.getElementById('resultsEmptyState');
    let history = data.executionHistory || [];

    console.log(`📊 Loading ${history.length} executions from storage`);

    // Clean up stale "running" entries (older than 30 minutes)
    const thirtyMinutesAgo = Date.now() - (30 * 60 * 1000);
    history = history.map(entry => {
      if (entry.status === 'running' && entry.timestamp < thirtyMinutesAgo) {
        console.log(`⚠️ Marking stale execution as failed: ${entry.pipelineName}`);
        return { ...entry, status: 'failed' };
      }
      return entry;
    });

    // Save cleaned history
    chrome.storage.local.set({ executionHistory: history });

    if (history.length === 0) {
      resultsList.style.display = 'none';
      emptyState.style.display = 'flex';
      document.getElementById('resultsPagination').style.display = 'none';
      return;
    }

    resultsList.style.display = 'flex';
    emptyState.style.display = 'none';

    // Sort by timestamp descending (newest first)
    history.sort((a, b) => b.timestamp - a.timestamp);
    
    // Pagination
    const totalPages = Math.ceil(history.length / resultsPerPage);
    const startIndex = (page - 1) * resultsPerPage;
    const endIndex = startIndex + resultsPerPage;
    const paginatedHistory = history.slice(startIndex, endIndex);

    resultsList.innerHTML = paginatedHistory.map(result => {
      const date = new Date(result.timestamp);
      const statusClass = result.status === 'success' ? 'success' : 
                         result.status === 'failed' ? 'failed' : 'running';
      const statusText = result.status === 'success' ? '✓ Success' :
                        result.status === 'failed' ? '✗ Failed' : '⟳ Running';

      return `
        <div class="result-card" data-result-id="${result.id}">
          <div class="result-header">
            <div class="result-title">${escapeHtml(result.pipelineName)}</div>
            <span class="result-status ${statusClass}">${statusText}</span>
          </div>
          
          <div class="result-meta">
            <div>📅 ${date.toLocaleDateString()} ${date.toLocaleTimeString()}</div>
            <div>🔗 ${result.executionType === 'local' ? 'Local' : 'GitLab'} #${result.pipelineId}</div>
          </div>

          ${result.results ? `
            <div class="result-data">
              <div class="result-data-item">
                <span class="result-data-label">Project</span>
                <span class="result-data-value">${escapeHtml(result.results.CAPTURED_PROJECT_NAME || 'N/A')}</span>
              </div>
              <div class="result-data-item">
                <span class="result-data-label">Hours</span>
                <span class="result-data-value">${escapeHtml(result.results.CAPTURED_HOURS || 'N/A')}</span>
              </div>
              <div class="result-data-item">
                <span class="result-data-label">Status</span>
                <span class="result-data-value">${escapeHtml(result.results.CAPTURED_STATUS || 'N/A')}</span>
              </div>
            </div>
          ` : ''}
          
          <div class="result-actions">
            <button class="btn-view-details" data-result-id="${result.id}">
              View Details
            </button>
            ${result.status === 'running' ? `
              <button class="btn-stop-execution" 
                      data-result-id="${result.id}" 
                      data-execution-type="${result.executionType}" 
                      data-pipeline-id="${result.pipelineId}"
                      data-project-id="${result.projectId || ''}">
                ⏹ Stop
              </button>
            ` : ''}
            <button class="btn-delete-result" data-result-id="${result.id}">
              🗑️ Delete
            </button>
            ${result.pipelineUrl ? `
              <a href="${result.pipelineUrl}" target="_blank" class="result-link">
                View in GitLab →
              </a>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
    
    // Render pagination
    const paginationEl = document.getElementById('resultsPagination');
    if (totalPages > 1) {
      paginationEl.style.display = 'flex';
      paginationEl.innerHTML = `
        <button class="pagination-btn" ${page === 1 ? 'disabled' : ''} data-page="${page - 1}">
          ← Previous
        </button>
        <span class="pagination-info">Page ${page} of ${totalPages}</span>
        <button class="pagination-btn" ${page === totalPages ? 'disabled' : ''} data-page="${page + 1}">
          Next →
        </button>
      `;
      
      // Add pagination click handlers
      paginationEl.querySelectorAll('.pagination-btn').forEach(btn => {
        btn.addEventListener('click', function() {
          if (!this.disabled) {
            loadResults(parseInt(this.dataset.page));
          }
        });
      });
    } else {
      paginationEl.style.display = 'none';
    }
    
    // Add click handlers for view details buttons
    document.querySelectorAll('.btn-view-details').forEach(btn => {
      btn.addEventListener('click', function() {
        const resultId = parseInt(this.dataset.resultId);
        showResultDetails(resultId, history);
      });
    });
    
    // Add click handlers for stop buttons
    document.querySelectorAll('.btn-stop-execution').forEach(btn => {
      btn.addEventListener('click', async function() {
        const resultId = parseInt(this.dataset.resultId);
        const executionType = this.dataset.executionType;
        const pipelineId = this.dataset.pipelineId;
        await stopExecution(resultId, executionType, pipelineId);
      });
    });
    
    // Add click handlers for delete buttons
    document.querySelectorAll('.btn-delete-result').forEach(btn => {
      btn.addEventListener('click', async function() {
        const resultId = parseInt(this.dataset.resultId);
        await deleteResult(resultId);
      });
    });
  });
}

async function deleteResult(resultId) {
  const confirmed = await showConfirm('Delete Result', 'Are you sure you want to delete this execution result?');
  if (!confirmed) return;
  
  chrome.storage.local.get({ executionHistory: [] }, (data) => {
    const history = data.executionHistory.filter(r => r.id !== resultId);
    chrome.storage.local.set({ executionHistory: history }, () => {
      loadResults(currentResultsPage);
      showStatus('✓ Result deleted', 'success');
    });
  });
}

async function stopExecution(resultId, executionType, pipelineId) {
  const confirmed = await showConfirm('Stop Execution', 'Are you sure you want to stop this execution?');
  if (!confirmed) return;
  
  console.log('Stop execution called:', { resultId, executionType, pipelineId });
  
  try {
    if (executionType === 'local') {
      // Check server is running
      try {
        await fetch('http://localhost:5000/health');
      } catch (e) {
        showStatus('Local server not running', 'error');
        return;
      }
      
      console.log(`Sending stop request to: http://localhost:5000/stop/${pipelineId}`);
      
      // Stop local execution
      const response = await fetch(`http://localhost:5000/stop/${pipelineId}`, {
        method: 'POST'
      });
      
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('Stop response:', data);
      
      if (!response.ok) {
        throw new Error(data.error || 'Failed to stop execution');
      }
      
      showStatus('✓ Execution stopped', 'success');
    } else {
      // Stop GitLab pipeline
      chrome.storage.local.get({ executionHistory: [] }, async (data) => {
        try {
          const result = data.executionHistory?.find(r => r.id === resultId);
          if (!result || !result.projectId) {
            showStatus('Pipeline info not found', 'error');
            return;
          }
          
          console.log('Found result:', result);
          
          // Find automation to get token
          chrome.storage.local.get({ pipelines: [] }, async (pipelineData) => {
            try {
              const automation = pipelineData.pipelines.find(p => p.name === result.pipelineName);
              if (!automation) {
                showStatus('Automation not found', 'error');
                return;
              }
              
              console.log('Found automation:', automation.name);
              
              const gitlabUrl = automation.gitlabUrl.replace(/\/$/, '');
              const token = await decryptValue(automation.triggerToken);
              
              const cancelUrl = `${gitlabUrl}/api/v4/projects/${encodeURIComponent(result.projectId)}/pipelines/${pipelineId}/cancel`;
              console.log('Cancelling pipeline:', cancelUrl);
              
              const response = await fetch(cancelUrl, {
                method: 'POST',
                headers: {
                  'PRIVATE-TOKEN': token
                }
              });
              
              console.log('Cancel response status:', response.status);
              
              if (!response.ok) {
                const errorText = await response.text();
                console.error('Cancel failed:', errorText);
                throw new Error(`Failed to cancel pipeline: ${response.status} ${response.statusText}`);
              }
              
              showStatus('✓ Pipeline cancelled', 'success');
              setTimeout(loadResults, 1000);
            } catch (error) {
              console.error('Error in pipeline cancel:', error);
              showStatus(`Failed: ${error.message}`, 'error');
            }
          });
        } catch (error) {
          console.error('Error finding result:', error);
          showStatus(`Failed: ${error.message}`, 'error');
        }
      });
      return;
    }
    
    // Refresh results for local
    setTimeout(loadResults, 1000);
  } catch (error) {
    console.error('Error stopping execution:', error);
    showStatus(`Failed: ${error.message}`, 'error');
  }
}

async function showResultDetails(resultId, history) {
  const result = history.find(r => r.id === resultId);
  if (!result) return;
  
  // Switch to details view
  document.getElementById('mainView').classList.remove('active');
  document.getElementById('detailsView').classList.add('active');
  
  // Get the automation to show variables
  chrome.storage.local.get({ pipelines: [] }, async (data) => {
    const pipeline = data.pipelines.find(p => p.name === result.pipelineName);
    
    // Execution Info
    const executionInfo = document.getElementById('executionInfo');
    executionInfo.innerHTML = `
      <div class="info-row">
        <span class="info-label">Name</span>
        <span class="info-value">${escapeHtml(result.pipelineName)}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Type</span>
        <span class="info-value">${result.executionType === 'local' ? 'Local' : 'GitLab'}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Status</span>
        <span class="info-value copyable" data-copy="${result.status}">${result.status}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Time</span>
        <span class="info-value copyable" data-copy="${new Date(result.timestamp).toLocaleString()}">${new Date(result.timestamp).toLocaleString()}</span>
      </div>
      ${result.pipelineUrl ? `
        <div class="info-row">
          <span class="info-label">GitLab URL</span>
          <span class="info-value copyable" data-copy="${result.pipelineUrl}"><a href="${result.pipelineUrl}" target="_blank">View Pipeline</a></span>
        </div>
      ` : ''}
    `;
    
    // Variables Info
    const variablesInfo = document.getElementById('variablesInfo');
    if (pipeline && pipeline.variables && pipeline.variables.length > 0) {
      let varsHTML = '';
      for (const v of pipeline.variables) {
        const value = await decryptValue(v.encryptedValue);
        varsHTML += `
          <div class="info-row">
            <span class="info-label copyable" data-copy="${escapeHtml(v.key)}">${escapeHtml(v.key)}</span>
            <span class="info-value">
              <span class="secret-value" data-secret="${escapeHtml(value)}">${maskValue(value)}</span>
              <button class="btn-reveal" data-key="${escapeHtml(v.key)}">👁️</button>
            </span>
          </div>
        `;
      }
      variablesInfo.innerHTML = varsHTML;
    } else {
      variablesInfo.innerHTML = '<p style="color: rgba(255,255,255,0.5);">No variables configured</p>';
    }
    
    // Results Info
    const resultsInfo = document.getElementById('resultsInfo');
    console.log('Result object:', result);
    console.log('Result.results:', result.results);
    
    if (result.results) {
      resultsInfo.innerHTML = `
        <div class="info-row">
          <span class="info-label">Project</span>
          <span class="info-value copyable" data-copy="${escapeHtml(result.results.CAPTURED_PROJECT_NAME || 'N/A')}">${escapeHtml(result.results.CAPTURED_PROJECT_NAME || 'N/A')}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Hours</span>
          <span class="info-value copyable" data-copy="${escapeHtml(result.results.CAPTURED_HOURS || 'N/A')}">${escapeHtml(result.results.CAPTURED_HOURS || 'N/A')}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Status</span>
          <span class="info-value copyable" data-copy="${escapeHtml(result.results.CAPTURED_STATUS || 'N/A')}">${escapeHtml(result.results.CAPTURED_STATUS || 'N/A')}</span>
        </div>
      `;
    } else {
      resultsInfo.innerHTML = '<p style="color: rgba(255,255,255,0.5);">No results captured</p>';
    }
    
    // Load logs and media for local executions
    if (result.executionType === 'local' && result.pipelineId) {
      loadExecutionLogs(result.pipelineId);
      loadExecutionMedia(result.pipelineId);
    } else {
      document.getElementById('logsSection').style.display = 'none';
      document.getElementById('screenshotsSection').style.display = 'none';
      document.getElementById('videosSection').style.display = 'none';
    }
    
    // Add copy to clipboard functionality
    document.querySelectorAll('.copyable').forEach(el => {
      el.style.cursor = 'pointer';
      el.title = 'Click to copy';
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        const text = this.dataset.copy;
        navigator.clipboard.writeText(text).then(() => {
          const original = this.innerHTML;
          this.innerHTML = '✓ Copied!';
          this.style.color = '#4ade80';
          setTimeout(() => {
            this.innerHTML = original;
            this.style.color = '';
          }, 1500);
        });
      });
    });
    
    // Add reveal/hide functionality for secrets
    document.querySelectorAll('.btn-reveal').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        const secretSpan = this.previousElementSibling;
        const isRevealed = secretSpan.classList.contains('revealed');
        
        if (isRevealed) {
          // Hide
          secretSpan.textContent = maskValue(secretSpan.dataset.secret);
          secretSpan.classList.remove('revealed');
          this.textContent = '👁️';
        } else {
          // Reveal
          secretSpan.textContent = secretSpan.dataset.secret;
          secretSpan.classList.add('revealed');
          this.textContent = '🙈';
        }
      });
    });
    
    // Make secret values copyable when revealed
    document.querySelectorAll('.secret-value').forEach(el => {
      el.style.cursor = 'pointer';
      el.title = 'Click to copy';
      el.addEventListener('click', function(e) {
        e.stopPropagation();
        const text = this.dataset.secret;
        navigator.clipboard.writeText(text).then(() => {
          const original = this.textContent;
          this.textContent = '✓ Copied!';
          this.style.color = '#4ade80';
          setTimeout(() => {
            this.textContent = original;
            this.style.color = '';
          }, 1500);
        });
      });
    });
  });
}

async function loadExecutionLogs(executionId) {
  const logsSection = document.getElementById('logsSection');
  const logsContent = document.getElementById('logsContent');
  
  try {
    const response = await fetch(`http://localhost:5000/logs/${executionId}`);
    
    if (!response.ok) {
      logsSection.style.display = 'none';
      return;
    }
    
    const logs = await response.json();
    
    let logText = `Return Code: ${logs.return_code}\n\n`;
    logText += `STDOUT:\n${'='.repeat(60)}\n${logs.stdout}\n\n`;
    
    if (logs.stderr) {
      logText += `STDERR:\n${'='.repeat(60)}\n${logs.stderr}`;
    }
    
    logsContent.textContent = logText;
    logsSection.style.display = 'block';
  } catch (error) {
    console.error('Failed to load logs:', error);
    logsSection.style.display = 'none';
  }
}

async function loadExecutionMedia(executionId) {
  const screenshotsSection = document.getElementById('screenshotsSection');
  const videosSection = document.getElementById('videosSection');
  const screenshotsContainer = document.getElementById('screenshotsContainer');
  const videosContainer = document.getElementById('videosContainer');
  
  // Show sections with loading state
  screenshotsSection.style.display = 'block';
  videosSection.style.display = 'block';
  screenshotsContainer.innerHTML = '<p style="color: var(--primary);">⏳ Loading screenshots...</p>';
  videosContainer.innerHTML = '<p style="color: var(--primary);">⏳ Loading videos...</p>';
  
  // Wait 10 seconds for files to be generated
  await new Promise(resolve => setTimeout(resolve, 10000));
  
  try {
    const response = await fetch(`http://localhost:5000/media/${executionId}`);
    
    if (!response.ok) {
      screenshotsContainer.innerHTML = '<p style="color: var(--primary);">❌ Could not load media</p>';
      videosContainer.innerHTML = '<p style="color: var(--primary);">❌ Could not load media</p>';
      return;
    }
    
    const media = await response.json();
    
    // Display screenshots
    if (media.screenshots && media.screenshots.length > 0) {
      screenshotsContainer.innerHTML = media.screenshots.map(file => `
        <div class="media-item">
          <img src="http://localhost:5000/media/${executionId}/file/${file}" alt="${file}">
          <div class="media-name">${file}</div>
        </div>
      `).join('');
    } else {
      screenshotsContainer.innerHTML = '<p style="color: var(--primary);">📷 No screenshots found</p>';
    }
    
    // Display videos
    if (media.videos && media.videos.length > 0) {
      videosContainer.innerHTML = media.videos.map(file => `
        <div class="media-item">
          <video controls controlsList="nodownload" preload="metadata">
            <source src="http://localhost:5000/media/${executionId}/file/${file}" type="video/webm">
            <source src="http://localhost:5000/media/${executionId}/file/${file}" type="video/mp4">
          </video>
          <div class="media-name">${file}</div>
        </div>
      `).join('');
    } else {
      videosContainer.innerHTML = '<p style="color: var(--primary);">🎥 No videos found</p>';
    }
  } catch (error) {
    console.error('Failed to load media:', error);
    screenshotsContainer.innerHTML = '<p style="color: var(--primary);">❌ Error loading screenshots</p>';
    videosContainer.innerHTML = '<p style="color: var(--primary);">❌ Error loading videos</p>';
  }
}

// Back button from details view
document.getElementById('detailsBackBtn').addEventListener('click', function() {
  document.getElementById('detailsView').classList.remove('active');
  document.getElementById('mainView').classList.add('active');
});
