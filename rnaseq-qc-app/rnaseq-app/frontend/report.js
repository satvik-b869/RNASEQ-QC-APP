(function () {
    // IMPORTANT: talk to Flask backend on 5050, not nginx on 7070
    const API = window.location.origin.replace(/:\d+$/, ":5050/api");
  
    const errorBox = document.getElementById("errorBox");
  
    function showError(msg) {
      if (!errorBox) return;
      errorBox.textContent = msg;
      errorBox.style.display = "block";
    }
  
    function getJobIdFromQuery() {
      const params = new URLSearchParams(window.location.search);
      return params.get("job_id");
    }
  
    function badgeClass(status) {
      status = (status || "").toLowerCase();
      if (status === "finished") return "badge finished";
      if (status === "failed") return "badge failed";
      return "badge running";
    }
  
    function renderMeta(job) {
      document.getElementById("metaJobId").textContent = job.id;
      document.getElementById("metaCreated").textContent = job.created_at || "–";
      document.getElementById("metaProgress").textContent = `${job.progress ?? 0}%`;
      document.getElementById("metaSample").textContent = job.sample?.name || "–";
  
      const statusEl = document.getElementById("metaStatus");
      statusEl.textContent = job.status || "unknown";
      statusEl.className = badgeClass(job.status);
  
      const filesEl = document.getElementById("metaFiles");
      if (job.sample?.files?.length) {
        filesEl.textContent = job.sample.files.join(", ");
      } else {
        filesEl.textContent = "–";
      }
    }
  
    function makeTableFromDict(dict) {
      const entries = Object.entries(dict || {});
      if (!entries.length) {
        return "<p style='font-size:0.85rem;color:#9ca3af'>No metrics recorded.</p>";
      }
      let html = "<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody>";
      for (const [k, v] of entries) {
        html += `<tr><td>${k}</td><td>${v}</td></tr>`;
      }
      html += "</tbody></table>";
      return html;
    }
  
    function findStage(job, name) {
      return (job.stages || []).find((s) => s.name === name);
    }
  
    function renderQCSummary(job) {
      const preStage = findStage(job, "pre_fastqc");
      const postStage = findStage(job, "post_fastqc");
      const trimStage = findStage(job, "trim_fastp");
  
      const preDiv = document.getElementById("preFastqcTable");
      const postDiv = document.getElementById("postFastqcTable");
      const fastpDiv = document.getElementById("fastpSummary");
  
      if (preDiv) {
        preDiv.innerHTML = makeTableFromDict(preStage?.metrics || {});
        if (preStage?.artifact) {
          preDiv.innerHTML += `<p style="margin-top:0.5rem;font-size:0.8rem;">
            <a href="${API}/artifact?path=${encodeURIComponent(preStage.artifact)}" target="_blank">
              Open full FastQC HTML
            </a>
          </p>`;
        }
      }
  
      if (postDiv) {
        postDiv.innerHTML = makeTableFromDict(postStage?.metrics || {});
        if (postStage?.artifact) {
          postDiv.innerHTML += `<p style="margin-top:0.5rem;font-size:0.8rem;">
            <a href="${API}/artifact?path=${encodeURIComponent(postStage.artifact)}" target="_blank">
              Open full FastQC HTML
            </a>
          </p>`;
        }
      }
  
      if (fastpDiv) {
        const summary = trimStage?.metrics || {};
        if (Object.keys(summary).length === 0) {
          fastpDiv.innerHTML =
            "<p style='font-size:0.85rem;color:#9ca3af'>No fastp metrics recorded.</p>";
        } else {
          let html = "";
          if (summary.before_filtering) {
            html += "<h4>Before filtering</h4>" + makeTableFromDict(summary.before_filtering);
          }
          if (summary.after_filtering) {
            html += "<h4>After filtering</h4>" + makeTableFromDict(summary.after_filtering);
          }
          fastpDiv.innerHTML = html || makeTableFromDict(summary);
        }
        if (trimStage?.artifact) {
          fastpDiv.innerHTML += `<p style="margin-top:0.5rem;font-size:0.8rem;">
            <a href="${API}/artifact?path=${encodeURIComponent(trimStage.artifact)}" target="_blank">
              Open fastp HTML
            </a>
          </p>`;
        }
      }
    }
  
    function renderAlignment(job) {
      const alignStage = findStage(job, "align_star");
      const starDiv = document.getElementById("starTable");
      const linksDiv = document.getElementById("alignmentLinks");
  
      if (starDiv) {
        starDiv.innerHTML = makeTableFromDict(alignStage?.metrics || {});
      }
  
      if (linksDiv) {
        const artifacts = job.artifacts || [];
        const starReport = artifacts.find((a) => a.kind === "star_report");
        const bamArt = artifacts.find((a) => a.kind === "star_bam");
        let html = "";
        if (starReport) {
          html += `<a href="${API}/artifact?path=${encodeURIComponent(
            starReport.path
          )}" target="_blank">Open STAR HTML report</a>`;
        }
        if (bamArt) {
          if (html) html += " · ";
          html += `<a href="${API}/artifact?path=${encodeURIComponent(
            bamArt.path
          )}" target="_blank">Download BAM</a>`;
        }
        if (!html) {
          html =
            "<span style='font-size:0.85rem;color:#9ca3af'>No STAR artifacts recorded.</span>";
        }
        linksDiv.innerHTML = html;
      }
    }
  
    function renderCounts(job) {
      const linksDiv = document.getElementById("countsLinks");
      const countsInfo = document.getElementById("countsInfo");
      const artifacts = job.artifacts || [];
      const countsArt = artifacts.find((a) => a.kind === "counts_table");
  
      if (!linksDiv) return;
      if (countsArt) {
        linksDiv.innerHTML = `<a href="${API}/artifact?path=${encodeURIComponent(
          countsArt.path
        )}" target="_blank">Download counts table (featureCounts)</a>`;
        if (countsInfo) {
          countsInfo.textContent = countsArt.path;
        }
      } else {
        linksDiv.innerHTML =
          "<span style='font-size:0.85rem;color:#9ca3af'>No counts table found.</span>";
      }
    }
  
    function renderPlots(job) {
      const rawDiv = document.getElementById("rawPlots");
      const postDiv = document.getElementById("postPlots");
      if (!rawDiv || !postDiv) return;
  
      const artifacts = job.artifacts || [];
      const raw = artifacts.filter((a) => a.kind.startsWith("fastqc_plot_raw:"));
      const post = artifacts.filter((a) => a.kind.startsWith("fastqc_plot_post:"));
  
      function renderImgList(list, container) {
        if (!list.length) {
          container.innerHTML =
            "<p style='font-size:0.85rem;color:#9ca3af'>No plots recorded.</p>";
          return;
        }
        container.innerHTML = list
          .map((a) => {
            const label = a.kind.split(":", 2)[1] || a.kind;
            const url = `${API}/artifact?path=${encodeURIComponent(a.path)}`;
            return `<figure>
              <img src="${url}" alt="${label}" />
              <figcaption>${label}</figcaption>
            </figure>`;
          })
          .join("");
      }
  
      renderImgList(raw, rawDiv);
      renderImgList(post, postDiv);
    }
  
    async function init() {
      const jobId = getJobIdFromQuery();
      if (!jobId) {
        showError("Missing job_id in URL. Example: report.html?job_id=YOUR_JOB_ID");
        return;
      }
  
      try {
        const res = await fetch(`${API}/runs/${encodeURIComponent(jobId)}`);
        if (!res.ok) {
          showError(`Failed to load run: HTTP ${res.status}`);
          return;
        }
        const job = await res.json();
        renderMeta(job);
        renderQCSummary(job);
        renderAlignment(job);
        renderCounts(job);
        renderPlots(job);
      } catch (err) {
        console.error(err);
        showError("Error fetching report. See console for details.");
      }
    }
  
    document.addEventListener("DOMContentLoaded", init);
  })();
  