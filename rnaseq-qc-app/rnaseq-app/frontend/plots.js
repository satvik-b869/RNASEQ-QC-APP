// plots.js — lightweight UI helpers for FastQC plots (no build step)

(function () {
    const PRETTY = {
      per_base_quality: "Per-base Quality",
      per_sequence_quality: "Per-sequence Quality",
      per_base_sequence_content: "Per-base Sequence Content",
      per_base_gc_content: "Per-base GC Content",
      per_sequence_gc_content: "Per-sequence GC Content",
      per_base_n_content: "Per-base N Content",
      seq_length_distribution: "Sequence Length Distribution",
      duplication_levels: "Sequence Duplication Levels",
      overrepresented_sequences: "Overrepresented Sequences",
      adapter_content: "Adapter Content",
    };
  
    function makeArtifactUrl(base, p) {
      return `${base}/api/artifact?path=${encodeURIComponent(p)}`;
    }
  
    // Responsive grid section for a set of plots (raw/post)
    function renderFastqcSectionFactory(API_BASE) {
      return function renderFastqcSection(container, artifacts, tag, title) {
        const plots = (artifacts || [])
          .filter(a => a.kind && a.kind.startsWith(`fastqc_plot_${tag}:`))
          .map(a => {
            const key = a.kind.split(":")[1] || "plot";
            return { src: makeArtifactUrl(API_BASE, a.path), label: PRETTY[key] || key };
          });
  
        if (!plots.length) return;
  
        const sec = document.createElement("section");
        sec.className = "fastqc-section";
        sec.innerHTML = `<h3>${title}</h3><div class="fastqc-grid"></div>`;
        const grid = sec.querySelector(".fastqc-grid");
  
        plots.forEach(p => {
          const card = document.createElement("div");
          card.className = "fastqc-card";
          card.innerHTML = `
            <figure>
              <img src="${p.src}" alt="${p.label}" loading="lazy" />
              <figcaption>${p.label}</figcaption>
            </figure>
          `;
          grid.appendChild(card);
        });
  
        container.appendChild(sec);
      };
    }
  
    // Optional: small metrics table (PASS/WARN/FAIL)
    function renderMetrics(container, title, metricsObj) {
      if (!metricsObj || !Object.keys(metricsObj).length) return;
      const wrap = document.createElement("div");
      wrap.className = "fastqc-section";
      const rows = Object.entries(metricsObj)
        .map(([k,v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
        .join("");
      wrap.innerHTML = `
        <h3>${title}</h3>
        <div style="overflow:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr><th style="text-align:left">Metric</th><th style="text-align:left">Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
      container.appendChild(wrap);
    }
  
    // Expose a tiny namespace
    window.PlotUI = {
      renderFastqcSectionFactory,
      renderMetrics,
    };
  })();
  