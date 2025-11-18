// Talk to Flask on 5050, not nginx on 7070
const API = window.location.origin.replace(/:\d+$/, ":5050/api");

let currentSample = null;
let currentJob = null;

// -------------------------------
// Upload FASTQ
// -------------------------------
document.getElementById("upload-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const fileInput = document.getElementById("file-input");
  const name = document.getElementById("sample-name").value || "sample";

  if (!fileInput.files.length) {
    alert("Please choose FASTQ files.");
    return;
  }

  const form = new FormData();
  form.append("sample_name", name);
  for (const f of fileInput.files) form.append("files", f);

  const res = await fetch(`${API}/upload`, {
    method: "POST",
    body: form,
  });

  const data = await res.json();
  console.log("UPLOAD:", data);

  if (!data.ok) {
    alert("Upload error: " + data.error);
    return;
  }

  currentSample = data.sample;
  document.getElementById("run-btn").disabled = false;
});

// -------------------------------
// Run pipeline
// -------------------------------
document.getElementById("run-btn").addEventListener("click", async () => {
  if (!currentSample) {
    alert("Upload first.");
    return;
  }

  const res = await fetch(`${API}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sample: currentSample }),
  });

  const data = await res.json();
  console.log("RUN:", data);

  if (!data.ok) {
    alert("Run error");
    return;
  }

  currentJob = data.job_id;
  pollStatus();
});

// -------------------------------
// Poll status
// -------------------------------
async function pollStatus() {
  if (!currentJob) return;

  const res = await fetch(`${API}/status/${currentJob}`);
  const data = await res.json();

  if (!data.ok) return;

  const job = data.job;
  renderStatus(job);

  if (job.progress < 100) {
    setTimeout(pollStatus, 2000);
  }
}

// -------------------------------
// Refresh button
// -------------------------------
document.getElementById("refresh-btn").addEventListener("click", pollStatus);

// -------------------------------
// NEW: View QC report button
// -------------------------------
document.getElementById("view-report-btn").addEventListener("click", () => {
  if (!currentJob) {
    alert("Run the pipeline first so we know which job to show.");
    return;
  }
  // Go to report.html with the job_id query param
  window.location.href = `report.html?job_id=${currentJob}`;
});

// -------------------------------
// Render UI
// -------------------------------
function renderStatus(job) {
  // JSON view
  document.getElementById("status").innerHTML =
    `<pre>${JSON.stringify(job, null, 2)}</pre>`;

  // Progress bar
  document.getElementById("bar").style.width = job.progress + "%";
}
