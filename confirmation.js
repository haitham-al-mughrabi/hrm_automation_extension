// Get pipeline data from URL parameters
var urlParams = new URLSearchParams(window.location.search);
var pipelineId = parseInt(urlParams.get("pipelineId"));

console.log("Confirmation page loaded for pipeline ID:", pipelineId);

// Load pipeline details immediately with retry logic
function loadPipelineData() {
  if (!pipelineId || isNaN(pipelineId)) {
    document.getElementById("pipelineName").textContent = "No Pipeline ID";
    console.error("Invalid pipeline ID:", pipelineId);
    return;
  }

  chrome.storage.local.get({ pipelines: [] }, function (data) {
    console.log("All pipelines from storage:", data.pipelines);

    var pipeline = null;
    for (var i = 0; i < data.pipelines.length; i++) {
      console.log(
        "Checking pipeline:",
        data.pipelines[i].name,
        "ID:",
        data.pipelines[i].id,
      );
      if (data.pipelines[i].id === pipelineId) {
        pipeline = data.pipelines[i];
        break;
      }
    }

    console.log("Found pipeline:", pipeline);

    if (pipeline) {
      document.getElementById("pipelineName").textContent = pipeline.name;
      console.log("Pipeline name set to:", pipeline.name);
    } else {
      document.getElementById("pipelineName").textContent =
        "Pipeline #" + pipelineId;
      console.error("Pipeline not found with ID:", pipelineId);
      console.log(
        "Available IDs:",
        data.pipelines.map(function (p) {
          return p.id;
        }),
      );
    }
  });
}

// Load immediately
loadPipelineData();

// Display current time with better formatting
function updateTime() {
  var now = new Date();
  var hours = String(now.getHours()).padStart(2, "0");
  var minutes = String(now.getMinutes()).padStart(2, "0");
  var seconds = String(now.getSeconds()).padStart(2, "0");
  document.getElementById("currentTime").textContent =
    hours + ":" + minutes + ":" + seconds;
}

updateTime();
setInterval(updateTime, 1000);

// Handle button clicks
document.getElementById("yesBtn").addEventListener("click", function () {
  console.log("YES button clicked for pipeline ID:", pipelineId);
  chrome.runtime.sendMessage({
    action: "confirmPipeline",
    pipelineId: pipelineId,
    response: "yes",
  });
  setTimeout(function () {
    window.close();
  }, 100);
});

document.getElementById("snoozeBtn").addEventListener("click", function () {
  console.log("SNOOZE button clicked for pipeline ID:", pipelineId);
  chrome.runtime.sendMessage({
    action: "confirmPipeline",
    pipelineId: pipelineId,
    response: "snooze",
  });
  setTimeout(function () {
    window.close();
  }, 100);
});

document.getElementById("dismissBtn").addEventListener("click", function () {
  console.log("DISMISS button clicked for pipeline ID:", pipelineId);
  chrome.runtime.sendMessage({
    action: "confirmPipeline",
    pipelineId: pipelineId,
    response: "dismiss",
  });
  setTimeout(function () {
    window.close();
  }, 100);
});

// Auto-focus on Yes button
document.getElementById("yesBtn").focus();

// Keyboard shortcuts
document.addEventListener("keydown", function (e) {
  if (e.key === "Enter") {
    document.getElementById("yesBtn").click();
  } else if (e.key === "Escape") {
    document.getElementById("dismissBtn").click();
  } else if (e.key === "s" || e.key === "S") {
    document.getElementById("snoozeBtn").click();
  }
});

console.log("Confirmation.js loaded successfully");
