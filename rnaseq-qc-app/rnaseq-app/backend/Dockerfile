FROM python:3.10-slim

WORKDIR /app

# ------------------------------------------------
# System dependencies
# ------------------------------------------------
RUN apt-get update && apt-get install -y \
    wget \
    unzip \
    default-jre \
    gzip \
    tar \
    perl \
    libgomp1 \
    git \
    make \
    g++ \
    zlib1g-dev \
    && apt-get clean

# ------------------------------------------------
# Install FastQC
# ------------------------------------------------
RUN wget -O /tmp/fastqc.zip \
      https://www.bioinformatics.babraham.ac.uk/projects/fastqc/fastqc_v0.12.1.zip \
    && unzip /tmp/fastqc.zip -d /opt \
    && chmod +x /opt/FastQC/fastqc \
    && ln -s /opt/FastQC/fastqc /usr/local/bin/fastqc

# ------------------------------------------------
# Install STAR (Linux x86_64)
# ------------------------------------------------
RUN wget -O /tmp/STAR.tar.gz \
      https://github.com/alexdobin/STAR/archive/refs/tags/2.7.11b.tar.gz \
    && tar -xzf /tmp/STAR.tar.gz -C /tmp \
    && cp /tmp/STAR-2.7.11b/bin/Linux_x86_64/STAR /usr/local/bin/STAR \
    && chmod +x /usr/local/bin/STAR

# -------------------------
# Install fastp from source
# -------------------------
RUN apt-get update && apt-get install -y \
        git make g++ zlib1g-dev \
        libisal2 libisal-dev \
        libdeflate-dev libdeflate0 \
    && git clone https://github.com/OpenGene/fastp.git /tmp/fastp \
    && cd /tmp/fastp \
    && make \
    && cp fastp /usr/local/bin/fastp \
    && chmod +x /usr/local/bin/fastp


# ------------------------------------------------
# Install Subread (featureCounts)
# ------------------------------------------------
RUN wget -O /tmp/subread.tar.gz \
      https://sourceforge.net/projects/subread/files/subread-2.0.6/subread-2.0.6-Linux-x86_64.tar.gz \
    && tar -xzf /tmp/subread.tar.gz -C /tmp \
    && cp /tmp/subread-2.0.6-Linux-x86_64/bin/featureCounts /usr/local/bin/featureCounts \
    && chmod +x /usr/local/bin/featureCounts

# ------------------------------------------------
# Python deps
# ------------------------------------------------
COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python3", "app.py"]
