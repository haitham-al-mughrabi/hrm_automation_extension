// IMPORTANT: Check and recreate alarms on startup
chrome.runtime.onStartup.addListener(() => {
  console.log('Extension started - setting up alarms');
  setupAllAlarms();
});

chrome.runtime.onInstalled.addListener(() => {
  console.log('Extension installed/updated - setting up alarms');
  setupAllAlarms();
});

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'setupAlarms') {
    console.log('Received setupAlarms message');
    setupAllAlarms();
  } else if (request.action === 'testPipeline') {
    // Make sure the test pipeline has an ID
    const testPipeline = {
      id: request.pipeline.id || Date.now(),
      name: request.pipeline.name || 'Test Pipeline',
      gitlabUrl: request.pipeline.gitlabUrl,
      triggerToken: request.pipeline.trigkerToken,
      branchRef: request.pipeline.branchRef || 'main'
    };
    console.log('Test pipeline with ID:', testPipeline);
    showConfirmation(testPipeline);
  } else if (request.action === 'confirmPipeline') {
    handlePipelineConfirmation(request.pipelineId, request.response);
    // Don't send response - just handle it
  }
  // Note: We don't return true because we don't need async response
});



function setupAllAlarms() {
  chrome.storage.local.get({pipelines: []}, (data) => {
    console.log('Setting up alarms for pipelines:', data.pipelines);
    
    chrome.alarms.clearAll(() => {
      console.log('Cleared all previous alarms');
      
      const activePipelines = data.pipelines.filter(p => p.isActive);
      console.log('Active pipelines:', activePipelines.length);
      
      activePipelines.forEach(pipeline => {
        setupAlarmForPipeline(pipeline);
      });
      
      chrome.alarms.getAll((alarms) => {
        console.log('Current alarms after setup:', alarms);
      });
    });
  });
}

function setupAlarmForPipeline(pipeline) {
  var timeParts = pipeline.triggerTime.split(':');
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
  
  console.log('Setting alarm for ' + pipeline.name + ':', {
    id: pipeline.id,
    triggerTime: pipeline.triggerTime,
    scheduledFor: scheduled.toString(),
    delayInMinutes: delayInMinutes,
    willFireAt: new Date(now.getTime() + delayInMinutes * 60000).toString()
  });

  chrome.alarms.create('pipeline-' + pipeline.id, {
    delayInMinutes: delayInMinutes,
    periodInMinutes: 24 * 60
  }, function() {
    if (chrome.runtime.lastError) {
      console.error('Error creating alarm:', chrome.runtime.lastError.message);
    } else {
      console.log('Alarm created for ' + pipeline.name);
    }
  });
}


chrome.alarms.onAlarm.addListener((alarm) => {
  console.log('Alarm fired:', alarm.name, 'at', new Date().toString());
  
  if (alarm.name.startsWith('pipeline-')) {
    const pipelineId = parseInt(alarm.name.replace('pipeline-', ''));
    checkAndShowConfirmation(pipelineId);
  } else if (alarm.name.startsWith('snooze-')) {
    const pipelineId = parseInt(alarm.name.replace('snooze-', ''));
    chrome.storage.local.get({pipelines: []}, (data) => {
      const pipeline = data.pipelines.find(p => p.id === pipelineId);
      if (pipeline) {
        console.log('Snooze alarm fired for:', pipeline.name);
        showConfirmation(pipeline);
      }
    });
  }
});

function checkAndShowConfirmation(pipelineId) {
  chrome.storage.local.get({pipelines: []}, (data) => {
    const pipeline = data.pipelines.find(p => p.id === pipelineId);
    
    if (!pipeline) {
      console.error('Pipeline not found:', pipelineId);
      return;
    }
    
    if (!pipeline.isActive) {
      console.log('Pipeline is inactive, skipping:', pipeline.name);
      return;
    }

    const today = new Date().getDay();
    console.log('Checking pipeline:', pipeline.name, 'Today:', today, 'Active days:', pipeline.activeDays);
    
    if (pipeline.activeDays.includes(today)) {
      console.log('✓ Today is active day, showing confirmation for:', pipeline.name);
      showConfirmation(pipeline);
    } else {
      console.log('✗ Today is not active day for:', pipeline.name);
    }
  });
}

function showConfirmation(pipeline) {
  console.log('Showing confirmation modal for:', pipeline.name);
  
  if (!pipeline || !pipeline.id) {
    console.error('Pipeline missing ID:', pipeline);
    return;
  }
  
  // Get the active tab
  chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
    if (!tabs || tabs.length === 0) {
      console.log('No active tab, falling back to popup window');
      showPopupFallback(pipeline);
      return;
    }
    
    var activeTab = tabs[0];
    var tabUrl = activeTab.url || '';
    
    // Check if URL is restricted (chrome://, edge://, about:, etc.)
    var isRestrictedUrl = tabUrl.startsWith('chrome://') || 
                          tabUrl.startsWith('chrome-extension://') ||
                          tabUrl.startsWith('edge://') ||
                          tabUrl.startsWith('about:') ||
                          tabUrl.startsWith('file://') ||
                          tabUrl === '' ||
                          tabUrl.startsWith('view-source:');
    
    if (isRestrictedUrl) {
      console.log('Restricted URL detected:', tabUrl, '- using popup window');
      showPopupFallback(pipeline);
      return;
    }
    
    console.log('Attempting modal on tab:', activeTab.id, 'URL:', tabUrl);
    
    // Try to send message to content script
    chrome.tabs.sendMessage(activeTab.id, {
      action: 'showConfirmation',
      pipeline: pipeline
    }, function(response) {
      if (chrome.runtime.lastError) {
        console.log('Content script not ready, injecting...');
        
        // Inject content script
        chrome.scripting.executeScript({
          target: {tabId: activeTab.id},
          files: ['content.js']
        }).then(function() {
          console.log('Script injected, inserting CSS...');
          return chrome.scripting.insertCSS({
            target: {tabId: activeTab.id},
            files: ['content.css']
          });
        }).then(function() {
          console.log('CSS inserted, sending message...');
          // Wait a bit then send message again
          setTimeout(function() {
            chrome.tabs.sendMessage(activeTab.id, {
              action: 'showConfirmation',
              pipeline: pipeline
            }, function(response) {
              if (chrome.runtime.lastError) {
                console.error('Failed after injection, using popup fallback');
                showPopupFallback(pipeline);
              } else {
                console.log('Modal shown successfully after injection');
              }
            });
          }, 200);
        }).catch(function(error) {
          console.error('Injection failed:', error.message);
          showPopupFallback(pipeline);
        });
      } else {
        console.log('Confirmation modal shown successfully');
      }
    });
  });
}

// Fallback 1: Show as popup window (for restricted pages)
function showPopupFallback(pipeline) {
  console.log('Using popup window fallback for:', pipeline.name);
  
  var width = 500;
  var height = 350;
  var popupUrl = chrome.runtime.getURL('confirmation.html?pipelineId=' + pipeline.id);
  
  console.log('Opening popup URL:', popupUrl);
  
  chrome.windows.create({
    url: popupUrl,
    type: 'popup',
    width: width,
    height: height,
    focused: true
  }, function(newWindow) {
    if (chrome.runtime.lastError) {
      console.error('Popup window error:', chrome.runtime.lastError.message);
      showNotificationFallback(pipeline);
    } else {
      console.log('Popup window created successfully:', newWindow.id);
    }
  });
}

// Fallback 2: Show as notification (last resort)
function showNotificationFallback(pipeline) {
  console.log('Using notification fallback for:', pipeline.name);

  chrome.notifications.create('trigger-' + pipeline.id, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Pipeline Trigger: ' + pipeline.name,
    message: 'Do you want to run this pipeline now? Click here to respond.',
    priority: 2,
    requireInteraction: true
  }, function(notificationId) {
    if (chrome.runtime.lastError) {
      console.error('Notification error:', chrome.runtime.lastError.message);
    } else {
      console.log('Notification created:', notificationId);
      // Store pipeline ID for when notification is clicked
      chrome.storage.local.set({
        pendingPipeline: pipeline.id
      });
    }
  });
}

// Handle notification click to show popup
chrome.notifications.onClicked.addListener(function(notificationId) {
  console.log('Notification clicked:', notificationId);
  
  if (notificationId.startsWith('trigger-')) {
    chrome.storage.local.get('pendingPipeline', function(data) {
      if (data.pendingPipeline) {
        var pipelineId = data.pendingPipeline;
        chrome.storage.local.get({pipelines: []}, function(pipelineData) {
          var pipeline = pipelineData.pipelines.find(function(p) {
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
  console.log('Pipeline confirmation:', pipelineId, response);
  
  chrome.storage.local.get({pipelines: []}, (data) => {
    const pipeline = data.pipelines.find(p => p.id === pipelineId);
    if (!pipeline) return;

    if (response === 'yes') {
      console.log('User clicked YES - triggering pipeline:', pipeline.name);
      triggerPipeline(pipeline);
    } else if (response === 'snooze') {
      console.log('User clicked SNOOZE - will remind in 10 minutes');
      chrome.alarms.create(`snooze-${pipelineId}`, { delayInMinutes: 10 });
    } else {
      console.log('User dismissed the popup');
    }
  });
}

function triggerPipeline(pipeline) {
  console.log('Triggering GitLab pipeline:', pipeline.name);
  
  const formData = new FormData();
  formData.append('token', pipeline.triggerToken);
  formData.append('ref', pipeline.branchRef || 'main');

  fetch(pipeline.gitlabUrl, {
    method: 'POST',
    body: formData
  })
  .then(response => {
    console.log('GitLab API response status:', response.status);
    return response.json();
  })
  .then(result => {
    console.log('Pipeline triggered successfully:', result);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `${pipeline.name} - Success ✓`,
      message: `Pipeline #${result.id} started successfully!`,
      priority: 2
    });
  })
  .catch(error => {
    console.error('Pipeline trigger failed:', error);
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `${pipeline.name} - Error ✗`,
      message: `Failed to trigger: ${error.message}`,
      priority: 2
    });
  });
}

console.log('Service worker started at:', new Date().toString());
