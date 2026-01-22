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
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M13.854 3.646a.5.5 0 010 .708l-7 7a.5.5 0 01-.708 0l-3.5-3.5a.5.5 0 11.708-.708L6.5 10.293l6.646-6.647a.5.5 0 01.708 0z"/>
            </svg>
            <span>Yes, Run Pipeline</span>
          </button>
          <button class="pipeline-modal-btn pipeline-modal-btn-secondary" id="pipeline-snooze-btn">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path fill-rule="evenodd" d="M8 15A7 7 0 108 1a7 7 0 000 14zm.5-10.5a.5.5 0 00-1 0v4.586L5.354 11.232a.5.5 0 00.707.707l2.5-2.5A.5.5 0 009 9V4.5z" clip-rule="evenodd"/>
            </svg>
            <span>Snooze 10 min</span>
          </button>
        </div>
        <button class="pipeline-modal-btn pipeline-modal-btn-dismiss" id="pipeline-dismiss-btn">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
            <path d="M2.146 2.854a.5.5 0 11.708-.708L8 7.293l5.146-5.147a.5.5 0 01.708.708L8.707 8l5.147 5.146a.5.5 0 01-.708.708L8 8.707l-5.146 5.147a.5.5 0 01-.708-.708L7.293 8 2.146 2.854z"/>
          </svg>
          <span>Dismiss</span>
        </button>

        <footer class="pipeline-modal-footer">
          <p>Made with <span class="pipeline-heart">&hearts;</span> by <strong>Haitham Al Mughrabi</strong></p>
          <p class="pipeline-copyright">&copy; ${new Date().getFullYear()} All rights reserved</p>
        </footer>
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
