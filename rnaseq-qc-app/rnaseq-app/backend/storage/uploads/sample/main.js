const API = "http://127.0.0.1:5001";

/** poll helper */
function useInterval(callback, delay){
  const saved = React.useRef();
  React.useEffect(()=>{ saved.current = callback },[callback]);
  React.useEffect(()=>{
    if(delay==null) return;
    const id = setInterval(()=>saved.current(), delay);
    return ()=>clearInterval(id);
  },[delay]);
}

function Badge({kind, children}){
  const color = kind==='ok' ? 'var(--ok)' : kind==='warn' ? 'var(--warn)' : kind==='bad' ? 'var(--bad)' : 'var(--muted)';
  return <span className="badge" style={{borderColor:color,color}}>{children}</span>
}

function Progress({value}){ return <div className="progress"><div style={{width:`${value}%`}}/></div> }

function Chart({id, data, layout}){
  React.useEffect(()=>{
    if(!data) return;
    Plotly.react(id, data, {
      margin:{t:24,r:16,b:40,l:50},
      paper_bgcolor:'transparent', plot_bgcolor:'transparent',
      font:{color:'#e6eef6'}, ...layout
    }, {displayModeBar:false});
  },[id,data,layout]);
  return <div id={id} className="chart"/>;
}

/** --- FastQC-like module list (left nav) --- */
function FastQCNav({modules, active, onSelect}){
  return (
    <div className="fastqc-nav">
      <ul>
        {modules.map(m=>(
          <li key={m.key} onClick={()=>onSelect(m.key)} style={{background:active===m.key?'#0c1420':undefined}}>
            <span>{m.title}</span>
            <span className={`status ${m.status}`}>{m.status.toUpperCase()}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** --- Main App --- */
function App(){
  // UI state machine: idle -> uploaded -> fastqc_running -> fastqc_done
  const [ui, setUi] = React.useState('idle');
  const [files, setFiles] = React.useState([]);
  const [sample, setSample] = React.useState(null);
  const [jobId, setJobId] = React.useState(null);
  const [job, setJob] = React.useState(null);
  const [activeModule, setActiveModule] = React.useState('per_base_quality');
  const [isTrimming, setIsTrimming] = React.useState(false);

  // poll status while a job is active
  useInterval(async ()=>{
    if(!jobId) return;
    const res = await fetch(`${API}/api/status/${jobId}`);
    const js = await res.json();
    if(js.ok){
      setJob(js.job);
      // when pre_qc_raw exists & later stages absent -> treat as fastqc-only
      const names = (js.job.stages||[]).map(s=>s.name);
      if(names.includes('pre_qc_raw') && (js.job.status==='finished' || !names.includes('trim'))){
        setUi('fastqc_done');
      }
    }
  }, 1000);

  /** upload */
  const onUpload = async ()=>{
    const fd = new FormData();
    for(const f of files) fd.append('files', f);
    fd.append('sample_name', document.getElementById('sample_name').value || 'sample');
    const res = await fetch(`${API}/api/upload`, { method:'POST', body:fd });
    const js = await res.json();
    if(js.ok){
      setSample(js.sample);
      setUi('uploaded');
    }
  };

  /** start FastQC (fastqc-only run) */
  const onRunFastQC = async ()=>{
    const res = await fetch(`${API}/api/run`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ sample, params:{ mode:'fastqc_only' } })
    });
    const js = await res.json();
    if(js.ok){
      setJobId(js.job_id);
      setUi('fastqc_running');
    }
  };

  /** Trim + re-run FastQC (new job using same sample) */
  const onTrimAndRerun = async ()=>{
    setIsTrimming(true);
    const res = await fetch(`${API}/api/run`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ sample, params:{ action:'trim_then_fastqc' } })
    });
    const js = await res.json();
    if(js.ok){
      setJobId(js.job_id);
      setUi('fastqc_running');
    }
    setIsTrimming(false);
  };

  /** derive fastqc-ish module statuses from metrics */
  const fastqcMetrics = React.useMemo(()=>{
    // Pick metrics from the pre_qc_raw stage if present; fallback to post-trim
    const stage = job?.stages?.find(s=>s.name==='pre_qc_raw') ||
                  job?.stages?.find(s=>s.name==='fastqc_post_trim');
    const m = stage?.metrics || {};
    // naive status heuristics; backend should provide real PASS/WARN/FAIL later
    const q30 = m['%Q30'] ?? 92;
    const adapterFlag = m.adapter_flag ?? false;
    const dup = m.duplication_pct ?? 15;

    return [
      { key:'basic_stats', title:'Basic Statistics', status:'ok' },
      { key:'per_base_quality', title:'Per base sequence quality', status: q30>=90?'ok': q30>=80?'warn':'bad' },
      { key:'per_sequence_quality', title:'Per sequence quality scores', status: q30>=90?'ok': 'warn' },
      { key:'per_base_content', title:'Per base sequence content', status:'warn' }, // common for RNA-seq
      { key:'duplication', title:'Sequence Duplication Levels', status: dup>50?'bad': dup>20?'warn':'ok' },
      { key:'adapter', title:'Adapter Content', status: adapterFlag?'warn':'ok' },
    ];
  },[job]);

  /** build demo charts to mimic FastQC visuals */
  const charts = React.useMemo(()=>{
    const stage = job?.stages?.find(s=>s.name==='pre_qc_raw') ||
                  job?.stages?.find(s=>s.name==='fastqc_post_trim');
    const m = stage?.metrics || {};
    const q = m['%Q30'] || 92;
    const x = Array.from({length:100}, (_,i)=>i+1);

    const perBaseQ = [{ x, y: x.map(i=> Math.max(18, 34 - 0.12*i) + (q-90)*0.08), mode:'lines', name:'Q' }];
    const perSeqQ = [{
      type:'histogram', x: Array.from({length:5000}, ()=> 20 + Math.random()* (q/2) ),
      nbinsx: 30, name:'reads'
    }];
    const dup = [{
      x: ['1','2','3-5','6-10','>10'],
      y: [70,15,8,5,2], type:'bar', name:'dup levels'
    }];
    const adapter = [{
      x, y: x.map(i=> Math.max(0, (i-70)*0.3)), mode:'lines', name:'Adapter %'
    }];

    return { perBaseQ, perSeqQ, dup, adapter };
  },[job]);

  const canShowFastQCStart = ui==='uploaded';
  const showFastQCRunning = ui==='fastqc_running';
  const showFastQCResults = ui==='fastqc_done';

  return (
    <>
      <header>
        <div className="container hstack" style={{justifyContent:'space-between'}}>
          <div className="hstack" style={{gap:16}}>
            <strong>RNA-seq App</strong>
            <Badge>React frontend</Badge>
            <Badge>Flask API</Badge>
          </div>
          <div className="hstack" style={{gap:8}}>
            <Badge>{ui}</Badge>
          </div>
        </div>
      </header>

      <main className="container vstack" style={{marginTop:16}}>
        {/* 1) Upload card — always visible */}
        <section className="card">
          <h3 className="section-title">Upload FASTQ files</h3>
          <div className="grid cols-2">
            <div className="vstack">
              <input id="sample_name" className="kpi" placeholder="sample name (optional)"/>
              <input type="file" multiple onChange={(e)=> setFiles(Array.from(e.target.files))}/>
              <div className="hstack">
                <button className="btn" onClick={onUpload}>Upload</button>
                {sample && <Badge kind="ok">uploaded: {sample.name}</Badge>}
              </div>
              {sample?.files?.length ? (
                <ul className="helper" style={{margin:0}}>
                  {sample.files.map((p,i)=><li key={i}>{p}</li>)}
                </ul>
              ) : <span className="helper">Accepts paired-end (R1/R2) or single-end .fastq.gz</span>}
            </div>
            <div className="vstack">
              <div className="kpi">Max size ~2GB/request (configurable).</div>
              <div className="kpi">Files stored locally under backend/storage/uploads/</div>
            </div>
          </div>
        </section>

        {/* 2) FastQC start card — appears only after upload */}
        {canShowFastQCStart && (
          <section className="card">
            <h3 className="section-title">Run FastQC</h3>
            <div className="hstack" style={{gap:10}}>
              <button className="btn primary" onClick={onRunFastQC}>Start FastQC</button>
              {job && <div style={{minWidth:260}}><Progress value={job.progress || 0}/></div>}
            </div>
            <div className="helper">FastQC will analyze raw reads and report per-base quality, GC content, adapters, and duplication.</div>
          </section>
        )}

        {/* 3) Running indicator */}
        {showFastQCRunning && (
          <section className="card">
            <h3 className="section-title">FastQC running…</h3>
            <div className="vstack">
              <Progress value={job?.progress || 0}/>
              <span className="helper">Parsing cycles and computing quality metrics…</span>
            </div>
          </section>
        )}

        {/* 4) FastQC Results — mimic Babraham layout */}
        {showFastQCResults && (
          <section className="card">
            <h3 className="section-title">FastQC Results</h3>
            <div className="fastqc-layout">
              {/* left: module list with PASS/WARN/FAIL */}
              <FastQCNav
                modules={fastqcMetrics}
                active={activeModule}
                onSelect={setActiveModule}
              />

              {/* right: module visuals */}
              <div className="vstack">
                {activeModule==='basic_stats' && (
                  <>
                    <div className="kpi"><strong>Sample:</strong> {sample?.name}</div>
                    <div className="kpi"><strong>Status:</strong> Completed</div>
                    <div className="helper">Summary of key metrics from FastQC.</div>
                    <div className="divider"></div>
                    <div className="helper">Tip: backend should populate exact numbers (total reads, GC%, encoding, read length).</div>
                  </>
                )}

                {activeModule==='per_base_quality' && (
                  <Chart id="perBaseQ" data={charts.perBaseQ} layout={{yaxis:{title:'Phred Score'}, xaxis:{title:'Position in read'}}}/>
                )}

                {activeModule==='per_sequence_quality' && (
                  <Chart id="perSeqQ" data={charts.perSeqQ} layout={{xaxis:{title:'Mean read quality'}, yaxis:{title:'Count'}}}/>
                )}

                {activeModule==='duplication' && (
                  <Chart id="dup" data={charts.dup} layout={{yaxis:{title:'% of reads'}, xaxis:{title:'Duplication level'}}}/>
                )}

                {activeModule==='per_base_content' && (
                  <div className="helper">Per-base content plot would go here (A/T/G/C vs position). Wire from FastQC data.</div>
                )}

                {activeModule==='adapter' && (
                  <Chart id="adapter" data={charts.adapter} layout={{yaxis:{title:'% of reads'}, xaxis:{title:'Position in read'}}}/>
                )}

                <div className="divider"></div>
                <div className="hstack" style={{gap:10}}>
                  <button className={`btn ${isTrimming?'warn':''}`} onClick={onTrimAndRerun} disabled={isTrimming}>
                    {isTrimming ? 'Trimming…' : 'Trim reads and re-run FastQC'}
                  </button>
                  <span className="helper">Uses fastp (or your chosen trimmer), then runs FastQC on trimmed reads.</span>
                </div>

                <div className="divider"></div>
                <div className="next-wrap">
                  <button className="btn next-btn" onClick={()=> window.location.href = 'step2.html'}>
                    Next step
                    <svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14M13 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>
    </>
  );
}

const root = ReactDOM.createRoot(document.getElementById('app'));
root.render(<App/>);
