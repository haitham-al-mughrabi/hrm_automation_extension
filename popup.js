let editingPipelineId = null;
const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

document.addEventListener('DOMContentLoaded', function() {
  loadPipelines();
  setupEventListeners();
  
  // Set current year in footer
  var currentYear = new Date().getFullYear();
  document.getElementById('currentYear').textContent = currentYear;
  document.getElementById('formYear').textContent = currentYear;
});

function setupEventListeners() {
  // Navigation
  document.getElementById('addNewBtn').addEventListener('click', function() {
    showFormView();
  });
  document.getElementById('backBtn').addEventListener('click', function() {
    showMainView();
  });

  document.getElementById('cancelBtn').addEventListener('click', function() {
    if (confirm('Are you sure you want to cancel? Any unsaved changes will be lost.')) {
      showMainView();
    }
  });
  
  // Form actions
  document.getElementById('saveBtn').addEventListener('click', savePipeline);
  document.getElementById('testBtn').addEventListener('click', testPipeline);
  document.getElementById('toggleToken').addEventListener('click', toggleTokenVisibility);

  // Day selector
  document.querySelectorAll('.day-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      btn.classList.toggle('active');
    });
  });
  
  // Time input validation
  document.getElementById('triggerHours').addEventListener('input', function(e) {
    validateTimeInput(e.target, 0, 23);
  });
  document.getElementById('triggerMinutes').addEventListener('input', function(e) {
    validateTimeInput(e.target, 0, 59);
  });
  document.getElementById('triggerSeconds').addEventListener('input', function(e) {
    validateTimeInput(e.target, 0, 59);
  });
}

function validateTimeInput(input, min, max) {
  var value = parseInt(input.value);
  if (isNaN(value) || value < min) {
    input.value = String(min).padStart(2, '0');
  } else if (value > max) {
    input.value = String(max).padStart(2, '0');
  } else {
    input.value = String(value).padStart(2, '0');
  }
}

function showMainView() {
  document.getElementById('formView').classList.remove('active');
  document.getElementById('mainView').classList.add('active');
  editingPipelineId = null;
  clearForm();
}

function showFormView(pipeline = null) {
  document.getElementById('mainView').classList.remove('active');
  document.getElementById('formView').classList.add('active');
  
  if (pipeline) {
    // Edit mode
    editingPipelineId = pipeline.id;
    document.getElementById('formTitle').textContent = 'Edit Pipeline';
    populateForm(pipeline);
  } else {
    // Add mode
    editingPipelineId = null;
    document.getElementById('formTitle').textContent = 'Add Pipeline';
    clearForm();
  }
}

function loadPipelines() {
  chrome.storage.local.get({pipelines: []}, (data) => {
    const pipelines = data.pipelines;
    displayPipelines(pipelines);
    updatePipelineCount(pipelines.length);
  });
}

function displayPipelines(pipelines) {
  const listContainer = document.getElementById('pipelinesList');
  const emptyState = document.getElementById('emptyState');
  
  if (pipelines.length === 0) {
    emptyState.classList.remove('hidden');
    listContainer.innerHTML = '';
    return;
  }
  
  emptyState.classList.add('hidden');
  listContainer.innerHTML = pipelines.map(pipeline => createPipelineCard(pipeline)).join('');
  
  // Attach event listeners
  pipelines.forEach(pipeline => {
    document.getElementById(`update-${pipeline.id}`).addEventListener('click', () => showFormView(pipeline));
    document.getElementById(`delete-${pipeline.id}`).addEventListener('click', () => deletePipeline(pipeline.id));
  });
}

function createPipelineCard(pipeline) {
  const activeDaysChips = dayNames.map((day, index) => {
    const isActive = pipeline.activeDays.includes(index);
    return `<span class="day-chip ${isActive ? 'active' : ''}">${day}</span>`;
  }).join('');

  return `
    <div class="pipeline-card ${pipeline.isActive ? '' : 'inactive'}">
      <div class="pipeline-header">
        <div class="pipeline-info">
          <h3>
            ${escapeHtml(pipeline.name)}
            <span class="status-badge ${pipeline.isActive ? 'active' : 'inactive'}">
              <span class="status-indicator"></span>
              ${pipeline.isActive ? 'Active' : 'Inactive'}
            </span>
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
  document.getElementById('pipelineName').value = pipeline.name;
  document.getElementById('gitlabUrl').value = pipeline.gitlabUrl;
  document.getElementById('triggerToken').value = pipeline.triggerToken;
  document.getElementById('branchRef').value = pipeline.branchRef;
  
  // Parse time with seconds
  var timeParts = pipeline.triggerTime.split(':');
  document.getElementById('triggerHours').value = timeParts[0] || '09';
  document.getElementById('triggerMinutes').value = timeParts[1] || '00';
  document.getElementById('triggerSeconds').value = timeParts[2] || '00';
  
  document.getElementById('isActive').checked = pipeline.isActive;
  
  document.querySelectorAll('.day-btn').forEach(function(btn) {
    var day = parseInt(btn.dataset.day);
    if (pipeline.activeDays.includes(day)) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function clearForm() {
  document.getElementById('pipelineName').value = '';
  document.getElementById('gitlabUrl').value = '';
  document.getElementById('triggerToken').value = '';
  document.getElementById('branchRef').value = 'main';
  document.getElementById('triggerHours').value = '09';
  document.getElementById('triggerMinutes').value = '00';
  document.getElementById('triggerSeconds').value = '00';
  document.getElementById('isActive').checked = true;
  
  document.querySelectorAll('.day-btn').forEach(function(btn) {
    var day = parseInt(btn.dataset.day);
    if (day >= 1 && day <= 5) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function savePipeline() {
  var name = document.getElementById('pipelineName').value.trim();
  var gitlabUrl = document.getElementById('gitlabUrl').value.trim();
  var triggerToken = document.getElementById('triggerToken').value.trim();
  var branchRef = document.getElementById('branchRef').value.trim() || 'main';
  
  // Get time with seconds
  var hours = document.getElementById('triggerHours').value.padStart(2, '0');
  var minutes = document.getElementById('triggerMinutes').value.padStart(2, '0');
  var seconds = document.getElementById('triggerSeconds').value.padStart(2, '0');
  var triggerTime = hours + ':' + minutes + ':' + seconds;
  
  var isActive = document.getElementById('isActive').checked;
  var activeDays = Array.from(document.querySelectorAll('.day-btn.active'))
    .map(function(btn) {
      return parseInt(btn.dataset.day);
    });

  if (!name || !gitlabUrl || !triggerToken) {
    showStatus('Please fill in all required fields', 'error');
    return;
  }

  chrome.storage.local.get({pipelines: []}, function(data) {
    var pipelines = data.pipelines;
    
    var pipeline = {
      id: editingPipelineId || Date.now(),
      name: name,
      gitlabUrl: gitlabUrl,
      triggerToken: triggerToken,
      branchRef: branchRef,
      triggerTime: triggerTime,
      activeDays: activeDays,
      isActive: isActive
    };

    if (editingPipelineId) {
      pipelines = pipelines.map(function(p) {
        return p.id === editingPipelineId ? pipeline : p;
      });
    } else {
      pipelines.push(pipeline);
    }

    chrome.storage.local.set({pipelines: pipelines}, function() {
      chrome.runtime.sendMessage({action: 'setupAlarms', pipelines: pipelines});
      showStatus('✓ Pipeline saved successfully!', 'success');
      setTimeout(function() {
        showMainView();
        loadPipelines();
      }, 1000);
    });
  });
}

function deletePipeline(id) {
  if (!confirm('Are you sure you want to delete this pipeline?')) {
    return;
  }

  chrome.storage.local.get({pipelines: []}, (data) => {
    const pipelines = data.pipelines.filter(p => p.id !== id);
    chrome.storage.local.set({pipelines}, () => {
      chrome.runtime.sendMessage({ action: 'setupAlarms', pipelines });
      loadPipelines();
    });
  });
}

function testPipeline() {
  const gitlabUrl = document.getElementById('gitlabUrl').value.trim();
  const triggerToken = document.getElementById('triggerToken').value.trim();
  const branchRef = document.getElementById('branchRef').value.trim() || 'main';

  if (!gitlabUrl || !triggerToken) {
    showStatus('Please enter GitLab URL and Token first', 'error');
    return;
  }

  chrome.runtime.sendMessage({ 
    action: 'testPipeline',
    pipeline: { gitlabUrl, triggerToken, branchRef }
  });
  showStatus('Test notification sent!', 'success');
}

function toggleTokenVisibility() {
  const tokenInput = document.getElementById('triggerToken');
  const eyeIcon = document.querySelector('.eye-icon');
  
  if (tokenInput.type === 'password') {
    tokenInput.type = 'text';
    eyeIcon.innerHTML = '<path d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"/>';
  } else {
    tokenInput.type = 'password';
    eyeIcon.innerHTML = '<path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>';
  }
}

function updatePipelineCount(count) {
  document.getElementById('pipelineCount').textContent = 
    `${count} pipeline${count !== 1 ? 's' : ''} scheduled`;
}

function showStatus(message, type) {
  const statusEl = document.getElementById('statusMessage');
  statusEl.textContent = message;
  statusEl.className = `status-message ${type} show`;
  
  setTimeout(() => {
    statusEl.classList.remove('show');
  }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
