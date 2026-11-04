# syntax=docker/dockerfile:1.7
# DeepSeek 官方 tokenizer 侧车：只做 token 计数，不接触业务数据。
FROM python:3.12-slim

COPY requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt

# 官方分发（zip 内含 tokenizer.json）；固定校验和，来源可追溯
ADD --checksum=sha256:c954ca6f6e54281d72d3c27e2430cea7663f81292b39982e2f97890c66c302de \
    https://cdn.deepseek.com/api-docs/deepseek_v3_tokenizer.zip /tmp/tokenizer.zip
RUN mkdir -p /app/model \
    && python -c "import zipfile; zipfile.ZipFile('/tmp/tokenizer.zip').extractall('/tmp/tok')" \
    && cp /tmp/tok/deepseek_v3_tokenizer/tokenizer.json /app/model/tokenizer.json \
    && rm -rf /tmp/tok /tmp/tokenizer.zip

COPY app.py /app/app.py
ENV TOKENIZER_MODEL=/app/model/tokenizer.json PORT=8301
EXPOSE 8301
USER nobody
CMD ["python", "/app/app.py"]
