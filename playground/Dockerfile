FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app

# No shell, no home, no write access to its own code.
RUN useradd --system --no-create-home --shell /usr/sbin/nologin playground
USER playground

EXPOSE 5100
# One worker: sessions live in this process's memory.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5100", "--workers", "1", "--no-server-header"]
