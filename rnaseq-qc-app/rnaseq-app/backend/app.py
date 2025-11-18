import os, json, threading, uuid, subprocess
from pathlib import Path
from datetime import datetime

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from dotenv import load_dotenv

from sqlalchemy import create_engine, String, Integer, Float, Text, ForeignKey
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship, Session

# ---------------------------------
# Load configuration
# ---------------------------------
load_dotenv()
API_PORT = int(os.getenv("API_PORT", "5050"))

QC_ROOT = Path(os.getenv("QC_ROOT", "/data/qc"))
STORAGE_ROOT = Path(os.getenv("STORAGE_ROOT", "/data/storage"))
STAR_GENOME_DIR = Path(os.getenv("STAR_GENOME_DIR", "/refs/star_index"))
# Match your docker-compose default: /refs/genomic.gtf
GTF_PATH = Path(os.getenv("GTF_PATH", "/refs/genomic.gtf"))

UPLOAD_DIR = STORAGE_ROOT / "uploads"
ARTIFACTS_DIR = STORAGE_ROOT / "artifacts"

DB_DIR = Path("db")
DB_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DB_DIR / "rnaseq.sqlite"

for d in (UPLOAD_DIR, ARTIFACTS_DIR, QC_ROOT):
    d.mkdir(parents=True, exist_ok=True)

# ---------------------------------
# Database models
# ---------------------------------
class Base(DeclarativeBase):
    pass

class Run(Base):
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    created_at: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(32), default="queued")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    sample_name: Mapped[str] = mapped_column(String(255))
    sample_files_json: Mapped[str] = mapped_column(Text)
    params_json: Mapped[str] = mapped_column(Text, default="{}")
    stages: Mapped[list["Stage"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )
    artifacts: Mapped[list["Artifact"]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )

class Stage(Base):
    __tablename__ = "stages"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(32), default="running")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    time_iso: Mapped[str] = mapped_column(String(40))
    metrics_json: Mapped[str] = mapped_column(Text, default="{}")
    artifact_path: Mapped[str] = mapped_column(Text, default="")
    run: Mapped[Run] = relationship(back_populates="stages")

class Artifact(Base):
    __tablename__ = "artifacts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(64))
    path: Mapped[str] = mapped_column(Text)
    run: Mapped[Run] = relationship(back_populates="artifacts")

engine = create_engine(f"sqlite:///{DB_PATH}", echo=False, future=True)
Base.metadata.create_all(engine)

# ---------------------------------
# Flask setup
# ---------------------------------
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024 * 1024  # 2GB

# ---------------------------------
# Helpers
# ---------------------------------
def now_iso():
    return datetime.utcnow().isoformat() + "Z"

def sh(cmd, cwd=None):
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr

def run_to_dict(r: Run):
    return {
        "id": r.id,
        "created_at": r.created_at,
        "status": r.status,
        "progress": r.progress,
        "sample": {
            "name": r.sample_name,
            "files": json.loads(r.sample_files_json or "[]"),
        },
        "params": json.loads(r.params_json or "{}"),
        "stages": [
            {
                "name": s.name,
                "status": s.status,
                "progress": s.progress,
                "time": s.time_iso,
                "metrics": json.loads(s.metrics_json or "{}"),
                "artifact": s.artifact_path or None,
            }
            for s in r.stages
        ],
        "artifacts": [{"kind": a.kind, "path": a.path} for a in r.artifacts],
    }

def parse_fastqc_summary(dir: Path):
    out = {}
    f = dir / "summary.txt"
    if not f.exists():
        return out
    for line in f.read_text().splitlines():
        parts = line.split("\t")
        if len(parts) >= 3:
            status, metric, _ = parts[:3]
            out[metric] = status
    return out

def parse_star_log(f: Path):
    if not f.exists():
        return {}
    out = {}
    for line in f.read_text().splitlines():
        if "|" in line:
            k, v = line.split("|", 1)
            out[k.strip()] = v.strip()
    return out

def _emit_stage(session: Session, run: Run, name, pct, metrics=None, artifact=None, status="running"):
    st = Stage(
        run_id=run.id,
        name=name,
        status=status,
        progress=pct,
        time_iso=now_iso(),
        metrics_json=json.dumps(metrics or {}),
        artifact_path=str(artifact or "")
    )
    session.add(st)
    run.progress = pct
    run.status = "finished" if pct >= 100 else "running"
    session.commit()

def _add_fastqc_plots(session: Session, run: Run, images_dir: Path, tag: str):
    if not images_dir.exists():
        return
    for png in sorted(images_dir.glob("*.png")):
        session.add(Artifact(
            run_id=run.id,
            kind=f"fastqc_plot_{tag}:{png.stem}",
            path=str(png)
        ))
    session.commit()

# ---------------------------------
# API ROUTES
# ---------------------------------
@app.get("/api/health")
def health():
    return jsonify({"ok": True, "time": now_iso()})

@app.post("/api/upload")
def upload():
    if "files" not in request.files:
        return jsonify({"ok": False, "error": "no files"}), 400

    files = request.files.getlist("files")
    name = request.form.get("sample_name") or f"sample-{uuid.uuid4().hex[:6]}"
    destdir = UPLOAD_DIR / name
    destdir.mkdir(parents=True, exist_ok=True)

    saved = []
    for f in files:
        safe = f.filename.replace("..", "_")
        path = destdir / safe
        f.save(path)
        saved.append(str(path))

    return jsonify({"ok": True, "sample": {"name": name, "files": saved}})

@app.post("/api/run")
def run_pipeline():
    data = request.json
    sample = data["sample"]

    job_id = uuid.uuid4().hex
    r = Run(
        id=job_id,
        created_at=now_iso(),
        status="queued",
        progress=0,
        sample_name=sample["name"],
        sample_files_json=json.dumps(sample["files"]),
        params_json=json.dumps(data.get("params", {}))
    )

    with Session(engine) as s:
        s.add(r)
        s.commit()

    threading.Thread(target=_run_pipeline_real, args=(job_id,), daemon=True).start()

    return jsonify({"ok": True, "job_id": job_id})

@app.get("/api/status/<job_id>")
def status(job_id):
    with Session(engine) as s:
        r = s.get(Run, job_id)
        if not r:
            return jsonify({"ok": False, "error": "not found"}), 404
        _ = r.stages, r.artifacts
        return jsonify({"ok": True, "job": run_to_dict(r)})

@app.get("/api/runs/<job_id>")
def get_run(job_id):
    """Return a single run as a plain JSON object for the report page."""
    with Session(engine) as s:
        r = s.get(Run, job_id)
        if not r:
            return jsonify({"error": "not found"}), 404
        _ = r.stages, r.artifacts
        return jsonify(run_to_dict(r))

@app.get("/api/artifact")
def artifact():
    path = request.args.get("path")
    if not path:
        return jsonify({"ok": False, "error": "missing path"}), 400

    full = Path(path).resolve()
    if not full.exists():
        return jsonify({"ok": False, "error": "not found"}), 404

    return send_file(full, conditional=True)

@app.get("/api/qc/<job_id>/<path:rest>")
def serve_qc(job_id, rest):
    base = (QC_ROOT / job_id).resolve()
    full = (base / rest).resolve()
    if not str(full).startswith(str(base)) or not full.exists():
        return jsonify({"ok": False, "error": "not found"}), 404
    return send_file(full, conditional=True)

# ---------------------------------
# PIPELINE IMPLEMENTATION
# ---------------------------------
def _run_pipeline_real(job_id: str):
    with Session(engine) as s:
        r = s.get(Run, job_id)

        files = json.loads(r.sample_files_json)
        if not files:
            _emit_stage(s, r, "error", 100, {"error": "no FASTQ files"}, status="failed")
            return

        r1 = Path(files[0])
        r2 = Path(files[1]) if len(files) > 1 else None

        work = QC_ROOT / job_id
        work.mkdir(parents=True, exist_ok=True)

        prefix = Path(r1.name).with_suffix("").with_suffix("").name

        # 1) RAW FASTQC
        raw_dir = work / "fastqc_raw"
        raw_dir.mkdir(exist_ok=True)
        sh(["fastqc", str(r1), "-o", str(raw_dir), "--extract", "--quiet"])
        if r2:
            sh(["fastqc", str(r2), "-o", str(raw_dir), "--extract", "--quiet"])

        raw_html = raw_dir / f"{prefix}_fastqc.html"
        img_dir = raw_dir / f"{prefix}_fastqc" / "Images"
        metrics = parse_fastqc_summary(raw_dir / f"{prefix}_fastqc")

        _emit_stage(s, r, "pre_fastqc", 15, metrics, raw_html)
        _add_fastqc_plots(s, r, img_dir, "raw")

        # 2) fastp
        trim_dir = work / "trim"
        trim_dir.mkdir(exist_ok=True)
        trimmed_r1 = trim_dir / f"{prefix}_trimmed.fastq.gz"
        trimmed_r2 = None

        fastp_html = work / f"{prefix}_fastp.html"
        fastp_json = work / f"{prefix}_fastp.json"

        if r2:
            trimmed_r2 = trim_dir / f"{prefix}_trimmed_R2.fastq.gz"
            sh([
                "fastp", "-i", str(r1), "-I", str(r2),
                "-o", str(trimmed_r1), "-O", str(trimmed_r2),
                "-h", str(fastp_html), "-j", str(fastp_json), "-w", "4"
            ])
        else:
            sh([
                "fastp", "-i", str(r1),
                "-o", str(trimmed_r1),
                "-h", str(fastp_html), "-j", str(fastp_json), "-w", "4"
            ])

        fp_metrics = {}
        if fastp_json.exists():
            try:
                fp_metrics = json.loads(fastp_json.read_text())["summary"]
            except Exception:
                fp_metrics = {"note": "could not parse fastp json"}

        _emit_stage(s, r, "trim_fastp", 45, fp_metrics, fastp_html)

        # 3) POST FASTQC
        post_dir = work / "fastqc_post"
        post_dir.mkdir(exist_ok=True)

        sh([
            "fastqc",
            str(trimmed_r1),
            "-o", str(post_dir),
            "--extract", "--quiet"
        ])

        post_prefix = Path(trimmed_r1.name).with_suffix("").with_suffix("").name
        post_html = post_dir / f"{post_prefix}_fastqc.html"
        post_img_dir = post_dir / f"{post_prefix}_fastqc" / "Images"
        post_metrics = parse_fastqc_summary(post_dir / f"{post_prefix}_fastqc")

        _emit_stage(s, r, "post_fastqc", 65, post_metrics, post_html)
        _add_fastqc_plots(s, r, post_img_dir, "post")

        # 4) STAR ALIGNMENT
        star_dir = work / "star"
        star_dir.mkdir(exist_ok=True)
        star_prefix = star_dir / prefix

        star_cmd = [
            "STAR", "--runThreadN", "4",
            "--genomeDir", str(STAR_GENOME_DIR),
            "--readFilesIn", str(trimmed_r1),
            "--readFilesCommand", "gunzip", "-c",
            "--outSAMtype", "BAM", "SortedByCoordinate",
            "--outFileNamePrefix", str(star_prefix)
        ]

        if trimmed_r2:
            star_cmd.insert(star_cmd.index("--readFilesCommand"), str(trimmed_r2))

        code, out, err = sh(star_cmd, cwd=star_dir)
        if code != 0:
            _emit_stage(s, r, "align_star", 100, {"error": err}, star_dir, status="failed")
            return

        bam = star_dir / (prefix + "Aligned.sortedByCoord.out.bam")
        star_log = star_dir / (prefix + "Log.final.out")
        star_metrics = parse_star_log(star_log)

        star_report = star_dir / "star_report.html"
        with star_report.open("w") as f:
            f.write("<html><head><title>STAR Report</title>")
            f.write("<style>table{border-collapse:collapse}"
                    "td,th{border:1px solid #ccc;padding:4px}</style>")
            f.write("</head><body>")
            f.write(f"<h2>STAR Alignment</h2><p>BAM: {bam.name}</p>")
            f.write("<table><tr><th>Metric</th><th>Value</th></tr>")
            for k, v in star_metrics.items():
                f.write(f"<tr><td>{k}</td><td>{v}</td></tr>")
            f.write("</table></body></html>")

        s.add(Artifact(run_id=r.id, kind="star_bam", path=str(bam)))
        s.add(Artifact(run_id=r.id, kind="star_report", path=str(star_report)))
        s.commit()

        _emit_stage(s, r, "align_star", 85, star_metrics, star_report)

        # 5) FEATURECOUNTS
        counts_dir = work / "counts"
        counts_dir.mkdir(exist_ok=True)
        counts_out = counts_dir / f"{prefix}_featurecounts.txt"

        fc_cmd = [
            "featureCounts", "-T", "4",
            "-a", str(GTF_PATH),
            "-o", str(counts_out),
            str(bam)
        ]

        code, out, err = sh(fc_cmd, cwd=counts_dir)
        if code != 0:
            _emit_stage(s, r, "featurecounts", 100, {"error": err}, counts_dir, status="failed")
            return

        s.add(Artifact(run_id=r.id, kind="counts_table", path=str(counts_out)))
        s.commit()

        _emit_stage(s, r, "featurecounts", 95, {"note": "featureCounts complete"}, counts_out)

        # 6) SUMMARY
        _emit_stage(
            s, r, "summary", 100,
            {"status": "complete"},
            work,
            status="finished"
        )

# ---------------------------------
# Run
# ---------------------------------
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=API_PORT, debug=True)
