// Prevent duplicate injection
if (window.pipelineConfirmationLoaded) {
  console.log("Pipeline confirmation already loaded");
} else {
  window.pipelineConfirmationLoaded = true;

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
      if (request.action === "showConfirmation") {
        showConfirmationModal(request.pipeline);
        sendResponse({ received: true });
      }
      return true;
    },
  );

  // Listen for messages from background script
  chrome.runtime.onMessage.addListener(
    function (request, sender, sendResponse) {
      if (request.action === "showConfirmation") {
        showConfirmationModal(request.pipeline);
        sendResponse({ received: true });
      }
      return true;
    },
  );

  function showConfirmationModal(pipeline) {
    // Remove existing modal if any
    var existing = document.getElementById("pipeline-confirmation-modal");
    if (existing) {
      existing.remove();
    }

    // Create modal overlay
    var modal = document.createElement("div");
    modal.id = "pipeline-confirmation-modal";
    modal.innerHTML = `
    <div class="pipeline-modal-overlay">
      <div class="pipeline-modal-container">
        <div class="pipeline-modal-icon">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="white">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
        
        <h1 class="pipeline-modal-title">Pipeline Trigger</h1>
        <div class="pipeline-modal-name">${escapeHtml(pipeline.name)}</div>
        <div class="pipeline-modal-message">Do you want to trigger this pipeline now?</div>
        <div class="pipeline-modal-time" id="pipeline-modal-time">00:00:00</div>
        
        <div class="pipeline-modal-buttons">
          <button class="pipeline-modal-btn pipeline-modal-btn-primary" id="pipeline-yes-btn">
            <span>&#10004;</span>
            <span>Yes, Run Pipeline</span>
          </button>
          <button class="pipeline-modal-btn pipeline-modal-btn-secondary" id="pipeline-snooze-btn">
            <span>&#9200;</span>
            <span>Snooze 10 min</span>
          </button>
        </div>
        <button class="pipeline-modal-btn pipeline-modal-btn-dismiss" id="pipeline-dismiss-btn">
          <span>&#10005;</span>
          <span>Dismiss</span>
        </button>
      </div>
    </div>
  `;

    document.body.appendChild(modal);

    // Update time every second
    var timeInterval = setInterval(function () {
      var now = new Date();
      var hours = String(now.getHours()).padStart(2, "0");
      var minutes = String(now.getMinutes()).padStart(2, "0");
      var seconds = String(now.getSeconds()).padStart(2, "0");
      var timeEl = document.getElementById("pipeline-modal-time");
      if (timeEl) {
        timeEl.textContent = hours + ":" + minutes + ":" + seconds;
      }
    }, 1000);

    // Handle button clicks
    document
      .getElementById("pipeline-yes-btn")
      .addEventListener("click", function () {
        clearInterval(timeInterval);
        chrome.runtime.sendMessage({
          action: "confirmPipeline",
          pipelineId: pipeline.id,
          response: "yes",
        });
        modal.remove();
      });

    document
      .getElementById("pipeline-snooze-btn")
      .addEventListener("click", function () {
        clearInterval(timeInterval);
        chrome.runtime.sendMessage({
          action: "confirmPipeline",
          pipelineId: pipeline.id,
          response: "snooze",
        });
        modal.remove();
      });

    document
      .getElementById("pipeline-dismiss-btn")
      .addEventListener("click", function () {
        clearInterval(timeInterval);
        chrome.runtime.sendMessage({
          action: "confirmPipeline",
          pipelineId: pipeline.id,
          response: "dismiss",
        });
        modal.remove();
      });

    // Keyboard shortcuts
    function handleKeydown(e) {
      if (e.key === "Enter") {
        document.getElementById("pipeline-yes-btn").click();
        document.removeEventListener("keydown", handleKeydown);
      } else if (e.key === "Escape") {
        document.getElementById("pipeline-dismiss-btn").click();
        document.removeEventListener("keydown", handleKeydown);
      } else if (e.key === "s" || e.key === "S") {
        document.getElementById("pipeline-snooze-btn").click();
        document.removeEventListener("keydown", handleKeydown);
      }
    }
    document.addEventListener("keydown", handleKeydown);

    // Auto-focus on Yes button
    setTimeout(function () {
      document.getElementById("pipeline-yes-btn").focus();
    }, 100);
  }

  function escapeHtml(text) {
    var div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  }

  console.log("Pipeline confirmation content script loaded");
}
