// Encryption utilities - must match popup.js
const ENCRYPTION_KEY_NAME = "pipeline_encryption_key";

async function getOrCreateEncryptionKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(ENCRYPTION_KEY_NAME, async (data) => {
      if (data[ENCRYPTION_KEY_NAME]) {
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
        const key = await crypto.subtle.generateKey(
          { name: "AES-GCM", length: 256 },
          true,
          ["encrypt", "decrypt"],
        );
        const exportedKey = await crypto.subtle.exportKey("jwk", key);
        chrome.storage.local.set({ [ENCRYPTION_KEY_NAME]: exportedKey });
        resolve(key);
      }
    });
  });
}

async function decryptValue(encryptedValue) {
  if (!encryptedValue || typeof encryptedValue !== "string")
    return encryptedValue;

  // Quick check: if it doesn't look like base64 or is too short, it's probably plain text
  if (encryptedValue.length < 16) return encryptedValue;

  try {
    const key = await getOrCreateEncryptionKey();

    // Attempt to decode from base64
    let combined;
    try {
      combined = Uint8Array.from(atob(encryptedValue), (c) => c.charCodeAt(0));
    } catch (e) {
      // Not a valid base64 string, likely an old plain-text token
      return encryptedValue;
    }

    if (combined.length < 13) return encryptedValue; // IV(12) + at least 1 byte of data

    const iv = combined.slice(0, 12);
    const encrypted = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      encrypted,
    );

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    // If decryption fails, it's likely an old plain-text value
    console.warn("Decryption failed, assuming plain text:", error);
    return encryptedValue;
  }
}

// IMPORTANT: Check and recreate alarms on startup
chrome.runtime.onStartup.addListener(() => {
  console.log("Extension started - setting up alarms");
  setupAllAlarms();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log("Extension installed/updated - setting up alarms");
  setupAllAlarms();
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "setupAlarms") {
    console.log("Received setupAlarms message");
    setupAllAlarms();
  } else if (request.action === "testPipeline") {
    // Make sure the test pipeline has an ID
    const testPipeline = {
      id: request.pipeline.id || Date.now(),
      name: request.pipeline.name || "Test Pipeline",
      gitlabUrl: request.pipeline.gitlabUrl,
      triggerToken: request.pipeline.triggerToken,
      branchRef: request.pipeline.branchRef || "main",
    };
    console.log("Test pipeline with ID:", testPipeline);
    showConfirmation(testPipeline);
  } else if (request.action === "confirmPipeline") {
    handlePipelineConfirmation(request.pipelineId, request.response);
    // Don't send response - just handle it
  } else if (request.action === "triggerNow") {
    chrome.storage.local.get({ pipelines: [] }, (data) => {
      const pipeline = data.pipelines.find((p) => p.id === request.pipelineId);
      if (pipeline) {
        if (pipeline.executionType === "local") {
          triggerLocalExecution(pipeline);
        } else {
          triggerPipeline(pipeline);
        }
      }
    });
  } else if (request.action === "triggerAlternate") {
    chrome.storage.local.get({ pipelines: [] }, (data) => {
      const pipeline = data.pipelines.find((p) => p.id === request.pipelineId);
      if (pipeline) {
        // Run with opposite execution type
        if (pipeline.executionType === "local") {
          // Local automation trying to run on GitLab
          if (!pipeline.gitlabUrl || !pipeline.triggerToken) {
            chrome.notifications.create({
              type: "basic",
              iconUrl: "icons/icon128.png",
              title: `${pipeline.name} - Error ✗`,
              message: 'GitLab URL and token not configured. Edit automation to add them.',
              priority: 2,
            });
            return;
          }
          triggerPipeline(pipeline);
        } else {
          // GitLab automation trying to run locally
          triggerLocalExecution(pipeline);
        }
      }
    });
  }
  // Note: We don't return true because we don't need async response
});

function setupAllAlarms() {
  chrome.storage.local.get({ pipelines: [] }, (data) => {
    console.log("Setting up alarms for pipelines:", data.pipelines);

    chrome.alarms.clearAll(() => {
      console.log("Cleared all previous alarms");

      const activePipelines = data.pipelines.filter((p) => p.isActive);
      console.log("Active pipelines:", activePipelines.length);

      activePipelines.forEach((pipeline) => {
        setupAlarmForPipeline(pipeline);
      });

      chrome.alarms.getAll((alarms) => {
        console.log("Current alarms after setup:", alarms);
      });
    });
  });
}

function setupAlarmForPipeline(pipeline) {
  var timeParts = pipeline.triggerTime.split(":");
  var hours = parseInt(timeParts[0]);
  var minutes = parseInt(timeParts[1]);
  var seconds = parseInt(timeParts[2]) || 0; // Add seconds support

  var now = new Date();
  var scheduled = new Date();
  scheduled.setHours(hours, minutes, seconds, 0);

  if (scheduled <= now) {
    scheduled.setDate(scheduled.getDate() + 1);
  }

  var delayInMinutes = Math.max(0.1, (scheduled - now) / 60000);

  console.log("Setting alarm for " + pipeline.name + ":", {
    id: pipeline.id,
    triggerTime: pipeline.triggerTime,
    scheduledFor: scheduled.toString(),
    delayInMinutes: delayInMinutes,
    willFireAt: new Date(now.getTime() + delayInMinutes * 60000).toString(),
  });

  chrome.alarms.create(
    "pipeline-" + pipeline.id,
    {
      delayInMinutes: delayInMinutes,
      periodInMinutes: 24 * 60,
    },
    function () {
      if (chrome.runtime.lastError) {
        console.error(
          "Error creating alarm:",
          chrome.runtime.lastError.message,
        );
      } else {
        console.log("Alarm created for " + pipeline.name);
      }
    },
  );
}

chrome.alarms.onAlarm.addListener((alarm) => {
  console.log("Alarm fired:", alarm.name, "at", new Date().toString());

  if (alarm.name.startsWith("pipeline-")) {
    const pipelineId = parseInt(alarm.name.replace("pipeline-", ""));
    checkAndShowConfirmation(pipelineId);
  } else if (alarm.name.startsWith("snooze-")) {
    const pipelineId = parseInt(alarm.name.replace("snooze-", ""));
    chrome.storage.local.get({ pipelines: [] }, (data) => {
      const pipeline = data.pipelines.find((p) => p.id === pipelineId);
      if (pipeline) {
        console.log("Snooze alarm fired for:", pipeline.name);
        showConfirmation(pipeline);
      }
    });
  }
});

function checkAndShowConfirmation(pipelineId) {
  chrome.storage.local.get({ pipelines: [] }, (data) => {
    const pipeline = data.pipelines.find((p) => p.id === pipelineId);

    if (!pipeline) {
      console.error("Pipeline not found:", pipelineId);
      return;
    }

    if (!pipeline.isActive) {
      console.log("Pipeline is inactive, skipping:", pipeline.name);
      return;
    }

    const today = new Date().getDay();
    console.log(
      "Checking pipeline:",
      pipeline.name,
      "Today:",
      today,
      "Active days:",
      pipeline.activeDays,
    );

    if (pipeline.activeDays.includes(today)) {
      console.log(
        "✓ Today is active day, showing confirmation for:",
        pipeline.name,
      );
      showConfirmation(pipeline);
    } else {
      console.log("✗ Today is not active day for:", pipeline.name);
    }
  });
}

function showConfirmation(pipeline) {
  console.log("Showing confirmation modal for:", pipeline.name);

  if (!pipeline || !pipeline.id) {
    console.error("Pipeline missing ID:", pipeline);
    return;
  }

  // Get the active tab
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    if (!tabs || tabs.length === 0) {
      console.log("No active tab, falling back to popup window");
      showPopupFallback(pipeline);
      return;
    }

    var activeTab = tabs[0];
    var tabUrl = activeTab.url || "";

    // Check if URL is restricted (chrome://, edge://, about:, etc.)
    var isRestrictedUrl =
      tabUrl.startsWith("chrome://") ||
      tabUrl.startsWith("chrome-extension://") ||
      tabUrl.startsWith("edge://") ||
      tabUrl.startsWith("about:") ||
      tabUrl.startsWith("file://") ||
      tabUrl === "" ||
      tabUrl.startsWith("view-source:");

    if (isRestrictedUrl) {
      console.log("Restricted URL detected:", tabUrl, "- using popup window");
      showPopupFallback(pipeline);
      return;
    }

    console.log("Attempting modal on tab:", activeTab.id, "URL:", tabUrl);

    // Try to send message to content script
    chrome.tabs.sendMessage(
      activeTab.id,
      {
        action: "showConfirmation",
        pipeline: pipeline,
      },
      function (response) {
        if (chrome.runtime.lastError) {
          console.log("Content script not ready, injecting...");

          // Inject content script
          chrome.scripting
            .executeScript({
              target: { tabId: activeTab.id },
              files: ["content.js"],
            })
            .then(function () {
              console.log("Script injected, inserting CSS...");
              return chrome.scripting.insertCSS({
                target: { tabId: activeTab.id },
                files: ["content.css"],
              });
            })
            .then(function () {
              console.log("CSS inserted, sending message...");
              // Wait a bit then send message again
              setTimeout(function () {
                chrome.tabs.sendMessage(
                  activeTab.id,
                  {
                    action: "showConfirmation",
                    pipeline: pipeline,
                  },
                  function (response) {
                    if (chrome.runtime.lastError) {
                      console.error(
                        "Failed after injection, using popup fallback",
                      );
                      showPopupFallback(pipeline);
                    } else {
                      console.log("Modal shown successfully after injection");
                    }
                  },
                );
              }, 200);
            })
            .catch(function (error) {
              console.error("Injection failed:", error.message);
              showPopupFallback(pipeline);
            });
        } else {
          console.log("Confirmation modal shown successfully");
        }
      },
    );
  });
}

// Fallback 1: Show as popup window (for restricted pages)
function showPopupFallback(pipeline) {
  console.log("Using popup window fallback for:", pipeline.name);

  var width = 500;
  var height = 350;
  var popupUrl = chrome.runtime.getURL(
    "confirmation.html?pipelineId=" + pipeline.id,
  );

  console.log("Opening popup URL:", popupUrl);

  chrome.windows.create(
    {
      url: popupUrl,
      type: "popup",
      width: width,
      height: height,
      focused: true,
    },
    function (newWindow) {
      if (chrome.runtime.lastError) {
        console.error("Popup window error:", chrome.runtime.lastError.message);
        showNotificationFallback(pipeline);
      } else {
        console.log("Popup window created successfully:", newWindow.id);
      }
    },
  );
}

// Fallback 2: Show as notification (last resort)
function showNotificationFallback(pipeline) {
  console.log("Using notification fallback for:", pipeline.name);

  chrome.notifications.create(
    "trigger-" + pipeline.id,
    {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: "Pipeline Trigger: " + pipeline.name,
      message: "Do you want to run this pipeline now? Click here to respond.",
      priority: 2,
      requireInteraction: true,
    },
    function (notificationId) {
      if (chrome.runtime.lastError) {
        console.error("Notification error:", chrome.runtime.lastError.message);
      } else {
        console.log("Notification created:", notificationId);
        // Store pipeline ID for when notification is clicked
        chrome.storage.local.set({
          pendingPipeline: pipeline.id,
        });
      }
    },
  );
}

// Handle notification click to show popup
chrome.notifications.onClicked.addListener(function (notificationId) {
  console.log("Notification clicked:", notificationId);

  if (notificationId.startsWith("trigger-")) {
    chrome.storage.local.get("pendingPipeline", function (data) {
      if (data.pendingPipeline) {
        var pipelineId = data.pendingPipeline;
        chrome.storage.local.get({ pipelines: [] }, function (pipelineData) {
          var pipeline = pipelineData.pipelines.find(function (p) {
            return p.id === pipelineId;
          });
          if (pipeline) {
            showPopupFallback(pipeline);
          }
        });
      }
    });
    chrome.notifications.clear(notificationId);
  }
});

// NEW: Handle user response from confirmation popup
function handlePipelineConfirmation(pipelineId, response) {
  console.log("Pipeline confirmation:", pipelineId, response);

  chrome.storage.local.get({ pipelines: [] }, (data) => {
    const pipeline = data.pipelines.find((p) => p.id === pipelineId);
    if (!pipeline) return;

    if (response === "yes") {
      console.log("User clicked YES - triggering pipeline:", pipeline.name);
      triggerPipeline(pipeline);
    } else if (response === "snooze") {
      console.log("User clicked SNOOZE - will remind in 10 minutes");
      chrome.alarms.create(`snooze-${pipelineId}`, { delayInMinutes: 10 });
    } else {
      console.log("User dismissed the popup");
    }
  });
}

async function triggerPipeline(pipeline) {
  console.log("Triggering GitLab pipeline:", pipeline.name);

  const formData = new FormData();

  // Decrypt token before sending
  const decryptedToken = await decryptValue(pipeline.triggerToken);
  formData.append("token", decryptedToken);
  formData.append("ref", pipeline.branchRef || "main");

  // Append custom variables if they exist - decrypt before sending
  if (pipeline.variables && pipeline.variables.length > 0) {
    for (const variable of pipeline.variables) {
      if (variable.encryptedValue) {
        const decryptedValue = await decryptValue(variable.encryptedValue);
        formData.append(`variables[${variable.key}]`, decryptedValue);
        console.log(`Added variable: ${variable.key} = [DECRYPTED]`);
      }
    }
  }

  fetch(pipeline.gitlabUrl, {
    method: "POST",
    body: formData,
  })
    .then((response) => {
      console.log("GitLab API response status:", response.status);
      return response.json();
    })
    .then((result) => {
      console.log("Pipeline triggered successfully:", result);
      
      // Store execution in history and start monitoring
      const execution = {
        id: Date.now(),
        pipelineName: pipeline.name,
        pipelineId: result.id,
        pipelineUrl: result.web_url,
        projectId: extractProjectId(pipeline.gitlabUrl),
        status: 'running',
        timestamp: Date.now(),
        results: null
      };
      
      saveExecutionHistory(execution);
      startMonitoring(execution);
      
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `${pipeline.name} - Success ✓`,
        message: `Pipeline #${result.id} started successfully!`,
        priority: 2,
      });
    })
    .catch((error) => {
      console.error("Pipeline trigger failed:", error);
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `${pipeline.name} - Error ✗`,
        message: `Failed to trigger: ${error.message}`,
        priority: 2,
      });
    });
}

function extractProjectId(gitlabUrl) {
  // Extract project ID from URL like: https://gitlab.com/api/v4/projects/PROJECT_ID/trigger/pipeline
  const match = gitlabUrl.match(/projects\/(\d+)\//);
  return match ? match[1] : null;
}

function saveExecutionHistory(execution) {
  chrome.storage.local.get({ executionHistory: [] }, (data) => {
    const history = data.executionHistory || [];
    history.unshift(execution); // Add to beginning
    
    // Keep only last 50 executions
    if (history.length > 50) {
      history.splice(50);
    }
    
    chrome.storage.local.set({ executionHistory: history });
  });
}

function updateExecutionHistory(executionId, updates) {
  chrome.storage.local.get({ executionHistory: [] }, (data) => {
    const history = data.executionHistory || [];
    const index = history.findIndex(e => e.id === executionId);
    
    if (index !== -1) {
      history[index] = { ...history[index], ...updates };
      chrome.storage.local.set({ executionHistory: history }, () => {
        // Notify popup to refresh
        chrome.runtime.sendMessage({ action: 'historyUpdated' }).catch(() => {});
      });
    }
  });
}

function startMonitoring(execution) {
  console.log('Starting pipeline monitoring:', execution.pipelineId);
  
  const checkInterval = setInterval(async () => {
    try {
      const status = await checkPipelineStatus(execution);
      
      if (status === 'success' || status === 'failed') {
        clearInterval(checkInterval);
        
        // Try to fetch results
        const results = await fetchPipelineResults(execution);
        
        updateExecutionHistory(execution.id, {
          status: status,
          results: results
        });
        
        // Show notification
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: `${execution.pipelineName} - ${status === 'success' ? 'Completed ✓' : 'Failed ✗'}`,
          message: results ? 
            `Project: ${results.CAPTURED_PROJECT_NAME}\nHours: ${results.CAPTURED_HOURS}` :
            'Click to view details',
          priority: 2,
        });
      }
    } catch (error) {
      console.error('Monitoring error:', error);
      clearInterval(checkInterval);
    }
  }, 30000); // Check every 30 seconds
  
  // Stop monitoring after 2 hours
  setTimeout(() => clearInterval(checkInterval), 2 * 60 * 60 * 1000);
}

async function checkPipelineStatus(execution) {
  if (!execution.projectId || !execution.pipelineId) return null;
  
  const apiUrl = `https://gitlab.com/api/v4/projects/${execution.projectId}/pipelines/${execution.pipelineId}`;
  
  try {
    const response = await fetch(apiUrl);
    if (!response.ok) {
      console.error(`Failed to check status: ${response.status} ${response.statusText}`);
      console.error('Note: If project is private, you need to add GitLab API token support');
      return null;
    }
    const data = await response.json();
    console.log('Pipeline status:', data.status);
    return data.status; // 'running', 'success', 'failed', etc.
  } catch (error) {
    console.error('Failed to check pipeline status:', error);
    return null;
  }
}

async function fetchPipelineResults(execution) {
  if (!execution.projectId || !execution.pipelineId) return null;
  
  try {
    // Get jobs for this pipeline
    const jobsUrl = `https://gitlab.com/api/v4/projects/${execution.projectId}/pipelines/${execution.pipelineId}/jobs`;
    const jobsResponse = await fetch(jobsUrl);
    
    if (!jobsResponse.ok) {
      console.error(`Failed to fetch jobs: ${jobsResponse.status}`);
      return null;
    }
    
    const jobs = await jobsResponse.json();
    console.log('Found jobs:', jobs.map(j => j.name));
    
    // Find the test job (usually the last one)
    const testJob = jobs.find(job => job.name === 'robot-tests') || jobs[0];
    
    if (!testJob) {
      console.error('No test job found');
      return null;
    }
    
    console.log('Fetching artifact from job:', testJob.id);
    
    // Try to download the dotenv artifact
    const artifactUrl = `https://gitlab.com/api/v4/projects/${execution.projectId}/jobs/${testJob.id}/artifacts/results/pipeline.env`;
    const artifactResponse = await fetch(artifactUrl);
    
    if (!artifactResponse.ok) {
      console.error(`Failed to fetch artifact: ${artifactResponse.status}`);
      console.error('Artifact URL:', artifactUrl);
      return null;
    }
    
    const envText = await artifactResponse.text();
    console.log('Artifact content:', envText);
    
    // Parse the .env file
    const results = {};
    envText.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        results[key.trim()] = value.trim();
      }
    });
    
    console.log('Parsed results:', results);
    return results;
  } catch (error) {
    console.error('Failed to fetch pipeline results:', error);
    return null;
  }
}

console.log("Service worker started at:", new Date().toString());

// Local execution functions
async function triggerLocalExecution(pipeline) {
  console.log("Triggering local execution:", pipeline.name);
  
  // Check if local server is running
  try {
    const healthCheck = await fetch('http://localhost:5000/health');
    if (!healthCheck.ok) throw new Error('Server not responding');
  } catch (error) {
    console.error('Local server not running:', error);
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `${pipeline.name} - Error ✗`,
      message: 'Local server not running. Start it with: python local_server.py',
      priority: 2,
    });
    return;
  }
  
  // Prepare variables
  const variables = {};
  if (pipeline.variables && pipeline.variables.length > 0) {
    for (const variable of pipeline.variables) {
      if (variable.encryptedValue) {
        const decryptedValue = await decryptValue(variable.encryptedValue);
        variables[variable.key] = decryptedValue;
      }
    }
  }
  
  // Trigger local execution
  try {
    const response = await fetch('http://localhost:5000/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        variables,
        project_dir: pipeline.localProjectDir || '',
        test_path: pipeline.localTestPath || 'Tests/Test.robot',
        test_type: pipeline.localTestType || 'file'
      })
    });
    
    const result = await response.json();
    console.log('Local execution started:', result);
    console.log('Execution ID from server:', result.execution_id);
    
    // Check if execution actually started
    if (result.status === 'running') {
      // Store execution in history
      const execution = {
        id: Date.now(),
        pipelineName: pipeline.name,
        pipelineId: result.execution_id,
        pipelineUrl: null,
        projectId: null,
        status: 'running',
        timestamp: Date.now(),
        results: null,
        executionType: 'local'
      };
      
      console.log('Created execution object:', execution);
      
      saveExecutionHistory(execution);
      startLocalMonitoring(execution);
      
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `${pipeline.name} - Started ✓`,
        message: `Execution started\nType: ${pipeline.localTestType}\nPath: ${pipeline.localTestPath}`,
        priority: 2,
      });
    } else {
      // Execution failed to start
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: `${pipeline.name} - Failed to Start ✗`,
        message: result.error || 'Failed to start execution',
        priority: 2,
      });
    }
    
  } catch (error) {
    console.error('Failed to trigger local execution:', error);
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: `${pipeline.name} - Error ✗`,
      message: `Failed to start: ${error.message}`,
      priority: 2,
    });
  }
}

function startLocalMonitoring(execution) {
  console.log('Starting local execution monitoring:', execution.pipelineId);
  
  const checkInterval = setInterval(async () => {
    try {
      const response = await fetch(`http://localhost:5000/status/${execution.pipelineId}`);
      const data = await response.json();
      
      console.log('Local execution status:', data);
      
      if (data.completed) {
        console.log('Execution completed! Clearing interval and updating history');
        clearInterval(checkInterval);
        
        updateExecutionHistory(execution.id, {
          status: data.status,
          results: data.results
        });
        
        // Show notification with error details if failed
        let message = '';
        if (data.status === 'success') {
          message = data.results ? 
            `Project: ${data.results.CAPTURED_PROJECT_NAME}\nHours: ${data.results.CAPTURED_HOURS}` :
            'Execution completed';
        } else {
          message = data.error || 'Execution failed';
        }
        
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon128.png",
          title: `${execution.pipelineName} - ${data.status === 'success' ? 'Completed ✓' : 'Failed ✗'}`,
          message: message,
          priority: 2,
        });
      } else {
        console.log('Execution still running...');
      }
      
    } catch (error) {
      console.error('Local monitoring error:', error);
      clearInterval(checkInterval);
    }
  }, 5000); // Check every 5 seconds for local execution
  
  // Stop monitoring after 30 minutes
  setTimeout(() => clearInterval(checkInterval), 30 * 60 * 1000);
}
